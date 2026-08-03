import { App, Plugin, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
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

	/** Declarative settings for Obsidian 1.13.0+ (settings search support). */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Sealed text opacity",
				desc: "How faint already-written text becomes in flow mode. Lower is more distraction-free.",
				control: {
					type: "slider",
					key: "sealedOpacity",
					min: SEALED_OPACITY_MIN,
					max: SEALED_OPACITY_MAX,
					step: 0.05,
				},
			},
			{
				name: "Esc exits flow mode",
				desc: "Turn this off if leaving flow mode should take deliberate intent. You can always leave via the command palette or your hotkey.",
				control: { type: "toggle", key: "escExits" },
			},
			{
				name: "Word count",
				desc: "A faint counter in the corner of the screen while writing.",
				control: {
					type: "dropdown",
					key: "wordCount",
					options: {
						off: "Hidden",
						session: "This session",
						"session-and-total": "This session and note total",
					},
				},
			},
			{
				name: "Typewriter centering",
				desc: "Keep the line you are writing vertically centered. Turn this off if you already use a typewriter-scroll plugin.",
				control: { type: "toggle", key: "typewriterCentering" },
			},
			{
				type: "group",
				heading: "Hidden in flow mode",
				items: [
					{
						name: "Note properties",
						desc: "Hide the frontmatter properties panel.",
						control: { type: "toggle", key: "hideProperties" },
					},
					{
						name: "Inline title",
						desc: "Hide the note title shown above the text.",
						control: { type: "toggle", key: "hideInlineTitle" },
					},
				],
			},
		];
	}

	/**
	 * Override so that changes go through saveSettings(), which also triggers
	 * session.refresh() to apply class changes live during an active session.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.host.settings as unknown as Record<string, unknown>)[key] = value;
		await this.host.saveSettings();
	}

	/** Fallback for Obsidian < 1.13.0, which doesn't call getSettingDefinitions(). */
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
