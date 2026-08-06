/**
 * Back-door blocking.
 *
 * The lock in `lock.ts` is the guarantee: it rejects any transaction that would
 * touch sealed text, whatever route the edit arrived by. Everything here is
 * defense in depth for *feel* — a rejected undo that still flashes the document
 * is worse than an undo that never happened.
 *
 * Because it is only about feel, this module errs narrow. Every blocked key is
 * listed explicitly. `Mod-P` is deliberately absent: the command palette is one
 * of the three documented ways out of flow mode (PRD §6.4) and blocking it
 * could trap the user in a locked editor. The user's own flow-mode hotkey is
 * unknowable here, which is the other reason to keep the list short.
 */

import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { isFlowActive } from "./lock";

/**
 * Swallow the key, but only in an editor that is actually in flow mode.
 *
 * `registerEditorExtension` installs this in *every* editor in the app, so the
 * gate is what keeps the rest of the vault behaving normally (PRD §7.3).
 */
function blockWhenActive(view: EditorView): boolean {
	return isFlowActive(view.state);
}

/**
 * Undo is the sharpest back-door: a single keystroke rewinds straight through
 * the seal point. Redo and the Windows-style `Mod-y` are the same door.
 */
const blockedBindings = [
	{ key: "Mod-z", run: blockWhenActive },
	{ key: "Mod-Shift-z", run: blockWhenActive },
	{ key: "Mod-y", run: blockWhenActive },
];

/** Swallow an event outright once flow mode is confirmed active. */
function swallow(event: Event, view: EditorView): boolean {
	if (!isFlowActive(view.state)) return false;
	event.preventDefault();
	return true;
}

/**
 * `mousedown` is where caret placement and drag-selection both begin, so
 * cancelling it pins the caret without needing to chase `mouseup`,
 * `selectstart` and friends.
 *
 * Focus is re-asserted rather than simply dropped: clicking the note is the
 * reflex a user reaches for when focus has wandered (after a full screen change,
 * say), and a click that silently does nothing would leave them typing into
 * nowhere.
 */
function blockPointer(event: MouseEvent, view: EditorView): boolean {
	if (!isFlowActive(view.state)) return false;
	event.preventDefault();
	view.focus();
	return true;
}

/**
 * Obsidian's closebrackets extension auto-pairs `(` as `()`, placing the
 * cursor between them. The lock then pins the cursor to newDoc.length (after
 * the `)`) so both characters land in the document. Fix: intercept each
 * opener in flow mode, insert only the opening character, and return true so
 * closebrackets never runs. Outside flow mode, return false = normal behaviour.
 */
const autopairSuppression = Prec.highest(
	keymap.of(
		["(", "[", "{", '"', "'", "`"].map((ch) => ({
			key: ch,
			run: (view: EditorView): boolean => {
				if (!isFlowActive(view.state)) return false;
				const pos = view.state.selection.main.head;
				view.dispatch({ changes: { from: pos, to: pos, insert: ch } });
				return true;
			},
		})),
	),
);

export function flowGuardsExtension(): Extension {
	return [
		// Highest precedence so these run before Obsidian's and CodeMirror's own
		// bindings for the same keys.
		Prec.highest(keymap.of(blockedBindings)),
		autopairSuppression,
		EditorView.domEventHandlers({
			paste: swallow,
			// Note: `dragover` is left alone on purpose — preventing its default
			// is what *enables* a drop target, so blocking it would invert the
			// intent. Cancelling `drop` is the direct guarantee.
			drop: swallow,
			mousedown: blockPointer,
		}),
	];
}

export interface DomGuardOptions {
	shouldEscExit: () => boolean;
	onEscExit: () => void;
}

/**
 * Routes that never reach CodeMirror, because Obsidian handles them at the
 * document level. Each one either leaves the note or rewrites it wholesale.
 *
 * o — quick switcher      f — find        h — replace
 * t — new tab             w — close tab
 *
 * `p` is absent by design. So is `v`: paste is already cancelled inside the
 * editor, and swallowing it app-wide would break pasting into, say, the command
 * palette's search field.
 */
const BLOCKED_MOD_KEYS = new Set(["o", "f", "h", "t", "w"]);

/**
 * Installs capture-phase guards on the flow container. Returns an uninstall
 * function.
 *
 * Capture phase on the container beats Obsidian's own document-level bubble
 * handlers, which is the only reason `stopPropagation` bites here.
 */
export function installDomGuards(
	containerEl: HTMLElement,
	options: DomGuardOptions,
): () => void {
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			// Swallowed either way so Obsidian's own Esc handling stays out of
			// it. Whether it *exits* is the user's setting — see PRD §6.4 for
			// why full screen may still drop regardless of what we do here.
			event.preventDefault();
			event.stopPropagation();
			if (options.shouldEscExit()) options.onEscExit();
			return;
		}

		// Cmd on macOS, Ctrl elsewhere. Treating either as "Mod" costs us a
		// couple of emacs-style Ctrl bindings that move the caret — which flow
		// mode blocks anyway.
		const mod = event.metaKey || event.ctrlKey;
		if (!mod || event.altKey) return;
		if (!BLOCKED_MOD_KEYS.has(event.key.toLowerCase())) return;

		event.preventDefault();
		event.stopPropagation();
	};

	containerEl.addEventListener("keydown", onKeyDown, true);
	return () => containerEl.removeEventListener("keydown", onKeyDown, true);
}
