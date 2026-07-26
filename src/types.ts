/** Shared settings contract. Pure data — no Obsidian imports. */

export type WordCountMode = "off" | "session" | "session-and-total";

export interface FlowSettings {
	/** Opacity applied to sealed text. */
	sealedOpacity: number;
	/** Whether Esc leaves flow mode. */
	escExits: boolean;
	wordCount: WordCountMode;
	typewriterCentering: boolean;
	hideProperties: boolean;
	hideInlineTitle: boolean;
}

export const DEFAULT_SETTINGS: FlowSettings = {
	sealedOpacity: 0.25,
	escExits: true,
	wordCount: "session",
	typewriterCentering: true,
	hideProperties: true,
	hideInlineTitle: true,
};

export const SEALED_OPACITY_MIN = 0.05;
export const SEALED_OPACITY_MAX = 0.6;

/** Class applied to the flow leaf's containerEl; scopes every style we add. */
export const FLOW_CONTAINER_CLASS = "flow-writer-active";
/** Class applied to sealed text ranges by the dimming decoration. */
export const SEALED_TEXT_CLASS = "flow-writer-sealed";
/** CSS custom property carrying the user's opacity setting. */
export const SEALED_OPACITY_VAR = "--flow-writer-sealed-opacity";
