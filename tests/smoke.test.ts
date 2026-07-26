import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
	flowLockExtension,
	enterFlowSpec,
	getFlowSession,
} from "../src/lock";

function fresh(doc = "") {
	let state = EditorState.create({ doc, extensions: [flowLockExtension()] });
	state = state.update(enterFlowSpec(state)).state;
	return state;
}

/** Simulate typing text one character at a time at the caret. */
function type(state: EditorState, text: string) {
	for (const ch of text) {
		const at = state.selection.main.head;
		state = state.update({
			changes: { from: at, insert: ch },
			selection: { anchor: at + ch.length },
		}).state;
	}
	return state;
}

/** Simulate a backspace at the caret. */
function backspace(state: EditorState) {
	const at = state.selection.main.head;
	if (at === 0) return state;
	return state.update({
		changes: { from: at - 1, to: at },
		selection: { anchor: at - 1 },
	}).state;
}

describe("lock smoke", () => {
	it("seals nothing on an empty doc", () => {
		expect(getFlowSession(fresh())!.sealPoint).toBe(0);
	});

	it("seals all pre-existing content on entry", () => {
		expect(getFlowSession(fresh("already written"))!.sealPoint).toBe(15);
	});

	it("leaves the word in progress live", () => {
		const s = type(fresh(), "hello");
		expect(s.doc.toString()).toBe("hello");
		expect(getFlowSession(s)!.sealPoint).toBe(0);
	});

	it("backspace works inside the live word", () => {
		const s = backspace(type(fresh(), "hello"));
		expect(s.doc.toString()).toBe("hell");
	});

	it("space seals the word", () => {
		const s = type(fresh(), "hello ");
		expect(getFlowSession(s)!.sealPoint).toBe(6);
	});

	it("backspace cannot cross the seal", () => {
		let s = type(fresh(), "hello ");
		s = backspace(s);
		expect(s.doc.toString()).toBe("hello ");
	});

	it("newline seals too", () => {
		const s = type(fresh(), "hello\n");
		expect(getFlowSession(s)!.sealPoint).toBe(6);
	});

	it("punctuation does not seal", () => {
		const s = type(fresh(), "wait.");
		expect(getFlowSession(s)!.sealPoint).toBe(0);
		expect(backspace(s).doc.toString()).toBe("wait");
	});

	it("rejects a bulk replace of sealed text", () => {
		const s0 = fresh("some existing prose");
		const s1 = s0.update({ changes: { from: 0, to: 19, insert: "gone" } }).state;
		expect(s1.doc.toString()).toBe("some existing prose");
	});

	it("keeps the tail live after a multi-char insert containing a space", () => {
		const s = fresh();
		const s1 = s.update({ changes: { from: 0, insert: "hello wor" }, selection: { anchor: 9 } }).state;
		expect(getFlowSession(s1)!.sealPoint).toBe(6);
		expect(backspace(s1).doc.toString()).toBe("hello wo");
	});

	it("rejects moving the caret backwards", () => {
		const s = type(fresh(), "hello world");
		const moved = s.update({ selection: { anchor: 2 } }).state;
		expect(moved.selection.main.head).toBe(11);
	});

	it("never shortens the document under a barrage of illegal edits", () => {
		let s = fresh("precious existing text");
		const before = s.doc.toString();
		for (let i = 0; i < 22; i++) {
			s = s.update({ changes: { from: i, to: i + 1, insert: "" } }).state;
			s = backspace(s);
		}
		expect(s.doc.toString()).toBe(before);
	});
});
