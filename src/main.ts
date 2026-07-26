import { Plugin } from "obsidian";

import { flowDecorationsExtension } from "./decorations";
import { flowGuardsExtension } from "./guards";
import { flowLockExtension } from "./lock";
import { FlowSessionController } from "./session";
import { FlowSettingTab, normalizeSettings, type FlowSettingsHost } from "./settings";
import { typewriterExtension } from "./typewriter";
import type { FlowSettings } from "./types";
import { wordCountExtension } from "./wordcount";

export default class FlowWriterPlugin extends Plugin implements FlowSettingsHost {
	// Assigned in onload. `session` is genuinely optional rather than asserted,
	// because onunload still runs if onload threw part-way through.
	settings!: FlowSettings;
	private session?: FlowSessionController;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.session = new FlowSessionController(this.app, () => this.settings);

		// Registered once, for every editor in the app. Each extension is inert
		// unless that editor holds a flow session, which is what keeps the rest
		// of the vault behaving normally (PRD §7.3).
		//
		// The lock comes first so its transaction filter is the outermost gate.
		this.registerEditorExtension([
			flowLockExtension(),
			flowGuardsExtension(),
			flowDecorationsExtension(),
			wordCountExtension(() => this.settings.wordCount),
			typewriterExtension(() => this.settings.typewriterCentering),
		]);

		this.addCommand({
			id: "toggle-flow-mode",
			name: "Toggle flow mode",
			callback: () => this.session?.toggle(),
		});

		this.addSettingTab(new FlowSettingTab(this.app, this));
	}

	onunload(): void {
		// Leaving a session running would strand the user in a locked, chromeless
		// editor with the command that releases it no longer registered.
		this.session?.destroy();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.session?.refresh();
	}
}
