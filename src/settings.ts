import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	DEFAULT_SETTINGS,
	SEALED_OPACITY_MAX,
	SEALED_OPACITY_MIN,
	type FlowSettings,
	type WordCountMode,
} from "./types";

/**
 * What the settings tab needs from the plugin. Declared as an interface rather
 * than importing the plugin class so that settings.ts and main.ts don't import
 * each other.
 */
export interface FlowSettingsHost extends Plugin {
	settings: FlowSettings;
	saveSettings(): Promise<void>;
}

/** Merge stored data over the defaults, tolerating a missing or partial data.json. */
export function normalizeSettings(stored: unknown): FlowSettings {
	const raw = (stored ?? {}) as Partial<FlowSettings>;
	const settings: FlowSettings = { ...DEFAULT_SETTINGS, ...raw };

	// A corrupted or hand-edited opacity could make the note invisible or
	// undim it entirely, and there is no in-app way to notice that is what
	// happened, so clamp rather than trust.
	if (typeof settings.sealedOpacity !== "number" || Number.isNaN(settings.sealedOpacity)) {
		settings.sealedOpacity = DEFAULT_SETTINGS.sealedOpacity;
	}
	settings.sealedOpacity = Math.min(
		SEALED_OPACITY_MAX,
		Math.max(SEALED_OPACITY_MIN, settings.sealedOpacity)
	);

	const modes: WordCountMode[] = ["off", "session", "session-and-total"];
	if (!modes.includes(settings.wordCount)) {
		settings.wordCount = DEFAULT_SETTINGS.wordCount;
	}

	return settings;
}

export class FlowSettingTab extends PluginSettingTab {
	private host: FlowSettingsHost;

	constructor(app: App, host: FlowSettingsHost) {
		super(app, host);
		this.host = host;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Sealed text opacity")
			.setDesc(
				"How faint already-written text becomes in flow mode. Lower is more distraction-free."
			)
			.addSlider((slider) =>
				slider
					.setLimits(SEALED_OPACITY_MIN, SEALED_OPACITY_MAX, 0.05)
					.setValue(this.host.settings.sealedOpacity)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.host.settings.sealedOpacity = value;
						await this.host.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Esc exits flow mode")
			.setDesc(
				"Turn this off if leaving flow mode should take deliberate intent. You can always leave via the command palette or your hotkey."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.escExits).onChange(async (value) => {
					this.host.settings.escExits = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Word count")
			.setDesc("A faint counter in the corner of the screen while writing.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("off", "Hidden")
					.addOption("session", "This session")
					.addOption("session-and-total", "This session and note total")
					.setValue(this.host.settings.wordCount)
					.onChange(async (value) => {
						this.host.settings.wordCount = value as WordCountMode;
						await this.host.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Typewriter centering")
			.setDesc(
				"Keep the line you are writing vertically centered. Turn this off if you already use a typewriter-scroll plugin."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.typewriterCentering).onChange(async (value) => {
					this.host.settings.typewriterCentering = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl).setName("Hidden in flow mode").setHeading();

		new Setting(containerEl)
			.setName("Note properties")
			.setDesc("Hide the frontmatter properties panel.")
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.hideProperties).onChange(async (value) => {
					this.host.settings.hideProperties = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Inline title")
			.setDesc("Hide the note title shown above the text.")
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.hideInlineTitle).onChange(async (value) => {
					this.host.settings.hideInlineTitle = value;
					await this.host.saveSettings();
				})
			);
	}
}
