import { describe, it, expect } from "vitest";
import {
	EditorSelection,
	EditorState,
	StateEffect,
	type Extension,
	type Text,
} from "@codemirror/state";
import {
	computeSealPoint,
	enterFlowSpec,
	exitFlowSpec,
	flowLockExtension,
	flowSessionField,
	getFlowSession,
	isFlowActive,
	isWordBoundary,
	setFlowSession,
} from "../src/lock";

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

/** An editor with the lock registered but *not* in flow mode. */
function mk(doc = "", extensions: Extension[] = []): EditorState {
	return EditorState.create({ doc, extensions: [flowLockExtension(), ...extensions] });
}

/** An editor already in flow mode. */
function fresh(doc = "", extensions: Extension[] = []): EditorState {
	const state = mk(doc, extensions);
	return state.update(enterFlowSpec(state)).state;
}

/** The seal point of a state that is in flow mode. Throws if it is not. */
function seal(state: EditorState): number {
	const session = getFlowSession(state);
	if (!session) throw new Error("not in flow mode");
	return session.sealPoint;
}

function text(state: EditorState): string {
	return state.doc.toString();
}

/** Simulate typing text one character at a time at the caret. */
function type(state: EditorState, input: string): EditorState {
	for (const ch of input) {
		const at = state.selection.main.head;
		state = state.update({
			changes: { from: at, insert: ch },
			selection: { anchor: at + ch.length },
		}).state;
	}
	return state;
}

/** Insert a whole string in one transaction, caret following it. */
function insert(state: EditorState, at: number, input: string): EditorState {
	return state.update({
		changes: { from: at, insert: input },
		selection: { anchor: at + input.length },
	}).state;
}

/** Simulate a backspace at the caret, deleting `units` UTF-16 code units. */
function backspace(state: EditorState, units = 1): EditorState {
	const at = state.selection.main.head;
	if (at === 0) return state;
	const from = Math.max(0, at - units);
	return state.update({
		changes: { from, to: at },
		selection: { anchor: from },
	}).state;
}

/** Delete an explicit range, wherever it is. */
function deleteRange(state: EditorState, from: number, to: number): EditorState {
	return state.update({ changes: { from, to, insert: "" } }).state;
}

/** A bare document, for testing the pure functions without any editor. */
function docOf(str: string): Text {
	return EditorState.create({ doc: str }).doc;
}

/** True when `offset` splits a surrogate pair in `str`. */
function splitsSurrogatePair(str: string, offset: number): boolean {
	if (offset <= 0 || offset >= str.length) return false;
	const before = str.charCodeAt(offset - 1);
	const after = str.charCodeAt(offset);
	return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Deterministic PRNG so the property test is reproducible. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/* ------------------------------------------------------------------ *
 * pure functions
 * ------------------------------------------------------------------ */

describe("isWordBoundary", () => {
	it("treats the three documented boundaries as boundaries", () => {
		expect(isWordBoundary(" ")).toBe(true);
		expect(isWordBoundary("\t")).toBe(true);
		expect(isWordBoundary("\n")).toBe(true);
	});

	it("treats carriage return, vertical tab and form feed as boundaries", () => {
		expect(isWordBoundary("\r")).toBe(true);
		expect(isWordBoundary("\v")).toBe(true);
		expect(isWordBoundary("\f")).toBe(true);
	});

	it("does not treat punctuation as a boundary", () => {
		for (const ch of ".,!?;:'\"-—…()[]{}*_#`/\\") {
			expect(isWordBoundary(ch), `expected ${JSON.stringify(ch)} not to seal`).toBe(false);
		}
	});

	it("does not treat letters, digits or emoji halves as boundaries", () => {
		for (const ch of "aZ9é日\u{1F44D}") {
			expect(isWordBoundary(ch)).toBe(false);
		}
	});

	it("treats non-breaking space and other Unicode spaces as boundaries", () => {
		// /\s/ is broader than "space, tab, newline": everything in the Unicode
		// space separator category seals too.
		expect(isWordBoundary(" ")).toBe(true); // NBSP
		expect(isWordBoundary(" ")).toBe(true); // en quad
		expect(isWordBoundary(" ")).toBe(true); // thin space
		expect(isWordBoundary(" ")).toBe(true); // narrow NBSP
		expect(isWordBoundary("　")).toBe(true); // ideographic space
		expect(isWordBoundary(" ")).toBe(true); // line separator
		expect(isWordBoundary(" ")).toBe(true); // paragraph separator
		expect(isWordBoundary("﻿")).toBe(true); // zero-width no-break space
	});

	it("does not treat the zero-width space as a boundary", () => {
		// U+200B is not in /\s/, so an invisible character seals in one case
		// (U+FEFF) and not in the other (U+200B). Documented, not asserted as
		// desirable.
		expect(isWordBoundary("​")).toBe(false);
		expect(isWordBoundary("‌")).toBe(false); // ZWNJ
		expect(isWordBoundary("‍")).toBe(false); // ZWJ
	});

	it("reports false for a multi-character string with no whitespace", () => {
		expect(isWordBoundary("ab")).toBe(false);
	});
});

describe("computeSealPoint", () => {
	it("returns 0 for an empty document", () => {
		expect(computeSealPoint(docOf(""), 0)).toBe(0);
	});

	it("returns the seal point unchanged when the live region has no boundary", () => {
		expect(computeSealPoint(docOf("hello"), 0)).toBe(0);
		expect(computeSealPoint(docOf("hello world"), 6)).toBe(6);
	});

	it("returns the seal point unchanged when it already sits at the document end", () => {
		expect(computeSealPoint(docOf("abc"), 3)).toBe(3);
		expect(computeSealPoint(docOf("abc "), 4)).toBe(4);
	});

	it("returns the offset just after the LAST boundary in the live region", () => {
		expect(computeSealPoint(docOf("a b c"), 0)).toBe(4);
		expect(computeSealPoint(docOf("one two three"), 0)).toBe(8);
	});

	it("seals a document that is entirely whitespace right up to its end", () => {
		expect(computeSealPoint(docOf("   "), 0)).toBe(3);
		expect(computeSealPoint(docOf("\n\n\n"), 0)).toBe(3);
		expect(computeSealPoint(docOf(" \t \n "), 0)).toBe(5);
	});

	it("never looks behind the given seal point", () => {
		// The boundary at offset 3 is already sealed; nothing in the live
		// region seals further, so the answer is the input.
		expect(computeSealPoint(docOf("abc def"), 4)).toBe(4);
	});

	it("never returns less than the seal point it was given", () => {
		const doc = docOf("some words here and there");
		for (let i = 0; i <= doc.length; i++) {
			expect(computeSealPoint(doc, i)).toBeGreaterThanOrEqual(i);
		}
	});

	it("returns a result no greater than the document length", () => {
		const doc = docOf("trailing space at end ");
		for (let i = 0; i <= doc.length; i++) {
			expect(computeSealPoint(doc, i)).toBeLessThanOrEqual(doc.length);
		}
	});

	it("counts a trailing newline as the last boundary", () => {
		expect(computeSealPoint(docOf("para\n"), 0)).toBe(5);
		expect(computeSealPoint(docOf("para\n\n"), 0)).toBe(6);
		expect(computeSealPoint(docOf("a\nb\nc"), 0)).toBe(4);
	});

	it("ignores punctuation entirely", () => {
		expect(computeSealPoint(docOf("wait...!?"), 0)).toBe(0);
		expect(computeSealPoint(docOf("no,really.yes"), 0)).toBe(0);
	});

	it("does not treat CJK text as containing boundaries", () => {
		expect(computeSealPoint(docOf("日本語"), 0)).toBe(0);
		expect(computeSealPoint(docOf("日本語 語"), 0)).toBe(4);
	});

	it("never introduces an offset that splits a surrogate pair", () => {
		// The scan indexes by UTF-16 code unit, but a boundary character is
		// always a single code unit, so `i + 1` can never land inside a pair.
		// (A seal point handed in mid-pair is echoed back as-is; the function
		// cannot repair one, it just never creates one.)
		const samples = [
			"\u{1F44D}",
			"a\u{1F44D}b",
			"\u{1F44D} \u{1F44E}",
			"hi \u{1F600}\u{1F601}",
			"\u{1F468}‍\u{1F469}‍\u{1F467} x",
			"\u{1F44D}\n\u{1F44E}",
		];
		for (const sample of samples) {
			const doc = docOf(sample);
			for (let i = 0; i <= doc.length; i++) {
				if (splitsSurrogatePair(sample, i)) continue;
				const result = computeSealPoint(doc, i);
				expect(
					splitsSurrogatePair(sample, result),
					`computeSealPoint(${JSON.stringify(sample)}, ${i}) = ${result}`,
				).toBe(false);
			}
		}
	});

	it("returns the seal point unchanged when it is past the end of the document", () => {
		// Defensive: an out-of-range seal point is echoed back rather than
		// clamped, so nothing downstream sees it shrink.
		expect(computeSealPoint(docOf("abc"), 5)).toBe(5);
		expect(computeSealPoint(docOf(""), 3)).toBe(3);
	});

	it("is off by one for a negative seal point (unreachable, documented)", () => {
		// `sliceString(-1)` returns the whole document, so the returned offset
		// is one short of the real boundary position. Nothing in the module can
		// produce a negative seal point; this pins the behaviour if that ever
		// changes.
		expect(computeSealPoint(docOf("a b"), -1)).toBe(1); // the truthful answer is 2
	});
});

/* ------------------------------------------------------------------ *
 * entering and leaving
 * ------------------------------------------------------------------ */

describe("entering and leaving flow mode", () => {
	it("seals the whole document and pins the caret to its end (L1)", () => {
		const before = mk("already written").update({ selection: { anchor: 0 } }).state;
		const after = before.update(enterFlowSpec(before)).state;
		expect(seal(after)).toBe(15);
		expect(after.selection.main.head).toBe(15);
		expect(after.selection.main.anchor).toBe(15);
	});

	it("seals a multi-line document up to its true end", () => {
		const state = fresh("line one\n\nline two");
		expect(seal(state)).toBe(18);
		expect(state.doc.lines).toBe(3);
	});

	it("seals the trailing blank lines of a note that ends in a newline", () => {
		// The seal point is the document end, boundary or not — a note ending
		// in "\n\n" starts with everything, including both newlines, sealed.
		const state = fresh("para one\n\n");
		expect(seal(state)).toBe(10);
		expect(state.doc.length).toBe(10);
		expect(state.selection.main.head).toBe(10);
	});

	it("seals leading whitespace as ordinary sealed content", () => {
		expect(seal(fresh("   leading"))).toBe(10);
		expect(seal(fresh("\n\n\n"))).toBe(3);
	});

	it("reports flow mode as active only after entry", () => {
		const state = mk("x");
		expect(isFlowActive(state)).toBe(false);
		expect(getFlowSession(state)).toBeNull();
		expect(isFlowActive(state.update(enterFlowSpec(state)).state)).toBe(true);
	});

	it("re-seals the word in progress when flow mode is entered twice", () => {
		let state = type(fresh("abc"), "de ");
		expect(seal(state)).toBe(6);
		state = type(state, "fg");
		expect(seal(state)).toBe(6);
		const again = state.update(enterFlowSpec(state)).state;
		expect(seal(again)).toBe(8);
		expect(again.selection.main.head).toBe(8);
		// The word that was live a moment ago is now immutable.
		expect(text(backspace(again))).toBe("abcde fg");
	});

	it("is a no-op to leave flow mode when it was never entered", () => {
		const state = mk("z");
		const left = state.update(exitFlowSpec()).state;
		expect(getFlowSession(left)).toBeNull();
		expect(text(left)).toBe("z");
	});

	it("restores full editability after leaving", () => {
		let state = fresh("hello");
		expect(text(deleteRange(state, 0, 5))).toBe("hello");
		state = state.update(exitFlowSpec()).state;
		expect(getFlowSession(state)).toBeNull();
		expect(text(state.update({ changes: { from: 0, to: 5, insert: "bye" } }).state)).toBe("bye");
	});

	it("starts a fresh session with a lower seal point after an exit and edit", () => {
		// L6 is a within-session guarantee. Leaving flow mode ends the session,
		// so a later session on a shorter document seals less.
		let state = fresh("hello world");
		expect(seal(state)).toBe(11);
		state = state.update(exitFlowSpec()).state;
		state = state.update({ changes: { from: 0, to: 11, insert: "hi" } }).state;
		state = state.update(enterFlowSpec(state)).state;
		expect(seal(state)).toBe(2);
	});

	it("leaves the field null in an editor that never received the effect", () => {
		const a = mk("one");
		const b = mk("two");
		const aFlow = a.update(enterFlowSpec(a)).state;
		expect(seal(aFlow)).toBe(3);
		expect(getFlowSession(b)).toBeNull();
		// ...and that editor is completely unlocked.
		expect(text(b.update({ changes: { from: 0, to: 3, insert: "gone" } }).state)).toBe("gone");
	});

	it("reports null for a state that does not have the extension at all", () => {
		const bare = EditorState.create({ doc: "x" });
		expect(bare.field(flowSessionField, false)).toBeUndefined();
		expect(getFlowSession(bare)).toBeNull();
		expect(isFlowActive(bare)).toBe(false);
		// Even the enter spec cannot lock an editor with no field registered.
		expect(getFlowSession(bare.update(enterFlowSpec(bare)).state)).toBeNull();
	});

	it("keeps the session across a reconfiguration that re-adds the extension", () => {
		const state = fresh("abc");
		const reconfigured = state.update({
			effects: StateEffect.reconfigure.of([flowLockExtension()]),
		}).state;
		expect(seal(reconfigured)).toBe(3);
	});

	it("does not treat an unrelated effect as an enter or exit", () => {
		const unrelated = StateEffect.define<number>();
		const state = fresh("abc").update({ effects: unrelated.of(1) }).state;
		expect(seal(state)).toBe(3);
	});
});

/* ------------------------------------------------------------------ *
 * sealing rules
 * ------------------------------------------------------------------ */

describe("sealing on word boundaries", () => {
	it("advances the seal past a tab (L4)", () => {
		expect(seal(type(fresh(), "hello\t"))).toBe(6);
	});

	it("advances the seal past each of a run of spaces", () => {
		const state = type(fresh(), "hello   ");
		expect(seal(state)).toBe(8);
		expect(text(backspace(state))).toBe("hello   ");
	});

	it("seals to just after the LAST boundary of a multi-character insert", () => {
		// Note: the PRD's L4 wording says "advances to the new end of the
		// document"; the implementation advances to just after the last
		// boundary, leaving the tail of the insert live. The latter is what
		// makes a pasted-then-typed tail editable.
		const state = insert(fresh(), 0, "hello world and");
		expect(seal(state)).toBe(12);
		expect(text(backspace(state))).toBe("hello world an");
	});

	it("seals through the last boundary when whitespace lands mid-word", () => {
		let state = type(fresh(), "abcd");
		state = state.update({ changes: { from: 2, insert: " " } }).state;
		expect(text(state)).toBe("ab cd");
		expect(seal(state)).toBe(3);
	});

	it("does not advance the seal for punctuation (L5)", () => {
		for (const punctuation of [".", ",", "!", "?", ";", ":", "-", "'", '"', "…"]) {
			const state = type(fresh(), `word${punctuation}`);
			expect(seal(state), `${punctuation} must not seal`).toBe(0);
		}
	});

	it("keeps a whole punctuated sentence live until a space arrives", () => {
		let state = type(fresh(), "wait...");
		expect(seal(state)).toBe(0);
		state = type(state, " ");
		expect(seal(state)).toBe(8);
	});

	it("seals on a non-breaking space", () => {
		const state = type(fresh(), "word ");
		expect(seal(state)).toBe(5);
		expect(text(backspace(state))).toBe("word ");
	});

	it("seals on an ideographic space after CJK text", () => {
		const state = type(fresh(), "日本語　");
		expect(seal(state)).toBe(4);
		expect(text(backspace(state))).toBe("日本語　");
	});

	it("does not seal on a zero-width space", () => {
		const state = type(fresh(), "word​");
		expect(seal(state)).toBe(0);
		expect(text(backspace(state))).toBe("word");
	});

	it("seals on U+FEFF even though it is invisible", () => {
		const state = type(fresh(), "word﻿");
		expect(seal(state)).toBe(5);
	});

	it("seals on U+2028 even though CodeMirror does not count it as a line break", () => {
		const state = type(fresh(), "word ");
		expect(state.doc.lines).toBe(1);
		expect(seal(state)).toBe(5);
	});

	it("normalises CRLF to a single newline and seals accordingly", () => {
		// The inserted string is six code units but the document gains only
		// five; the seal arithmetic works off the mapped document, not the
		// insert length.
		const state = fresh().update({ changes: { from: 0, insert: "ab\r\ncd" } }).state;
		expect(text(state)).toBe("ab\ncd");
		expect(state.doc.length).toBe(5);
		expect(seal(state)).toBe(3);
	});

	it("normalises a bare carriage return to a newline and seals accordingly", () => {
		const state = fresh().update({ changes: { from: 0, insert: "ab\rcd" } }).state;
		expect(text(state)).toBe("ab\ncd");
		expect(seal(state)).toBe(3);
	});

	it("advances the seal exactly once, on the space, across a two-word sentence", () => {
		let state = fresh();
		const expected = [0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6];
		let i = 0;
		for (const ch of "hello world") {
			state = type(state, ch);
			expect(seal(state), `after ${i + 1} chars`).toBe(expected[i]);
			i++;
		}
		expect(text(state)).toBe("hello world");
	});

	it("leaves the live word editable right up to the seal boundary", () => {
		let state = type(fresh(), "hello wor");
		state = backspace(state);
		state = backspace(state);
		state = backspace(state);
		expect(text(state)).toBe("hello ");
		expect(state.selection.main.head).toBe(6);
		// One more backspace would touch offset 5, which is sealed.
		expect(text(backspace(state))).toBe("hello ");
	});
});

/* ------------------------------------------------------------------ *
 * rejection of edits before the seal point
 * ------------------------------------------------------------------ */

describe("edits before the seal point", () => {
	it("rejects an insertion in the middle of sealed text (L2)", () => {
		const state = fresh("hello world");
		const after = state.update({ changes: { from: 5, insert: "XXX" } }).state;
		expect(text(after)).toBe("hello world");
		expect(seal(after)).toBe(11);
	});

	it("rejects an insertion at offset 0 of a sealed document", () => {
		const state = fresh("sealed");
		expect(text(state.update({ changes: { from: 0, insert: "x" } }).state)).toBe("sealed");
	});

	it("rejects a single-character deletion anywhere in sealed text", () => {
		const state = fresh("precious text");
		for (let i = 0; i < state.doc.length; i++) {
			expect(text(deleteRange(state, i, i + 1))).toBe("precious text");
		}
	});

	it("rejects a replacement that starts one code unit before the seal", () => {
		let state = type(fresh(), "hello ");
		expect(seal(state)).toBe(6);
		state = type(state, "wor");
		expect(text(deleteRange(state, 5, 9))).toBe("hello wor");
		expect(text(deleteRange(state, 5, 6))).toBe("hello wor");
	});

	it("accepts a deletion that starts exactly at the seal point", () => {
		let state = type(fresh(), "hello ");
		state = type(state, "wor");
		expect(text(deleteRange(state, 6, 9))).toBe("hello ");
	});

	it("rejects a deletion that spans the seal point from both sides", () => {
		let state = type(fresh("intro "), "abc");
		expect(seal(state)).toBe(6);
		expect(text(deleteRange(state, 3, 8))).toBe("intro abc");
	});

	it("rejects an edit that would empty the document", () => {
		const state = fresh("everything");
		expect(text(deleteRange(state, 0, 10))).toBe("everything");
		expect(state.doc.length).toBe(10);
	});

	it("does not disturb the caret or the seal when it rejects an edit", () => {
		const state = fresh("abc");
		const after = state.update({
			changes: { from: 0, to: 1, insert: "" },
			selection: { anchor: 0 },
		}).state;
		expect(text(after)).toBe("abc");
		expect(after.selection.main.head).toBe(3);
		expect(seal(after)).toBe(3);
	});

	it("rejects an insert before the seal point on an empty live region", () => {
		const state = fresh("abc\n");
		expect(seal(state)).toBe(4);
		expect(text(state.update({ changes: { from: 3, insert: "!" } }).state)).toBe("abc\n");
	});
});

describe("edits at or after the seal point", () => {
	it("allows an append at the very end (L3)", () => {
		const state = insert(fresh("intro "), 6, "word");
		expect(text(state)).toBe("intro word");
		expect(seal(state)).toBe(6);
	});

	it("allows deleting the whole live word", () => {
		let state = type(fresh("intro "), "draft");
		state = deleteRange(state, 6, 11);
		expect(text(state)).toBe("intro ");
		expect(seal(state)).toBe(6);
	});

	it("allows replacing the live word with a longer one", () => {
		let state = type(fresh("intro "), "abc");
		state = state.update({ changes: { from: 6, to: 9, insert: "alphabet" } }).state;
		expect(text(state)).toBe("intro alphabet");
		expect(seal(state)).toBe(6);
	});

	it("allows an insert in the middle of the live word", () => {
		let state = type(fresh("intro "), "wrd");
		state = state.update({ changes: { from: 7, insert: "o" } }).state;
		expect(text(state)).toBe("intro word");
		expect(seal(state)).toBe(6);
	});

	it("keeps a newly typed character live rather than born sealed", () => {
		// This is what the `assoc: -1` in the field's mapPos buys.
		const state = type(fresh("hello "), "x");
		expect(seal(state)).toBe(6);
		expect(text(backspace(state))).toBe("hello ");
	});
});

/* ------------------------------------------------------------------ *
 * multi-line documents
 * ------------------------------------------------------------------ */

describe("multi-line and pre-existing documents", () => {
	it("rejects an edit on an earlier line of a multi-line note", () => {
		const state = fresh("first line\nsecond line\nthird line");
		expect(text(deleteRange(state, 0, 11))).toBe("first line\nsecond line\nthird line");
		expect(text(state.update({ changes: { from: 11, insert: "X" } }).state)).toBe(
			"first line\nsecond line\nthird line",
		);
	});

	it("appends new lines to a note that already ends in a blank line", () => {
		let state = fresh("para one\n\n");
		state = type(state, "para two");
		expect(text(state)).toBe("para one\n\npara two");
		// "para " sealed as it was typed; only "two" is still live.
		expect(seal(state)).toBe(15);
		expect(state.doc.lines).toBe(3);
		// The new paragraph is still live and fully editable.
		expect(text(backspace(state))).toBe("para one\n\npara tw");
	});

	it("seals each paragraph break as it is typed", () => {
		let state = type(fresh(), "one");
		state = type(state, "\n");
		expect(seal(state)).toBe(4);
		state = type(state, "\n");
		expect(seal(state)).toBe(5);
		state = type(state, "two");
		expect(seal(state)).toBe(5);
		expect(text(state)).toBe("one\n\ntwo");
		expect(state.doc.lines).toBe(3);
	});

	it("cannot delete a sealed newline by backspacing at the start of a line", () => {
		let state = type(fresh("first\n"), "");
		expect(seal(state)).toBe(6);
		expect(text(backspace(state))).toBe("first\n");
	});

	it("preserves trailing whitespace in the sealed prefix exactly", () => {
		const original = "kept  \t \n  ";
		let state = fresh(original);
		state = type(state, "new");
		expect(state.doc.sliceString(0, original.length)).toBe(original);
		expect(seal(state)).toBe(original.length);
	});

	it("seals a document consisting only of whitespace", () => {
		const state = fresh("   \n\t\n");
		expect(seal(state)).toBe(6);
		expect(text(deleteRange(state, 0, 6))).toBe("   \n\t\n");
	});
});

/* ------------------------------------------------------------------ *
 * unicode
 * ------------------------------------------------------------------ */

describe("unicode in the live word", () => {
	it("counts an emoji as two code units and keeps it live", () => {
		const state = type(fresh(), "hi \u{1F44D}");
		expect(state.doc.length).toBe(5);
		expect(seal(state)).toBe(3);
	});

	it("deletes an emoji cleanly when both of its code units go at once", () => {
		const state = backspace(type(fresh(), "hi \u{1F44D}"), 2);
		expect(text(state)).toBe("hi ");
		expect(seal(state)).toBe(3);
	});

	it("permits a one-code-unit delete that leaves a lone surrogate", () => {
		// The lock is offset-based and does not know about grapheme clusters;
		// a caller that deletes half a pair gets half a pair. Real editors
		// delete by cluster, so this is a characterisation, not an endorsement.
		const state = backspace(type(fresh(), "hi \u{1F44D}"), 1);
		expect(state.doc.length).toBe(4);
		expect([...text(state)].length).toBe(4);
		expect(seal(state)).toBe(3);
	});

	it("seals both code units of an emoji when a space follows it", () => {
		const state = type(fresh(), "\u{1F44D} ");
		expect(state.doc.length).toBe(3);
		expect(seal(state)).toBe(3);
		expect(text(backspace(state))).toBe("\u{1F44D} ");
	});

	it("refuses to split a sealed surrogate pair", () => {
		const state = type(fresh(), "\u{1F44D} ");
		expect(text(deleteRange(state, 1, 3))).toBe("\u{1F44D} ");
		expect(text(deleteRange(state, 0, 2))).toBe("\u{1F44D} ");
		expect(text(deleteRange(state, 1, 2))).toBe("\u{1F44D} ");
	});

	it("keeps the seal arithmetic correct across a ZWJ emoji sequence", () => {
		const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
		const state = type(fresh(), `${family} `);
		expect(state.doc.length).toBe(family.length + 1);
		expect(seal(state)).toBe(family.length + 1);
	});

	it("treats a combining accent as an ordinary live character", () => {
		const state = type(fresh(), "café");
		expect(state.doc.length).toBe(5);
		expect(seal(state)).toBe(0);
		// Backspacing removes the accent, leaving the base letter.
		expect(text(backspace(state))).toBe("cafe");
	});

	it("seals a decomposed word the same way as a precomposed one", () => {
		expect(seal(type(fresh(), "café "))).toBe(5);
		expect(seal(type(fresh(), "café "))).toBe(6);
	});

	it("keeps CJK text live until an ASCII space arrives", () => {
		let state = type(fresh(), "日本語");
		expect(seal(state)).toBe(0);
		expect(text(backspace(state))).toBe("日本");
		state = type(fresh(), "日本語 語");
		expect(seal(state)).toBe(4);
		expect(text(backspace(state))).toBe("日本語 ");
	});

	it("never lets the seal point split a surrogate pair while typing", () => {
		let state = fresh();
		const script = "a \u{1F44D} b\u{1F600}\u{1F601}\n日本 \u{1F44E}";
		for (const ch of script) {
			state = type(state, ch);
			expect(splitsSurrogatePair(text(state), seal(state))).toBe(false);
		}
	});
});

/* ------------------------------------------------------------------ *
 * multi-range transactions
 * ------------------------------------------------------------------ */

describe("transactions with several change ranges", () => {
	it("rejects the whole transaction when any range touches sealed text", () => {
		const state = fresh("hello world");
		const after = state.update({
			changes: [
				{ from: 0, to: 5, insert: "HELLO" },
				{ from: 11, insert: "!" },
			],
		}).state;
		expect(text(after)).toBe("hello world");
		expect(seal(after)).toBe(11);
	});

	it("rejects it whichever order the ranges are given in", () => {
		let state = type(fresh("hello "), "wor");
		const after = state.update({
			changes: [
				{ from: 9, insert: "d" },
				{ from: 1, to: 2, insert: "" },
			],
		}).state;
		expect(text(after)).toBe("hello wor");
	});

	it("applies a multi-range transaction whose ranges are all live", () => {
		let state = type(fresh("keep "), "abcd");
		state = state.update({
			changes: [
				{ from: 5, to: 6, insert: "" },
				{ from: 8, insert: "Z" },
			],
		}).state;
		expect(text(state)).toBe("keep bcZd");
		expect(seal(state)).toBe(5);
	});

	it("rejects a transaction assembled from several specs when one is illegal", () => {
		const state = fresh("keep ");
		const after = state.update(
			{ changes: { from: 5, insert: "ab" } },
			{ changes: { from: 0, to: 1, insert: "X" } },
		).state;
		expect(text(after)).toBe("keep ");
		expect(seal(after)).toBe(5);
	});

	it("rejects a many-range transaction where only the first range is sealed", () => {
		let state = type(fresh("abc "), "defgh");
		const after = state.update({
			changes: [
				{ from: 0, to: 1, insert: "" },
				{ from: 5, to: 6, insert: "X" },
				{ from: 7, to: 8, insert: "Y" },
			],
		}).state;
		expect(text(after)).toBe("abc defgh");
	});
});

/* ------------------------------------------------------------------ *
 * undo and replace-all shapes
 * ------------------------------------------------------------------ */

describe("undo- and replace-all-shaped transactions", () => {
	it("rejects an undo that would rewind through the seal", () => {
		let state = type(fresh("base "), "word ");
		expect(text(state)).toBe("base word ");
		// The inverse of "insert 'word ' at 5" is "delete 5..10".
		expect(text(deleteRange(state, 5, 10))).toBe("base word ");
		expect(seal(state)).toBe(10);
	});

	it("rejects an undo of the very first typed character", () => {
		const state = type(fresh("existing"), "x");
		expect(text(deleteRange(state, 0, 9))).toBe("existingx");
	});

	it("rejects a replace-all over the whole document", () => {
		let state = type(fresh("one two three"), " x");
		const after = state.update({ changes: { from: 0, to: state.doc.length, insert: "nope" } }).state;
		expect(text(after)).toBe("one two three x");
	});

	it("rejects a find-and-replace-shaped transaction hitting several sealed matches", () => {
		const state = fresh("cat and cat and cat");
		const after = state.update({
			changes: [
				{ from: 0, to: 3, insert: "dog" },
				{ from: 8, to: 11, insert: "dog" },
				{ from: 16, to: 19, insert: "dog" },
			],
		}).state;
		expect(text(after)).toBe("cat and cat and cat");
	});

	it("allows a replace-all confined to the live word", () => {
		let state = type(fresh("kept "), "cat");
		state = state.update({ changes: { from: 5, to: 8, insert: "dog" } }).state;
		expect(text(state)).toBe("kept dog");
	});
});

/* ------------------------------------------------------------------ *
 * caret pinning
 * ------------------------------------------------------------------ */

describe("caret pinning", () => {
	it("rejects a selection-only jump to the start of the document", () => {
		const state = type(fresh(), "hello world");
		expect(state.update({ selection: { anchor: 0 } }).state.selection.main.head).toBe(11);
	});

	it("rejects a selection-only jump to one code unit before the end", () => {
		const state = type(fresh(), "hello");
		expect(state.update({ selection: { anchor: 4 } }).state.selection.main.head).toBe(5);
	});

	it("rejects a drag-selection over sealed text", () => {
		const state = type(fresh("sealed "), "live");
		const after = state.update({ selection: EditorSelection.range(0, 11) }).state;
		expect(after.selection.main.anchor).toBe(11);
		expect(after.selection.main.head).toBe(11);
	});

	it("rejects a selection anchored at the end whose head is elsewhere", () => {
		const state = type(fresh(), "hello");
		const after = state.update({ selection: EditorSelection.range(5, 2) }).state;
		expect(after.selection.main.head).toBe(5);
	});

	it("accepts a selection-only transaction that puts the caret at the end", () => {
		const state = type(fresh(), "hello");
		const after = state.update({ selection: EditorSelection.cursor(5) }).state;
		expect(after.selection.main.head).toBe(5);
	});

	it("drops secondary cursors by default, leaving only the pinned one", () => {
		const state = type(fresh(), "hello");
		const after = state.update({
			selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)], 1),
		}).state;
		expect(after.selection.ranges.length).toBe(1);
		expect(after.selection.main.head).toBe(5);
	});

	it("collapses a secondary cursor in sealed text back to the write-head", () => {
		// Obsidian enables EditorState.allowMultipleSelections, so the pin has to
		// reject any selection that is not exactly one cursor at the end —
		// checking `selection.main` alone would leave a stray caret in sealed text.
		const state = fresh("hello", [EditorState.allowMultipleSelections.of(true)]);
		const after = state.update({
			selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)], 1),
		}).state;
		expect(after.selection.ranges.length).toBe(1);
		expect(after.selection.main.head).toBe(5);
		expect(text(deleteRange(after, 0, 1))).toBe("hello");
	});

	it("pins the caret to the write-head when an edit omits a selection", () => {
		// CodeMirror would otherwise map the old caret forward and leave it
		// behind the newly sealed text, where every later keystroke is rejected.
		const state = fresh("abc");
		const after = state.update({ changes: { from: 3, insert: " " } }).state;
		expect(text(after)).toBe("abc ");
		expect(seal(after)).toBe(4);
		expect(after.selection.main.head).toBe(4);
		// And writing continues normally from there rather than wedging.
		expect(text(type(after, "on"))).toBe("abc on");
	});
});

/* ------------------------------------------------------------------ *
 * effects alongside changes
 * ------------------------------------------------------------------ */

describe("effects dispatched alongside document changes", () => {
	it("still rejects an illegal change that carries an unrelated effect", () => {
		const unrelated = StateEffect.define<string>();
		const state = fresh("precious");
		const after = state.update({
			effects: unrelated.of("hello"),
			changes: { from: 0, to: 8, insert: "" },
		}).state;
		expect(text(after)).toBe("precious");
		expect(seal(after)).toBe(8);
	});

	it("applies a legal change that carries an unrelated effect", () => {
		const unrelated = StateEffect.define<string>();
		const state = fresh("kept ").update({
			effects: unrelated.of("hello"),
			changes: { from: 5, insert: "live" },
		}).state;
		expect(text(state)).toBe("kept live");
	});

	it("lets the exit effect win over a later enter effect in the same transaction", () => {
		// The field returns the first matching effect it sees.
		const state = fresh("abc").update({
			effects: [setFlowSession.of(null), setFlowSession.of({ sealPoint: 0 })],
		}).state;
		expect(getFlowSession(state)).toBeNull();
	});

	it("accepts a seal point supplied by an effect without validating it", () => {
		// The field trusts the effect value. Nothing in the module dispatches a
		// seal point that moves backwards — enterFlowSpec always uses the
		// document end — but the field itself provides no L6 guarantee, only
		// computeSealPoint does.
		let state = type(fresh("abc"), "de ");
		expect(seal(state)).toBe(6);
		state = state.update({ effects: setFlowSession.of({ sealPoint: 0 }) }).state;
		expect(seal(state)).toBe(0);
		// ...and sealed text is now editable, because it is no longer sealed.
		expect(text(deleteRange(state, 0, 3))).toBe("de ");
	});

	it("still rejects an illegal change bundled with a session effect", () => {
		// Carrying an enter/exit effect is not a licence to rewrite the document.
		// The changes are checked before the session fast-path, so a single
		// dispatch cannot both unlock and empty a sealed note.
		const state = fresh("precious");
		const after = state.update({
			effects: setFlowSession.of(null),
			changes: { from: 0, to: 8, insert: "" },
		}).state;
		expect(text(after)).toBe("precious");
	});

	it("bypasses the lock when the transaction filter is explicitly disabled", () => {
		// `filter: false` skips every transactionFilter, including this one.
		// That is a CodeMirror-level escape hatch the lock cannot close; it is
		// recorded here so the limitation is visible rather than assumed away.
		const state = fresh("precious");
		const after = state.update({ changes: { from: 0, to: 8, insert: "" }, filter: false }).state;
		expect(text(after)).toBe("");
	});
});

/* ------------------------------------------------------------------ *
 * invariants
 * ------------------------------------------------------------------ */

describe("monotonicity and the hard invariant", () => {
	it("never moves the seal point backwards while typing (L6)", () => {
		let state = fresh("existing text. ");
		let previous = seal(state);
		for (const ch of "Some new prose, typed out.\nWith breaks.\tAnd tabs. ") {
			state = type(state, ch);
			const current = seal(state);
			expect(current).toBeGreaterThanOrEqual(previous);
			previous = current;
		}
	});

	it("keeps the seal point within the document at all times", () => {
		let state = fresh("start ");
		for (const ch of "abc def ghi") {
			state = type(state, ch);
			expect(seal(state)).toBeLessThanOrEqual(state.doc.length);
		}
	});

	it("holds its invariants under a long randomised mix of legal and illegal operations", () => {
		const original = "Pre-existing prose that must survive.\n\nSecond paragraph.\n";
		let state = fresh(original);
		const random = rng(0x5eed);
		const letters = "abcdefghijklmnopqrstuvwxyz";
		const boundaries = [" ", "\t", "\n", " "];
		const punctuation = ".,!?;:";

		let previousSeal = seal(state);
		let shortestSeen = state.doc.length;

		for (let step = 0; step < 800; step++) {
			const at = state.selection.main.head;
			const length = state.doc.length;
			const pick = Math.floor(random() * 10);

			switch (pick) {
				case 0:
				case 1:
				case 2:
					state = type(state, letters[Math.floor(random() * letters.length)]);
					break;
				case 3:
					state = type(state, boundaries[Math.floor(random() * boundaries.length)]);
					break;
				case 4:
					state = type(state, punctuation[Math.floor(random() * punctuation.length)]);
					break;
				case 5:
					state = backspace(state);
					break;
				case 6: {
					// An illegal deletion at a random sealed offset.
					const from = Math.floor(random() * Math.max(1, length));
					state = deleteRange(state, from, Math.min(length, from + 1 + Math.floor(random() * 5)));
					break;
				}
				case 7:
					// A replace-all.
					state = state.update({ changes: { from: 0, to: length, insert: "wiped" } }).state;
					break;
				case 8:
					// A caret jump backwards.
					state = state.update({ selection: { anchor: Math.floor(random() * (length + 1)) } }).state;
					break;
				default: {
					// A mixed multi-range transaction.
					const from = Math.floor(random() * Math.max(1, length));
					state = state.update({
						changes: [
							{ from, to: Math.min(length, from + 1), insert: "?" },
							{ from: length, insert: "!" },
						],
					}).state;
					break;
				}
			}

			// The caret may be left behind a rejected edit; keep typing at the end.
			if (state.selection.main.head !== state.doc.length && random() < 0.5) {
				state = state.update({ selection: { anchor: state.doc.length } }).state;
			}

			const currentSeal = seal(state);
			expect(currentSeal, `seal moved backwards at step ${step}`).toBeGreaterThanOrEqual(previousSeal);
			expect(state.doc.length, `document shorter than the seal at step ${step}`).toBeGreaterThanOrEqual(
				currentSeal,
			);
			expect(
				state.doc.sliceString(0, original.length),
				`pre-existing content changed at step ${step}`,
			).toBe(original);
			previousSeal = currentSeal;
			shortestSeen = Math.min(shortestSeen, state.doc.length);
			expect(at).toBeGreaterThanOrEqual(0);
		}

		// Never shorter than the note we started with...
		expect(shortestSeen).toBeGreaterThanOrEqual(original.length);
		// ...and the session did real work rather than rejecting everything.
		expect(state.doc.length).toBeGreaterThan(original.length);
		expect(previousSeal).toBeGreaterThan(original.length);
	});

	it("never removes pre-existing content under a barrage of every illegal shape", () => {
		const original = "irreplaceable words\nover two lines";
		let state = fresh(original);
		for (let i = 0; i < original.length; i++) {
			state = deleteRange(state, i, i + 1);
			state = deleteRange(state, 0, i + 1);
			state = state.update({ changes: { from: i, insert: "junk" } }).state;
			state = state.update({ changes: { from: 0, to: original.length, insert: "" } }).state;
			state = backspace(state);
		}
		expect(text(state)).toBe(original);
		expect(seal(state)).toBe(original.length);
	});
});

/* ------------------------------------------------------------------ *
 * Regressions.
 *
 * Each of these was a real defect in an earlier lock.ts, found by this suite.
 * They are kept as named regressions because each one was a way to defeat the
 * central guarantee, and three of them destroyed or stranded user text.
 * ------------------------------------------------------------------ */

describe("regressions", () => {
	it("does not let a change bundled with the exit effect delete sealed text", () => {
		// §6.1: "no code path in flow mode ... removes existing content".
		// The filter used to return early for ANY transaction carrying
		// setFlowSession, so the changes rode along unchecked.
		const state = fresh("precious");
		const after = state.update({
			effects: setFlowSession.of(null),
			changes: { from: 0, to: 8, insert: "" },
		}).state;
		expect(text(after)).toBe("precious");
	});

	it("does not let a change bundled with a no-op session effect rewrite sealed text", () => {
		// Worse than the above: the effect does not even change the session.
		// The document is destroyed and the session is left claiming a seal
		// point past the end of the new document.
		const state = fresh("precious");
		const after = state.update({
			effects: setFlowSession.of({ sealPoint: 8 }),
			changes: { from: 0, to: 8, insert: "gone" },
		}).state;
		expect(text(after)).toBe("precious");
		expect(seal(after)).toBeLessThanOrEqual(after.doc.length);
	});

	it("keeps the caret on the write-head when an edit also sets a selection", () => {
		// §6.1 "Cursor pinning": the caret "physically cannot leave the
		// write-head". The filter used to check selections only on transactions
		// that did NOT change the document, so a legal one-character append could
		// carry the caret to offset 0.
		const state = fresh("abc");
		const after = state.update({
			changes: { from: 3, insert: "d" },
			selection: { anchor: 0 },
		}).state;
		expect(after.selection.main.head).toBe(after.doc.length);
	});

	it("allows a change that reaches into sealed text without altering it", () => {
		// The exact shape Obsidian's list continuation dispatches: a change
		// running from one character *before* the caret, whose replacement text
		// begins with that same character. Rejecting it made Enter do nothing in
		// a bulleted list whenever the preceding character was already sealed.
		const state = fresh("- hello");
		expect(seal(state)).toBe(7);

		const after = state.update({
			changes: { from: 6, to: 7, insert: "o\n- " },
		}).state;

		expect(text(after)).toBe("- hello\n- ");
		// The sealed prefix survived untouched, the seal advanced, and the caret
		// is back on the new write-head.
		expect(text(after).slice(0, 7)).toBe("- hello");
		expect(seal(after)).toBe(10);
		expect(after.selection.main.head).toBe(10);
	});

	it("still rejects a change that reaches into sealed text and alters it", () => {
		// The same shape as above but one character different, which is the whole
		// distinction the rule now turns on.
		const state = fresh("- hello");
		const after = state.update({
			changes: { from: 6, to: 7, insert: "X\n- " },
		}).state;
		expect(text(after)).toBe("- hello");
	});

	it("keeps typing alive after an edit tries to move the caret away", () => {
		// The follow-on consequence of the above, and the reason it mattered:
		// with the caret stranded, every keystroke targeted a sealed offset and
		// was silently rejected, wedging flow mode with undo blocked and no way
		// back.
		let state = fresh("abc");
		state = state.update({ changes: { from: 3, insert: "d" }, selection: { anchor: 0 } }).state;
		state = type(state, "hello");
		expect(text(state)).toBe("abcdhello");
	});
});
