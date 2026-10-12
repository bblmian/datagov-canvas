# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension ("DBML Studio") that re-implements the core of dbdiagram.io offline: a DBML editor on the left, a live ER diagram on the right, bilingual UI (en / zh). It must not use dbdiagram.io / Holistics branding — it is an independent implementation that only uses the open-source `@dbml/core` library.

Current status and the resume-from-here list live in `docs/项目现状与待办.md`; update it when wrapping up a session.

## Commands

```bash
npm run build                       # tsc --noEmit + vite build → dist/ (load dist/ unpacked in chrome://extensions)
npm run dev                         # plain web page at localhost; storage falls back to localStorage
npm test                            # vitest, node environment
npx vitest run src/canvas/graph.test.ts        # single file
npx vitest run -t "composite primary key"      # single test by name
npm run typecheck
npm run icons                       # regenerate public/icons/*.png (scripts/make-icons.mjs, no deps)
```

There is no linter; `npm run typecheck` (strict TS, `noUnusedLocals`/`noUnusedParameters`) is the static check. Everything in `public/` (manifest.json, background.js, _locales/, icons/) is copied verbatim into `dist/`.

Dependencies are pinned to exact versions. The `@codemirror/*` packages must resolve to a single copy of `@codemirror/state` and `@codemirror/view` (two copies break the editor at runtime with no type error) — after adding or bumping a CodeMirror package, check `npm ls @codemirror/state @codemirror/view --all`.

## Architecture

**Extension shell.** `public/background.js` (service worker) opens `index.html` in a tab on toolbar click, or focuses the existing one via `chrome.runtime.getContexts` (no `tabs` permission). The whole app is that one extension page. MV3's CSP forbids remote code and `eval`, so every dependency is bundled; nothing loads from a CDN.

**DBML runs in a worker.** `@dbml/core` is ~20 MB unminified (it bundles every SQL dialect parser) and becomes the ~16 MB `worker-*.js` chunk. Only `src/dbml/worker.ts` imports it; the UI talks to it through the promise RPC in `src/dbml/client.ts` (`parseDbml`, `exportDbml`, `importToDbml`; failures reject with `DbmlError` carrying diagnostics). Don't import `@dbml/core` from UI code — it would pull the library into the main bundle.

**Model boundary.** The worker converts `Database.normalize()` output into the renderer's own `DiagramModel` (`src/dbml/types.ts`, built by `toDiagramModel` in `src/dbml/model.ts`). IDs used everywhere downstream:
- table: `name` for the default `public` schema, `schema.name` otherwise. Saved positions are keyed by this id, so renaming a table in DBML loses its position.
- field: `${tableId}.${fieldName}`; note: `note:${name}`; group: `group:${name}`.
- Composite PKs come back from @dbml/core as pk *indexes* with the column `pk` flag false — `toDiagramModel` folds them back into `DField.pk`.
- Endpoint relations are strings like `'1'`, `'*'`, `'0..1'`, `'0..*'`; use `isMany` / `isOptional`.

**Canvas (React Flow v12, `src/canvas/`).**
- Nodes are kept in local state and rebuilt from the model by `buildNodes`, which carries over React Flow's `measured` sizes — rebuilding nodes without `measured` leaves them invisible. Edges are derived (`buildEdges`) from the current nodes every render, picking the left/right side per edge from table positions.
- Each visible field row and each table header renders four hidden handles: `${owner}|s|l`, `|s|r`, `|t|l`, `|t|r` (see `handleId`). When a field is hidden (display mode `keys`/`names`) the edge anchors to the table header instead.
- TableGroups are background nodes of type `tablegroup` (not `group` — React Flow ships default CSS for `.react-flow__node-group`). Their bounds are recomputed from member tables by `syncGroups`; dragging a group moves its members by the same delta in `onNodesChange`.
- Positions are reported to `App` only when a drag ends (`dragging === false`), and for tables/notes with no saved position (whole-diagram dagre layout if nothing is placed yet, otherwise stacked to the right via `placeNew`).
- Hover/selection highlighting lives in `CanvasContext` (`highlight.ts`), not in node data, so hovering doesn't rebuild nodes.
- Cardinality markers are drawn as paths inside the edge component rather than SVG `<marker>` defs so they survive image export.
- `geometry.ts` constants (`HEADER_H`, `ROW_H`, …) must match the `.tbl` CSS in `styles.css`; they're used for layout before nodes are measured.

**App (`src/App.tsx`).** Owns the current `DiagramDoc` (source + positions), debounced parse (250 ms, stale results dropped by sequence number) and debounced save (400 ms, flushed on tab hide). On parse errors the last good model stays on screen with a "stale" banner. The `Canvas` is keyed by diagram id, so switching diagrams remounts it (and refits the view).

**Persistence (`src/storage.ts`).** `chrome.storage.local` keys `dd:index` (list of `DiagramMeta`), `dd:doc:<id>`, `dd:settings`. Writes are serialized through one promise queue because the index update is read-modify-write. Falls back to `localStorage` outside the extension.

**Exports.** Images: `html-to-image` re-renders `.react-flow__viewport` translated to the nodes' bounding box (`src/export/image.ts`); PDF wraps the PNG with lazily-imported `jspdf`. SQL/JSON come from the worker. Files are saved with an `<a download>` (no `downloads` permission needed).

**i18n.** UI strings live in `src/i18n.tsx`; `zh` is typed `Record<MessageKey, string>`, so a missing translation is a type error, and `i18n.test.ts` checks that `{placeholders}` match. Chrome's own strings (extension name/description) are in `public/_locales/{en,zh_CN}` because `chrome.i18n` can't switch language at runtime. @dbml/core's error messages are English only.

## Testing in a real extension context

Branded Chrome ignores `--load-extension`; use Chrome for Testing / Playwright Chromium with `--disable-extensions-except=dist --load-extension=dist`, then open `chrome-extension://<id>/index.html` (the id comes from the service worker URL).
