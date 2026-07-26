/**
 * The lock — forward-only writing.
 *
 * This module is the load-bearing part of the plugin and is deliberately free
 * of any Obsidian dependency, so it can be tested against a plain headless
 * CodeMirror `EditorState`.
 *
 * The model is a single integer, the *seal point*: a document offset before
 * which all text is immutable. Text between the seal point and the end of the
 * document is the *live word* — the only editable region. See docs/PRD.md §6.1.
 */

import {
	EditorSelection,
	EditorState,
	StateEffect,
	StateField,
	type Extension,
	type Text,
	type Transaction,
	type TransactionSpec,
} from "@codemirror/state";

export interface FlowSession {
	/**
	 * Document offset before which all text is immutable.
	 * Monotonic: never decreases for the lifetime of a session.
	 */
	readonly sealPoint: number;
}

/**
 * Dispatch with a `FlowSession` to put that specific editor into flow mode, or
 * with `null` to take it out. The field is `null` in every editor that is not
 * in flow mode, which is how one globally registered extension stays inert
 * everywhere except the note being written.
 */
export const setFlowSession = StateEffect.define<FlowSession | null>();

/**
 * True for characters that end a word and therefore seal it.
 *
 * Any whitespace seals — space, tab, newline. Punctuation does not; `.` and `,`
 * are ordinary characters inside the live word. This matches the original Flow
 * Writer, which sealed only on space (32) and Enter (13).
 */
export function isWordBoundary(ch: string): boolean {
	return /\s/.test(ch);
}

/**
 * Given a document and the current seal point, return where the seal point
 * should now sit: immediately after the last word-boundary character in the
 * document.
 *
 * Only the live region is scanned — everything from the current seal point to
 * the end — so this is O(length of the word being typed), not O(document).
 * The result is never less than `sealPoint`, which is what makes the seal
 * monotonic by construction rather than by convention.
 */
export function computeSealPoint(doc: Text, sealPoint: number): number {
	const live = doc.sliceString(sealPoint);
	for (let i = live.length - 1; i >= 0; i--) {
		if (isWordBoundary(live[i])) {
			return sealPoint + i + 1;
		}
	}
	return sealPoint;
}

/** Does this transaction carry an explicit enter/exit instruction? */
function isSessionChange(tr: Transaction): boolean {
	return tr.effects.some((effect) => effect.is(setFlowSession));
}

export const flowSessionField = StateField.define<FlowSession | null>({
	create: () => null,

	update(session, tr) {
		// An explicit enter/exit overrides anything else in the transaction.
		for (const effect of tr.effects) {
			if (effect.is(setFlowSession)) return effect.value;
		}

		if (session === null) return null;
		if (!tr.docChanged) return session;

		// assoc -1 keeps the seal point *before* text inserted exactly at it,
		// so a character typed at the write-head lands in the live region
		// rather than being born already sealed.
		const mapped = tr.changes.mapPos(session.sealPoint, -1);
		const sealPoint = computeSealPoint(tr.newDoc, mapped);

		return sealPoint === session.sealPoint ? session : { sealPoint };
	},
});

/** The session for this editor, or null when it is not in flow mode. */
export function getFlowSession(state: EditorState): FlowSession | null {
	return state.field(flowSessionField, false) ?? null;
}

export function isFlowActive(state: EditorState): boolean {
	return getFlowSession(state) !== null;
}

/**
 * Rejects any transaction that would mutate sealed text, or move the caret off
 * the write-head.
 *
 * This is where the guarantee actually lives. The key blocking in `guards.ts`
 * is defense in depth for feel; enforcement at the transaction level is what
 * makes the lock hold no matter what route an edit arrives by — keyboard,
 * command, plugin, or Obsidian internals.
 */
const lockFilter = EditorState.transactionFilter.of((tr) => {
	const session = tr.startState.field(flowSessionField, false);
	if (!session) return tr;

	// Check the changes before anything else, including on transactions that
	// also carry an enter/exit effect. Carrying a session effect is not a
	// licence to rewrite the document: exempting those transactions would let
	// a single dispatch both unlock and empty a sealed note.
	if (tr.docChanged) {
		let touchesSealed = false;
		tr.changes.iterChanges((fromA) => {
			if (fromA < session.sealPoint) touchesSealed = true;
		});
		// Cancel outright. The document is left untouched and nothing is
		// reported to the user — the keystroke simply does nothing.
		if (touchesSealed) return [];
	}

	// Leaving flow mode hands the document back, caret included.
	if (isSessionChange(tr)) return tr;

	// Pin the caret to the write-head. This is checked on *every* surviving
	// transaction, not just selection-only ones, because a permitted edit that
	// also parks the caret in sealed text would wedge the session: every later
	// keystroke would target a sealed offset and be silently rejected, with
	// undo blocked and no way back.
	//
	// `newSelection` rather than `tr.selection` so that an edit which sets no
	// selection of its own — leaving CodeMirror to map the old one forward — is
	// caught too. The correction is appended as a second spec rather than the
	// transaction being rejected, so legitimate input from paths that place the
	// caret unusually (IME composition, autocomplete) still lands.
	const end = tr.newDoc.length;
	const selection = tr.newSelection;
	if (
		selection.ranges.length !== 1 ||
		selection.main.anchor !== end ||
		selection.main.head !== end
	) {
		// `sequential` is load-bearing: without it the merged spec's selection
		// is read against the *start* document and mapped forward, so an offset
		// taken from `newDoc` overruns whenever the transaction inserted text.
		return [tr, { selection: EditorSelection.cursor(end), sequential: true }];
	}

	return tr;
});

/**
 * A transaction spec that enters flow mode: seals the entire existing document
 * and moves the caret to the end of it.
 */
export function enterFlowSpec(state: EditorState): TransactionSpec {
	const end = state.doc.length;
	return {
		effects: setFlowSession.of({ sealPoint: end }),
		selection: EditorSelection.cursor(end),
		scrollIntoView: true,
	};
}

/** A transaction spec that leaves flow mode. */
export function exitFlowSpec(): TransactionSpec {
	return { effects: setFlowSession.of(null) };
}

/** State field plus enforcement. Registered once, globally, at plugin load. */
export function flowLockExtension(): Extension {
	return [flowSessionField, lockFilter];
}
