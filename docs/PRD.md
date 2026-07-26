# Flow Writer for Obsidian — Product Requirements Document

**Status:** Draft v1.0 — awaiting sign-off
**Author:** Product (Claude) with David Cohen-Tanugi
**Date:** 2026-07-25
**Repo:** `~/Github/Personal/obsidian-flow-writer` (new, standalone)

---

## 1. Summary

Flow Writer is an Obsidian plugin that adds a single command — **Toggle flow mode** — which
drops the current note into a distraction-free, forward-only writing state, and drops back out
again.

In flow mode the screen shows nothing but the note's text, full screen. Everything already
written is dimmed to near-invisibility; only the word currently under your fingers is at full
strength. Once you press space or Enter, that word is sealed — it cannot be edited, deleted,
undone, or navigated back to. You can only move forward.

It is a port of the mechanic from the existing [Flow Writer](https://flow-writer.com) web app
(this project's sibling repo) into Obsidian, so that the writing lands directly in a real note
in the vault rather than in a scratch buffer that has to be copy-pasted out.

## 2. Motivation

The web Flow Writer works, but its output is a dead end: you write into a browser tab and then
`CTRL+SHIFT+C` the text into somewhere it can actually live. For anyone whose writing lives in
Obsidian, that's a broken loop. Putting the mechanic inside Obsidian means the flow session
*is* the note — already filed, already linked, already backed up.

Obsidian has distraction-free plugins (ProZen, which is installed in this vault) and it has
typewriter-scroll plugins. It does not have the forward-only lock, which is the actual
behavioral intervention Flow Writer provides. That is the differentiated part of this product.

## 3. What we're porting (and what we're not)

Reference implementation: `~/Github/Personal/Flow-Writer-App/src/components/TextEditor.js`.

The web app's mechanic, restated precisely: committed text lives in one string rendered at
`color: lightgrey`; the word in progress lives in a separate `<input>` at normal color. On
keydown of space (32) or Enter (13), the input's value is concatenated onto the committed
string and the input is cleared. There is no code path that mutates the committed string.
The lock is not enforced — it's structural. You can't edit old text because old text isn't in
an editable element.

We cannot use that trick in Obsidian; there is exactly one editor and it holds the whole
document. So the lock has to become an actively enforced rule. That is the single largest
piece of new design in this project and section 6.1 specifies it.

| Web app feature | Ported? | Notes |
|---|---|---|
| Forward-only word lock | **Yes** | Core. Reimplemented as an enforced rule, see §6.1 |
| Dim all but current word | **Yes** | Reimplemented as CM6 decorations, see §6.2 |
| Full screen | **Yes** | Via the leaf's `requestFullscreen()`, see §6.3 |
| Word count | **Yes** | §6.6 |
| Typewriter centering | **Yes** | Not in the web app; requested for v1. §6.7 |
| Copy-to-clipboard (`CTRL+SHIFT+C`) | **No** | Meaningless — the text is already a note |
| "New text" / reset | **No** | Meaningless — Obsidian owns file creation |
| Onboarding modal | **No** | Replaced by README + settings tab |
| localStorage persistence | **No** | Obsidian owns persistence |
| Title auto-derived from first 5 words | **No** | Obsidian owns note titles |

## 4. Non-goals for v1

- **Mobile.** Desktop only (`isDesktopOnly: true`). The Fullscreen API that the whole
  chrome-hiding approach rests on does not exist in Obsidian mobile, so mobile is not a smaller
  version of this feature, it's a different implementation. Deferred.
- **Sprint goals / timers.** Considered and cut. May return in v2.
- **Multi-note or multi-pane flow sessions.** Exactly one note is in flow at a time.
- **Any change to how notes are stored.** Flow Writer writes plain text into the active note
  through the normal editor. It introduces no new file format, frontmatter key, or sidecar.

## 5. User stories

1. As a writer with a blank note open, I press my flow hotkey and the entire UI vanishes into a
   full-screen field of text where only my current word is legible, so nothing competes for my
   attention.
2. As a writer mid-draft, I instinctively reach for backspace to fix a phrase three words back,
   and nothing happens — so I keep writing instead of rewriting.
3. As a writer who has finished a burst, I press Esc (or my hotkey, or find the command in the
   palette) and Obsidian returns exactly as I left it, with my text saved in the note.
4. As a writer who finds the Esc exit too easy, I turn it off in settings so leaving flow
   requires deliberate intent.
5. As someone using a custom theme (Blue Topaz) in dark mode, flow mode looks like *my*
   Obsidian — same fonts, same colors, same accent — just stripped down.

## 6. Functional requirements

### 6.0 The command

- **ID:** `toggle-flow-mode` → surfaces as `Flow Writer: Toggle flow mode`.
- Single command, toggles both directions. No separate enter/exit commands.
- No default hotkey shipped (avoids collisions); README tells the user to bind one.
- Available in the command palette at all times.

**Preconditions.** Flow mode requires an active Markdown view in an editing mode
(Live Preview or Source). If the active view is anything else — no note open, a PDF, graph
view, canvas, or a Markdown note in **Reading** mode — the command shows a `Notice`
("Flow Writer: open a note in editing mode first") and does nothing. It does not switch modes
for you and it does not create notes.

### 6.1 The lock — forward-only writing

This is the core requirement. Everything else is presentation.

**Model.** Flow mode maintains a single integer, the **seal point**: a document offset before
which all text is immutable. Text between the seal point and the end of the document is the
**live word** — the only editable region in the document.

**Rules.**

| # | Rule |
|---|---|
| L1 | On entering flow mode, the seal point is set to the end of the document, and the cursor moves to the end of the document. All pre-existing note content is therefore sealed. |
| L2 | Any edit that would **alter** sealed text is rejected outright. The document is left untouched; no error, no beep, nothing happens. Note this is stated as an outcome, not as "no change may begin before the seal point" — the latter is only a proxy for it, and several editor commands legitimately rewrite a range that includes text they do not change. Obsidian's list continuation is one: pressing Enter in a list dispatches a change beginning one character *before* the caret that re-inserts that character unchanged. A change may reach into sealed text provided the sealed text is byte-identical afterwards. |
| L3 | Edits at or after the seal point are allowed. This is what makes backspace work inside the word you're typing. |
| L4 | When an edit inserts a **word-boundary character** — any whitespace: space, tab, newline — the seal point advances to just after the **last** boundary character, sealing the word just typed and the boundary itself. It does *not* advance to the end of the document: if a single edit inserts `hello world and`, the seal lands after `world ` and `and` stays live. |
| L5 | Punctuation does not seal. `.`, `,`, `!`, `?` etc. are ordinary characters within the live word. (This matches the web app, which sealed only on keyCode 32 and 13.) |
| L6 | Within a session the seal point never moves backward. There is no unseal operation and no setting that provides one. Exiting and re-entering starts a fresh session, which legitimately reseals from wherever the document then ends. |

**Worked example.** Document is empty. Seal point = 0.
Type `hello` → doc is `hello`, seal = 0, live word = `hello`. Backspace works.
Type space → doc is `hello `, seal advances to 6. Backspace now does nothing — deleting the
space would touch offset 5, which is before the seal.
Type `wor`, backspace, backspace → doc is `hello w`. Allowed; offsets 6+ are live.

**Cursor pinning.** The caret is pinned to the end of the document. Arrow keys, Home/End,
Page Up/Down, clicking in the text, and drag-selection are all swallowed. The caret physically
cannot leave the write-head. This is the strict reading of "you can't go back" and was chosen
deliberately over the more permissive alternatives.

**Back-doors that must be closed.** Each of these is an alternative route to mutating sealed
text, and each is blocked in flow mode:

- **Undo / redo** (`Mod+Z`, `Mod+Shift+Z`, `Mod+Y`). Without this, one keystroke rewinds
  straight through the seal. Mandatory.
- **Paste** (`Mod+V`) and drag-and-drop of text. Flow mode is purely typed.
- **Find & replace** (`Mod+F`, `Mod+H`). Replace-all can rewrite the whole document.
- **Switching notes or following links** (`Mod+O` quick switcher, clicking a wikilink,
  `Mod+W`, `Mod+T`). Flow mode holds you on one note until you exit.

`Mod+P` (command palette) is explicitly **not** blocked — it is one of the three documented
exits. The user's own flow-mode hotkey is likewise never blocked.

**Fail-safe.** If a note switch happens anyway through a route we did not anticipate, the
plugin exits flow mode cleanly rather than leaving a locked editor pointed at the wrong file.
Correct restoration always beats airtight blocking.

**What the lock never does.** The lock rejects edits; it never deletes, truncates, or rewrites
the note. There is no code path in flow mode that removes existing content.

Stated precisely, because the loose version ("flow mode never shortens the document") is false —
backspacing inside the live word shortens it legitimately. The three invariants that must hold
for every sequence of operations within a session, and that are property-tested:

1. the seal point never decreases;
2. the document is never shorter than the seal point;
3. the first *N* characters of the document, where *N* is its length when the session began,
   are byte-identical to what they were at that moment.

**Two limits worth stating rather than assuming away.** A transaction dispatched with
CodeMirror's `filter: false` skips every transaction filter, including ours — that is an
engine-level escape hatch no plugin can close, so "no route can mutate sealed text" is true of
every ordinary route but not literally every route. And "whitespace" via `/\s/` is broader than
space/tab/newline: non-breaking space, the U+2000–200A family and U+FEFF all seal, while the
zero-width joiners U+200B–200D do not.

### 6.2 Dimming

- All text from offset 0 to the seal point renders at a single reduced opacity.
- The live word and everything after the seal point renders at full strength.
- Implemented as **opacity**, not a color override, so that theme colors, syntax highlighting,
  accent colors, and Live Preview rendering all survive — dimmed but intact — and so that
  light/dark mode need no special handling at all.
- Default opacity: **0.25**. User-adjustable, 0.05–0.60.
- Uniform. No recency gradient, no clipping of old text off-screen. (Both were considered; flat
  matches the web app and is the least visually noisy.)

### 6.3 Full screen and chrome hiding

Following the approach ProZen uses, and which is already proven in this vault: call
`requestFullscreen()` on the **active leaf's `containerEl`**, not on the window or body.
Because only that one container goes full screen, the ribbon, both side panes, tab bar, and
status bar are excluded by the browser itself rather than by CSS we have to maintain against
theme updates.

Hidden *within* the leaf, via a scoping class on the container:

- the view header / tab title bar
- the note **properties** (frontmatter) panel
- the inline note title
- scrollbars (scrolling by wheel/trackpad/keys still works)

Visible: the note's text content, and the word count if enabled. Nothing else.

**Appearance is inherited, never overridden.** Flow mode sets no fonts, no colors, no
background, and no accent. It reads the user's theme (Blue Topaz here) and light/dark setting
by doing nothing to them. Every style the plugin does apply must be expressed via Obsidian's
CSS custom properties (`--text-faint`, `--background-primary`, etc.) so it tracks theme
switches live, including a switch that happens mid-session.

### 6.4 Exiting

Three routes out, all equivalent:

1. **Esc** — on by default, disableable in settings.
2. **Command palette** → `Flow Writer: Toggle flow mode`.
3. The **hotkey** bound to that command.

On exit, everything is restored: full screen released, hidden chrome shown, cursor freed,
editing unlocked, and the leaf left exactly as it was found. The seal point is discarded — a
new flow session starts fresh from wherever the document then ends.

> **Known platform constraint.** Chromium (and therefore Electron, and therefore Obsidian)
> exits HTML5 full screen on Esc at the browser level, and a web page cannot reliably
> `preventDefault()` that. So when the user has *disabled* Esc-to-exit, pressing Esc may still
> drop the OS full screen. Specified behavior in that case: **the flow session continues** —
> lock, dimming and hidden chrome all persist — and the plugin attempts to re-enter full screen
> on the user's next keystroke (a keystroke is a valid user gesture, which is what Chromium
> requires). If that is refused, the session simply continues windowed. Under no circumstances
> does Esc unlock the text when the user has said it shouldn't. **This needs a spike during
> implementation to confirm the real Electron behavior; if re-entry proves unreliable, we show
> a one-time Notice explaining it rather than shipping something that silently misbehaves.**

### 6.5 Settings

| Setting | Type | Default |
|---|---|---|
| Sealed text opacity | Slider 0.05–0.60 | 0.25 |
| Esc exits flow mode | Toggle | On |
| Show word count | Off / Session / Session + total | Session |
| Typewriter centering | Toggle | On |
| Hide note properties | Toggle | On |
| Hide inline title | Toggle | On |

### 6.6 Word count

A faint, small counter in a corner of the screen, styled with `--text-faint`. Counts words
written **during this flow session** (i.e. since the seal point at entry). The "Session + total"
option also shows the note's full word count. It must not shift or reflow the text.

### 6.7 Typewriter centering

Keeps the line being written vertically centered so the eye stays still. Requires bottom
padding on the editor content so the last line can reach the middle of the screen.

> Note: this vault already has `cm-typewriter-scroll-obsidian` installed. Ours is scoped to
> flow mode only and is disableable, so the two can coexist — but if double-scrolling shows up
> during testing, the fix is to turn ours off, not to fight it.

## 7. Technical design

### 7.1 Stack

TypeScript, bundled with esbuild to a single `main.js` — the standard Obsidian plugin
toolchain. Dependencies: `obsidian` (types), `@codemirror/*` (types; the runtime comes from
Obsidian), `esbuild`, `typescript`, `vitest`.

### 7.2 Module layout

```
obsidian-flow-writer/
├── manifest.json          # id: flow-writer, isDesktopOnly: true
├── versions.json
├── esbuild.config.mjs
├── styles.css
├── src/
│   ├── main.ts            # Plugin subclass: command, lifecycle
│   ├── session.ts         # enter/exit orchestration, fullscreen, chrome hiding
│   ├── lock.ts            # seal-point state field + transaction filter  ← pure, tested
│   ├── decorations.ts     # dimming decoration set
│   ├── guards.ts          # back-door blocking (keys, paste, mouse, navigation)
│   ├── wordcount.ts
│   ├── typewriter.ts
│   └── settings.ts        # defaults + PluginSettingTab
└── tests/
```

### 7.3 Key mechanism: activation without re-registration

`registerEditorExtension()` registers globally, for every editor in the app. The plugin
registers its extension set **once** at load, and every behavior in it is gated on a
`StateField` that holds the flow session state — `null` in every editor that is not in flow
mode. Entering flow mode dispatches a `StateEffect` to one specific `EditorView` to populate
that field; exiting dispatches one to clear it. No editor other than the flow note is ever
affected, and there is no unregister/re-register churn.

The seal point lives in that same `StateField`, so CodeMirror maps it through document changes
automatically rather than us tracking offsets by hand.

Enforcement is an `EditorState.transactionFilter`: it inspects each transaction's change set,
cancels the transaction if any change starts before the seal point, and otherwise passes it
through — advancing the seal point when the inserted text ends in whitespace. Cursor pinning
is enforced in the same filter by rewriting any selection back to the document end.

This design means the lock is enforced at the *state* level, not the *keyboard* level. Blocking
keys (§6.1) is defense in depth for a better feel; the transaction filter is what makes the
guarantee true regardless of what route an edit arrives by.

### 7.4 Testing

Chosen approach: **unit tests for the logic, hands-on for the interaction.**

Automated (`vitest`), against a real headless CodeMirror `EditorState` with no Obsidian
dependency — the lock is genuinely unit-testable because it's a pure state transform:

- typing a word then space advances the seal point to the document end
- backspace inside the live word succeeds
- backspace across the seal point is rejected and the document is unchanged
- punctuation does not seal; tab and newline do
- an undo transaction spanning sealed text is rejected
- a bulk replace-all transaction is rejected
- entering flow mode on a non-empty document seals all of it
- **invariant: no sequence of rejected transactions ever shortens the document**
- settings load/merge with defaults, including on a missing or partial `data.json`

Manual, by David, after install into the real `Notes` vault: full screen and chrome hiding,
theme/dark-mode fidelity, Esc behavior in both settings states, typewriter feel, and the
overall subjective question of whether it's actually pleasant to write in.

> **Recommendation, since this installs into a vault containing real writing:** do the first
> manual pass on a scratch note. Flow mode blocks undo by design, so a bug in the lock has no
> in-app escape hatch. The vault is in Dropbox and under `obsidian-git`, so there is recovery —
> but a throwaway note is cheaper than using it.

A `npm run install-vault` script copies `main.js`, `manifest.json` and `styles.css` into the
vault's plugin folder, with the vault path in a gitignored local config.

## 8. Repo and licensing

**Standalone repo** at `~/Github/Personal/obsidian-flow-writer`, separate from the React app.
Reasons: entirely different toolchain; Obsidian's community-plugin submission requires
`manifest.json` at the repo root and distributes via that repo's GitHub release tags, so a
dedicated repo is a prerequisite for ever publishing; and the plugin shares no code with the
web app.

**Licensing — needs your decision.** The original Flow Writer is **GPL-3.0**. This plugin is a
clean-room reimplementation: no source is copied, and it shares no code with the React app
(different language, different framework, different editor engine, different lock mechanism).
Behavior and ideas aren't copyrightable, so GPL does not propagate here on its own.

My recommendation is **MIT**, with a clear, prominent credit in the README to Pavel Ivanov
(@paveli) and the original Flow Writer as the source of the idea. That is the honest and
generous framing, and MIT is the norm for Obsidian community plugins. If you'd rather match the
original's spirit and go GPL-3.0, that's equally defensible — say the word.

## 9. Success criteria

v1 ships when:

1. `Toggle flow mode` enters and exits reliably, and exiting always restores the workspace to
   its prior state.
2. The lock cannot be defeated by backspace, arrow keys, mouse, undo, paste, or find & replace.
3. No flow session has ever caused loss of pre-existing note content — asserted by test and by
   manual use.
4. Flow mode is visually indistinguishable from the user's own theme, in both light and dark.
5. David has written something real in it and wants to keep using it.

## 10. Open questions

1. **License:** MIT + attribution, or GPL-3.0? (§8 — my recommendation is MIT.)
2. **Esc-under-disabled-setting:** pending the Electron spike in §6.4.
3. **Community-plugin submission:** is publishing to the Obsidian community plugin directory a
   goal, or is this a personal tool? It changes how much polish, documentation, and
   guideline-compliance work v1 carries.

## 11. Implementation plan

Sequenced so the risky, load-bearing part is proven first and everything after it is additive.

| # | Milestone | Contents |
|---|---|---|
| M0 | Scaffold | Repo, git init, manifest, tsconfig, esbuild, install-vault script, vitest |
| M1 | **Lock engine** | `lock.ts` + full unit suite. Pure CM6, no Obsidian. The whole product risk lives here. |
| M2 | Dimming | `decorations.ts`, theme-safe CSS |
| M3 | Session lifecycle | Command, fullscreen, chrome hiding, enter/exit/restore. First installable build. |
| M4 | Guards | Back-door blocking + the Esc/Electron spike |
| M5 | Trimmings | Word count, typewriter centering |
| M6 | Settings | Settings tab wired to all of the above |
| M7 | Ship | README with attribution, license, install to vault, hand off for manual testing |
