/**
 * Dimming — everything already sealed renders at a reduced opacity.
 *
 * See docs/PRD.md §6.2. The decoration carries a class and nothing else; the
 * actual fade is a CSS `opacity` on that class, never a colour. Opacity leaves
 * the user's theme, syntax highlighting, accent colours and Live Preview
 * rendering intact — just faded — which is also why light and dark mode need no
 * special handling here at all.
 */

import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import { flowSessionField, getFlowSession } from "./lock";
import { SEALED_TEXT_CLASS } from "./types";

const sealedMark = Decoration.mark({ class: SEALED_TEXT_CLASS });

function sealedDecorations(state: EditorState): DecorationSet {
	const session = getFlowSession(state);
	// Null in every editor that is not in flow mode, so the globally
	// registered extension contributes nothing there.
	if (!session) return Decoration.none;

	// A zero-length mark range is invalid in CM6, and an empty note entering
	// flow mode has a seal point of exactly 0.
	const to = Math.min(session.sealPoint, state.doc.length);
	if (to <= 0) return Decoration.none;

	return Decoration.set([sealedMark.range(0, to)]);
}

/**
 * Registered once, globally, at plugin load.
 *
 * Computed from state rather than driven by a ViewPlugin because the dimmed
 * range is a pure function of the seal point: deriving it in the state layer
 * means it is already correct when the view first draws, with no extra frame
 * where sealed text flashes at full strength.
 *
 * `flowSessionField` is re-listed here so this extension is self-sufficient —
 * CodeMirror deduplicates extensions by identity, so sharing it with
 * `flowLockExtension()` costs nothing.
 */
export function flowDecorationsExtension(): Extension {
	return [
		flowSessionField,
		EditorView.decorations.compute([flowSessionField, "doc"], sealedDecorations),
	];
}
