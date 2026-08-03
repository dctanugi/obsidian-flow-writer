/**
 * Session lifecycle — entering and leaving flow mode.
 *
 * Enter is a handful of independent effects (lock, class, full screen, guards,
 * listeners); exit is the same list run backwards. The asymmetry that matters
 * is that enter is allowed to fail loudly and do nothing, while exit must always
 * succeed: a half-restored workspace leaves the user in a locked editor with no
 * obvious way out. So `exit()` is unconditional, null-safe and idempotent, and
 * every teardown step is independent of the others.
 *
 * Full screen follows the approach ProZen proved in this vault (PRD §6.3): the
 * request goes to the *leaf's* container, not the window, so the ribbon, side
 * panes, tab bar and status bar are excluded by the browser rather than by CSS
 * we would have to maintain against theme updates.
 */

import { MarkdownView, Notice } from "obsidian";
import type { App, EventRef, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";

import { installDomGuards } from "./guards";
import { enterFlowSpec, exitFlowSpec } from "./lock";
import { FLOW_CONTAINER_CLASS, SEALED_OPACITY_VAR } from "./types";
import type { FlowSettings } from "./types";

/** Optional chrome hiding, paired with rules in styles.css. */
const HIDE_PROPERTIES_CLASS = "flow-writer-hide-properties";
const HIDE_INLINE_TITLE_CLASS = "flow-writer-hide-inline-title";

const PRECONDITION_NOTICE = "Flow Writer: open a note in editing mode first";

/**
 * Stop retrying full screen after this many refusals and tell the user once,
 * rather than silently fighting the platform on every keystroke (PRD §6.4).
 */
const MAX_FULLSCREEN_ATTEMPTS = 3;

/**
 * Unofficial API. Obsidian's `Editor` wraps a CodeMirror 6 `EditorView` on a
 * `cm` property that is not in the public typings. There is no documented way
 * to reach the view, and we need it to dispatch the flow-mode effect.
 *
 * Shape-checked rather than cast, so a future Obsidian that renames or removes
 * this degrades into a Notice instead of a thrown exception.
 */
function getEditorView(view: MarkdownView): EditorView | null {
	const candidate = (view.editor as unknown as { cm?: unknown }).cm;
	if (!candidate || typeof candidate !== "object") return null;

	const probe = candidate as { state?: unknown; dispatch?: unknown };
	if (!probe.state || typeof probe.dispatch !== "function") return null;

	return candidate as EditorView;
}

/**
 * Unofficial API. `WorkspaceLeaf.containerEl` exists but is untyped; the
 * documented `View.containerEl` is one level down, inside the leaf. Either can
 * go full screen, and either excludes the workspace chrome, so falling back to
 * the documented one costs us only the leaf's own padding.
 */
function getFlowContainer(view: MarkdownView): HTMLElement {
	const leafEl = (view.leaf as unknown as { containerEl?: unknown }).containerEl;
	return leafEl instanceof HTMLElement ? leafEl : view.containerEl;
}

export class FlowSessionController {
	private readonly app: App;
	private readonly getSettings: () => FlowSettings;

	private active = false;
	private view: MarkdownView | null = null;
	private editorView: EditorView | null = null;
	private containerEl: HTMLElement | null = null;
	private file: TFile | null = null;

	/** Every listener, guard and event ref opened by the running session. */
	private cleanups: Array<() => void> = [];
	/** Tracked separately because it is armed and disarmed mid-session. */
	private retryCleanup: (() => void) | null = null;
	private fullscreenAttempts = 0;
	private warnedAboutFullscreen = false;

	constructor(app: App, getSettings: () => FlowSettings) {
		this.app = app;
		this.getSettings = getSettings;
	}

	toggle(): void {
		if (this.active) {
			this.exit();
			return;
		}
		this.enter();
	}

	isActive(): boolean {
		return this.active;
	}

	/** Re-apply anything a settings change could have invalidated. */
	refresh(): void {
		if (!this.active) return;
		this.applyAppearance();
	}

	destroy(): void {
		this.exit();
	}

	private enter(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice(PRECONDITION_NOTICE);
			return;
		}

		// "preview" is Reading mode; "source" covers both Live Preview and
		// Source mode, which are the two we can write in. We never switch the
		// user's mode for them (PRD §6.0).
		if (view.getMode() !== "source") {
			new Notice(PRECONDITION_NOTICE);
			return;
		}

		const editorView = getEditorView(view);
		if (!editorView) {
			new Notice("Flow Writer: could not reach this editor, so flow mode is unavailable");
			return;
		}

		const containerEl = getFlowContainer(view);

		this.view = view;
		this.editorView = editorView;
		this.containerEl = containerEl;
		this.file = view.file;
		this.fullscreenAttempts = 0;
		this.warnedAboutFullscreen = false;
		this.active = true;

		this.applyAppearance();
		editorView.dispatch(enterFlowSpec(editorView.state));

		const uninstallGuards = installDomGuards(containerEl, {
			shouldEscExit: () => this.getSettings().escExits,
			onEscExit: () => this.exit(),
		});
		this.cleanups.push(uninstallGuards);

		document.addEventListener("fullscreenchange", this.onFullscreenChange);
		this.cleanups.push(() => {
			document.removeEventListener("fullscreenchange", this.onFullscreenChange);
		});

		// Fail-safe. If a note switch slips past the guards, exiting cleanly
		// beats leaving a locked editor pointed at the wrong file (PRD §6.1).
		const fileOpenRef: EventRef = this.app.workspace.on("file-open", (file) => {
			this.onFileOpen(file);
		});
		this.cleanups.push(() => this.app.workspace.offref(fileOpenRef));

		this.requestFullscreen(containerEl);
		editorView.focus();
	}

	/**
	 * Unconditional teardown. Deliberately has no `if (!this.active) return`
	 * guard: every step is a no-op on a clean controller, and an exit that
	 * refuses to run because a flag got out of sync is the one failure mode
	 * that strands the user.
	 */
	exit(): void {
		this.active = false;

		this.disarmFullscreenRetry();

		const cleanups = this.cleanups;
		this.cleanups = [];
		for (const cleanup of cleanups) cleanup();

		// The editor may already be gone — the leaf could have been closed out
		// from under us — so unlocking is best-effort and never blocks the rest
		// of the restore.
		if (this.editorView) {
			try {
				this.editorView.dispatch(exitFlowSpec());
			} catch {
				// Nothing useful to do: the state we were unlocking no longer exists.
			}
		}

		const containerEl = this.containerEl;
		if (containerEl) {
			containerEl.classList.remove(
				FLOW_CONTAINER_CLASS,
				HIDE_PROPERTIES_CLASS,
				HIDE_INLINE_TITLE_CLASS,
			);
			containerEl.style.removeProperty(SEALED_OPACITY_VAR);

			// Only release full screen if it is still *ours*. After an Esc-driven
			// drop it is already null, and if something else has since taken it
			// we must not yank it away.
			if (document.fullscreenElement === containerEl) {
				void document.exitFullscreen().catch(() => undefined);
			}
		}

		this.view = null;
		this.editorView = null;
		this.containerEl = null;
		this.file = null;
	}

	/** Scoping class plus the settings-driven variants and the opacity value. */
	private applyAppearance(): void {
		const containerEl = this.containerEl;
		if (!containerEl) return;

		const settings = this.getSettings();
		containerEl.classList.add(FLOW_CONTAINER_CLASS);
		containerEl.classList.toggle(HIDE_PROPERTIES_CLASS, settings.hideProperties);
		containerEl.classList.toggle(HIDE_INLINE_TITLE_CLASS, settings.hideInlineTitle);
		containerEl.style.setProperty(SEALED_OPACITY_VAR, String(settings.sealedOpacity));
	}

	private onFileOpen(file: TFile | null): void {
		if (!this.active) return;

		// `file-open` also fires for re-focus on the same note, which is not a
		// reason to tear a session down.
		const sameFile = file !== null && this.file !== null && file.path === this.file.path;
		const sameView = this.app.workspace.getActiveViewOfType(MarkdownView) === this.view;
		if (sameFile && sameView) return;

		this.exit();
	}

	private onFullscreenChange = (): void => {
		if (!this.active) return;

		if (document.fullscreenElement) {
			// Back in full screen, so the budget is spent per *drop-out*, not
			// per session — otherwise one recovered drop would silently disable
			// recovery for the rest of the session.
			this.fullscreenAttempts = 0;
			this.disarmFullscreenRetry();
			return;
		}

		// Chromium exits full screen on Esc at the browser level and a page
		// cannot cancel it. So a drop out of full screen is ambiguous: it might
		// be the user leaving, or it might be Esc arriving with the setting off.
		if (this.getSettings().escExits) {
			this.exit();
			return;
		}

		// Setting is off, so the session survives — lock, dimming and hidden
		// chrome all persist. Full screen needs a fresh user gesture to come
		// back, and the next keystroke is one (PRD §6.4).
		this.armFullscreenRetry();
	};

	private armFullscreenRetry(): void {
		const containerEl = this.containerEl;
		if (!containerEl) return;
		if (this.retryCleanup) return;
		if (this.fullscreenAttempts >= MAX_FULLSCREEN_ATTEMPTS) return;

		const onKeyDown = (event: KeyboardEvent): void => {
			// Escape does not grant user activation in Chromium, so it can never
			// pay for a full screen request. Wait for a real keystroke.
			if (event.key === "Escape") return;

			this.disarmFullscreenRetry();
			this.requestFullscreen(containerEl);
		};

		// Passive listener in capture phase: this watches for the gesture, it
		// does not consume it. The keystroke must still reach the editor.
		containerEl.addEventListener("keydown", onKeyDown, true);
		this.retryCleanup = () => {
			containerEl.removeEventListener("keydown", onKeyDown, true);
		};
	}

	private disarmFullscreenRetry(): void {
		if (!this.retryCleanup) return;
		this.retryCleanup();
		this.retryCleanup = null;
	}

	private requestFullscreen(containerEl: HTMLElement): void {
		this.fullscreenAttempts += 1;

		let request: Promise<void>;
		try {
			request = containerEl.requestFullscreen();
		} catch {
			this.onFullscreenRefused();
			return;
		}

		void request.then(
			() => {
				// Entering full screen reparents the element, which can drop
				// focus and leave keystrokes going nowhere.
				this.editorView?.focus();
			},
			() => this.onFullscreenRefused(),
		);
	}

	/**
	 * Windowed flow mode is a degraded session, not a broken one — the lock and
	 * the dimming are what the plugin is actually for. So we say so once and
	 * carry on rather than tearing the session down under the user.
	 */
	private onFullscreenRefused(): void {
		if (!this.active) return;
		if (this.warnedAboutFullscreen) return;
		if (this.fullscreenAttempts < MAX_FULLSCREEN_ATTEMPTS) {
			this.armFullscreenRetry();
			return;
		}

		this.warnedAboutFullscreen = true;
		new Notice(
			"Flow Writer: full screen was refused. The flow session is still running — " +
				"use the toggle command to leave it.",
			8000,
		);
	}
}
