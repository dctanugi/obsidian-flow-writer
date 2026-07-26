/**
 * Word count — a faint counter in the corner of the flow screen.
 *
 * See docs/PRD.md §6.6. The element is absolutely positioned inside the
 * editor's own DOM so it overlays the text rather than taking part in layout;
 * nothing here may shift or reflow a single line.
 */

import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

import { getFlowSession } from "./lock";
import type { WordCountMode } from "./types";

/** Class on the counter element. Styled in styles.css. */
export const WORD_COUNT_CLASS = "flow-writer-word-count";

/**
 * Collapse whitespace and count the non-empty tokens.
 *
 * Mirrors the original Flow Writer's `Statistics.countWords`, which normalised
 * newlines and runs of spaces before splitting. Exported so it can be unit
 * tested without a view.
 */
export function countWords(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\s+/).length;
}

/**
 * `total` is a thunk rather than a number so that counting the whole note —
 * which is O(document) and materialises the rope — never happens in the default
 * "session" mode, where it would run on every single keystroke.
 */
function label(session: number, total: () => number, mode: WordCountMode): string {
	const words = `${session} ${session === 1 ? "word" : "words"}`;
	return mode === "session-and-total" ? `${words} · ${total()} total` : words;
}

export function wordCountExtension(getMode: () => WordCountMode): Extension {
	return ViewPlugin.fromClass(
		class {
			private el: HTMLElement | null = null;

			/**
			 * The document offset the session started at.
			 *
			 * Captured on first activation and held, because the session's own
			 * seal point advances with every word written — reading it live
			 * would always report zero words written.
			 */
			private entryOffset: number | null = null;

			private lastMode: WordCountMode | null = null;
			private lastActive = false;

			constructor(view: EditorView) {
				this.render(view);
			}

			update(update: ViewUpdate) {
				// Counting the whole note is O(doc), so only recount when
				// something that can change the number happened. `getMode()`
				// is read every update and never cached, so a settings change
				// takes effect on the next keystroke without a reload.
				const active = getFlowSession(update.state) !== null;
				if (
					!update.docChanged &&
					getMode() === this.lastMode &&
					active === this.lastActive
				) {
					return;
				}
				this.render(update.view);
			}

			destroy() {
				this.teardown();
			}

			private render(view: EditorView) {
				const session = getFlowSession(view.state);
				const mode = getMode();
				this.lastMode = mode;
				this.lastActive = session !== null;

				// Covers both "this editor was never in flow" and "flow just
				// ended" — the element must not outlive the session.
				if (!session) {
					this.teardown();
					this.entryOffset = null;
					return;
				}

				// Hiding the counter must not forget where the session began,
				// or turning it back on mid-session would restart the count
				// from the current word and under-report.
				if (mode === "off") {
					this.teardown();
					return;
				}

				if (this.entryOffset === null) this.entryOffset = session.sealPoint;

				const doc = view.state.doc;
				const from = Math.min(this.entryOffset, doc.length);

				if (!this.el) {
					// createElement + textContent only: Obsidian's community
					// plugin guidelines forbid innerHTML.
					this.el = document.createElement("div");
					this.el.className = WORD_COUNT_CLASS;
					view.dom.appendChild(this.el);
				}
				this.el.textContent = label(
					countWords(doc.sliceString(from)),
					() => countWords(doc.toString()),
					mode
				);
			}

			private teardown() {
				this.el?.remove();
				this.el = null;
			}
		}
	);
}
