# Flow Writer for Obsidian

A forward-only writing mode. Everything you have already written dims away, only
the word under your fingers stays lit, and once you finish a word you cannot go
back to it.

One command — **Toggle flow mode** — takes the current note full screen with
nothing else on the display, and takes you back out again.

## Why

Editing while drafting is the most reliable way to not finish a draft. Flow mode
removes the option. You can only move forward, so you do.

## What it does

- **Full screen, nothing else.** No ribbon, no side panes, no tab bar, no status
  bar, no properties panel, no note title. Only the words.
- **Everything written dims.** Text you have already committed drops to a faint
  opacity so it stays out of your way without disappearing.
- **Finished words are sealed.** Backspace works freely inside the word you are
  typing. The moment you press space or Enter, that word is permanent — it
  cannot be edited, deleted, undone, or navigated back to.
- **Your theme, untouched.** Flow mode sets no fonts, colours or background. It
  inherits whatever your Obsidian looks like, in light mode and dark, including
  a theme switch mid-session.

## Using it

1. Open a note in editing mode.
2. Run **Flow Writer: Toggle flow mode** from the command palette. Bind it to a
   hotkey in *Settings → Hotkeys* — it ships without one to avoid clashing with
   anything you already use.
3. Write.
4. Leave with `Esc`, the same command from the palette, or your hotkey.

Flow mode starts writing at the end of the note, and everything already in the
note is sealed. It never modifies or removes existing content.

If the active view is not a note in editing mode — no note open, a PDF, the
graph, or a note in Reading mode — the command tells you and does nothing.

## Settings

| Setting | Default |
|---|---|
| Sealed text opacity | 0.25 |
| Esc exits flow mode | On |
| Word count | This session |
| Typewriter centering | On |
| Hide note properties | On |
| Hide inline title | On |

Turn off **Esc exits flow mode** if leaving should take deliberate intent. The
command palette and your hotkey always work.

Turn off **typewriter centering** if you already run a typewriter-scroll plugin.

## Installing

Not in the community plugin directory yet. To build from source:

```bash
npm install && npm run build
```

Then copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/flow-writer/`, or put your vault's absolute path in a
`.vault-path` file at the repo root and run:

```bash
npm run install-vault
```

Desktop only. The full-screen behaviour flow mode is built on does not exist in
Obsidian mobile.

## Development

```bash
npm run dev        # esbuild watch
npm test           # vitest
npm run typecheck
```

The lock is in [`src/lock.ts`](src/lock.ts) and has no Obsidian dependency, so
it is tested directly against a headless CodeMirror state. It is the part worth
reading: a single monotonic "seal point" offset, enforced by a CodeMirror
transaction filter rather than by intercepting keystrokes, so it holds no matter
what route an edit arrives by.

See [docs/PRD.md](docs/PRD.md) for the full specification.

## Credit

The idea, and the mechanic, come from **[Flow Writer](https://flow-writer.com)**
by [@paveli](https://github.com/paveli) —
[Flow-Writer-App](https://github.com/paveli/Flow-Writer-App), and the essay that
goes with it, [*Write in flow, edit
later*](https://medium.com/@paveli/write-in-flow-edit-later-406fc74a4689).

This plugin is an independent reimplementation for Obsidian. It shares no code
with the original — different language, framework and editor engine — and exists
because that mechanic deserved to write into a real note instead of a scratch
buffer you have to copy out of.

## License

MIT. The original Flow Writer is GPL-3.0; no code from it is used here.
