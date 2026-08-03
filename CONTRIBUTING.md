# Contributing to Flow Writer

## Building from source

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/flow-writer/`, or put your vault's absolute path in a `.vault-path` file at the repo root and run:

```bash
npm run install-vault
```

For a watch build during development:

```bash
npm run dev
```

## Tests

```bash
npm test           # vitest (unit + smoke)
npm run typecheck  # tsc --noEmit
```

## Architecture

The core mechanic is a single monotonic "seal point" integer offset in `src/lock.ts`. It has no Obsidian dependency and is tested directly against a headless CodeMirror state. All edits that would alter text before the seal point are rejected by a CodeMirror `transactionFilter` — meaning the lock holds regardless of what route an edit arrives by (keystrokes, paste, drag-drop, undo, macro).

The rest of the plugin wires that lock into Obsidian's session lifecycle (`src/session.ts`), blocks back-door shortcuts (`src/guards.ts`), dims sealed text (`src/decorations.ts`), and provides optional word count and typewriter centering overlays.

See `docs/PRD.md` for the full product specification.
