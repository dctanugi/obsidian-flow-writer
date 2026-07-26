/**
 * Typewriter centering — keep the line being written in the middle of the
 * screen so the eye stays still. See docs/PRD.md §6.7.
 *
 * The bottom padding that lets the *last* line reach the middle of the screen
 * is a CSS concern and lives in styles.css; this module only scrolls.
 */

import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { isFlowActive } from "./lock";

export function typewriterExtension(isEnabled: () => boolean): Extension {
	return ViewPlugin.fromClass(
		class {
			private frame = 0;
			private pending = -1;

			constructor(private readonly view: EditorView) {}

			update(update: ViewUpdate) {
				// Scrolling is driven by writing, not by the caret moving —
				// in flow mode the caret only ever moves because text was
				// typed, and reacting to selection would fight the lock's
				// cursor pinning.
				if (!update.docChanged) return;

				// Gated on both the session and the live setting, re-read on
				// every update so toggling the setting needs no reload.
				if (!isFlowActive(update.state) || !isEnabled()) {
					this.cancel();
					return;
				}

				const pos = update.state.selection.main.head;
				if (pos === this.pending) return;
				this.pending = pos;

				// Dispatching from inside `update` is illegal in CodeMirror
				// and would re-enter the update cycle; deferring a frame both
				// satisfies that and coalesces bursts of fast typing into a
				// single scroll.
				if (this.frame !== 0) return;
				this.frame = requestAnimationFrame(() => {
					this.frame = 0;
					const target = this.pending;
					if (target < 0 || target > this.view.state.doc.length) return;
					// Re-check: the session may have ended between the update
					// and this frame.
					if (!isFlowActive(this.view.state) || !isEnabled()) return;
					this.view.dispatch({
						effects: EditorView.scrollIntoView(target, { y: "center" }),
					});
				});
			}

			destroy() {
				this.cancel();
			}

			private cancel() {
				if (this.frame !== 0) cancelAnimationFrame(this.frame);
				this.frame = 0;
				this.pending = -1;
			}
		}
	);
}
