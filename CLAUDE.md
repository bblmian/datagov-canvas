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
npm run e2e                         # GUI-only scenarios against dist/ in Chrome for Testing (run `npm run build` first); `npm run e2e -- grammar-coverage` for one
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
- Never put side effects inside a state updater (`setNodes(prev => …)`): React re-runs updaters when it rebases state. Saving positions from inside the drag-end updater looped forever (save → rebuild → re-run → save, as microtasks, so React's update-depth guard never fired) and froze the page on drag end, intermittently, for tables and notes alike. `onNodesChange` now only sets a flag; an effect saves once the drag has rendered. `e2e/scenarios/drag-stress.mjs` guards it.
- Positions are reported to `App` only when a drag ends (`dragging === false`), and for tables/notes with no saved position (whole-diagram dagre layout if nothing is placed yet, otherwise stacked to the right via `placeNew`).
- Hover/selection highlighting lives in a `HighlightStore` (`highlight.ts`) outside React state. Each table, field row and edge subscribes to the one primitive it renders via `useHighlight(selector)`, so hovering re-renders only the items whose highlight changed. Selectors must return primitives (a new object each call would re-render forever).
- `buildNodes` / `buildEdges` return the previous node/edge object when nothing about it changed (and `buildEdges` returns the previous array if no edge changed); together with `reuseUnchanged` this keeps re-renders proportional to what changed.
- No endless CSS animations on the canvas: an infinite dash animation on highlighted edges repainted and re-layerized the whole canvas every frame while a table was hovered or selected (half of a drag's main-thread work on 60 tables).
- Edge anchors are plain `<i class="anchor source|target" data-handleid data-handlepos>` elements (`Anchors` in `nodes.tsx`), not `<Handle>`s: React Flow measures any `.source`/`.target` element with those attributes inside a node, while each `<Handle>` subscribes to its store (4 per column was ~3,100 subscriptions re-run every drag frame). Real `<Handle>`s (`ConnectDots`) are mounted only on the hovered row/header and reuse the anchor ids, so a connection starts from an already-measured handle. Anchors must not get a transform or opacity (each would add compositing work).
- Cardinality markers are drawn as paths inside the edge component rather than SVG `<marker>` defs so they survive image export.
- `geometry.ts` constants (`HEADER_H`, `ROW_H`, …) must match the `.tbl` CSS in `styles.css`; they're used for layout before nodes are measured.

**App (`src/App.tsx`).** Owns the current `DiagramDoc` (source + positions), debounced parse (100 ms, stale results dropped by sequence number; errors are shown 400 ms later so mid-word states don't flash; each new model goes through `reuseUnchanged` in `model.ts`, which keeps unchanged tables/refs/… as the previous objects) and debounced save (400 ms, flushed on tab hide). On parse errors the last good model stays on screen with a "stale" banner. The `Canvas` is keyed by diagram id, so switching diagrams remounts it (and refits the view).

**Graphical editing.** The DBML text stays the single source of truth: every GUI action (inspector panel `src/components/Inspector.tsx`, canvas toolbar, double-click on the pane, dragging a column's dot onto another column, Delete key) becomes a precise text edit computed by `src/dbml/edit.ts`, which rewrites only the affected ranges so comments and formatting elsewhere survive. It needs source offsets, which the worker returns as `EditInfo` (`src/dbml/editinfo.ts`, built from @dbml/core's non-normalized `Database`, whose elements carry `token` offsets and the same numeric ids as `normalize()`). `EditInfo` is kept out of `DiagramModel` on purpose — offsets shift on every keystroke and would defeat `reuseUnchanged`.
- `App.runEdit` queues edits and applies each one only when the latest parse matches the current text (`parsed` ref), so rapid clicks never use stale offsets; edits are refused while the text has errors. Renames return `renamed` (old → new id) so saved positions follow; created tables/notes get the position where they were created.
- Tables and TablePartials are both "blocks" in `edit.ts` (block id = table id or `partial:<name>`; column ids `<block>.<column>`), sharing column / index / check editing. Columns a table gets from `~partial` are absent from `EditInfo.fields` and listed in `EditInfo.injected` — they are edited in the partial.
- Renaming a table or column also rewrites the refs, inline `ref:` settings, group members, indexes and `Records` that mention it (for a partial column: in every table using the partial). Inline refs that gain `delete:`/`update:` actions or are swapped are moved out into a `Ref:` statement. DBML has no empty tables, so deleting the last column is refused (`EditError`).
- The editor applies external changes as a minimal middle-part replacement (keeps scroll, one undo step), and stays mounted when collapsed, so ⌘Z / the canvas undo buttons undo graphical edits too.
- Handlers passed to `<ReactFlow>` must be stable (`useCallback` + `propsRef`): React Flow copies each changed handler into its store with a separate update, and every update re-runs every node's selectors. Inline arrows there doubled the per-keystroke cost on a 60-table diagram.
- `DiagramView`s are not in `normalize()`; the worker passes `db.diagramViews` to `toDiagramModel`, which turns @dbml/core's ambiguous `visibleEntities` (`[]` is both `*` and "not listed") into `DView` (`'all'` / ids / null). `applyView` (`src/dbml/views.ts`) gives the Canvas only what the active view shows; App keeps the full model for the inspector. Renaming/deleting tables, groups or notes rewrites the views that list them (an unknown name in a view is a parse error).
- Deps (`Dep` blocks and inline `[dep: …]`) are drawn as their own edge type (`DepEdgeView`, upstream → downstream); the canvas toolbar switches what dragging from a dot creates (Ref or Dep; in Dep mode table headers get dots for table-level deps). `Metadata <Kind> <target>` blocks are not in @dbml/core's model, so `editinfo.ts` scans the source for them; `setMetadata` keeps their built-in entries.
- `src/dbml/coverage.test.ts` reads the element-kind and setting enums of the installed `@dbml/parse` grammar and fails if any is not mapped to an edit operation — keep `docs/图形编辑覆盖表.md` in step with it.
- @dbml/core lists index expressions before plain columns, so `editinfo.ts` reads index columns from the source text to keep their written order.
- Inspector layout: sections other than basics/columns are collapsible `Section`s (`count` makes one collapsible; empty ones start closed; open state is remembered per section id for the session). Rarely used table settings live under "More". Sizes come from the tokens at the top of the inspector block in `styles.css`; `.inspector` is a size container (`ins`) and `.canvas` another (`canvas`) — narrow-width rules are container queries, not media queries. Width is user-resizable and stored in `Settings.inspectorWidth`. Clicking the empty pane closes the inspector.
- Trash can: `Canvas` shows a drop zone (bottom-left `Panel`) between `onNodeDragStart` and `onNodeDragStop`; a drop on it calls `onDeleteElements`, and App shows an Undo toast. e2e editing scenarios call `expandSections()` (from `e2e/run.mjs`) so collapsed sections don't get in their way; `e2e/scenarios/panel.mjs` tests the disclosure and the trash itself.
- Race in React Flow: if a rebuild hands it a table with `measured` before it has recorded that table's handle bounds, it never re-measures (size unchanged) and all the table's edges vanish. `Canvas` checks after every nodes change for measured tables without `internals.handleBounds` and calls `updateNodeInternals` for them. Found by repeating an e2e scenario (failed ~1 in 7 before the fix).
- Records cells and custom Dep values are kept as the literals written in the source (`raw`), because @dbml/core reports `true` and `'true'` alike; the UI turns an edited cell into a literal with `literalFor(text, previous)`, so a cell keeps its kind. DBML allows one Records block per table.
- React Flow only re-measures handles when a node resizes; after a column rename `Canvas` calls `updateNodeInternals` for tables whose column ids changed, otherwise edges and new connections can't find the handles.
- Clicking a table reveals its code without focusing the editor, so Delete and ⌘-click reach the canvas.

**Persistence (`src/storage.ts`).** `chrome.storage.local` keys `dd:index` (list of `DiagramMeta`), `dd:doc:<id>`, `dd:settings`. Writes are serialized through one promise queue because the index update is read-modify-write. Falls back to `localStorage` outside the extension.

**Exports.** Images: `html-to-image` re-renders `.react-flow__viewport` translated to the nodes' bounding box (`src/export/image.ts`). PDF is vector and goes through Chrome's print dialog ("Save as PDF"): `src/export/print.ts` clones the viewport into `#print-root` (visible only in print media), sets `@page` to A4 (whole diagram fitted and centered) or to the canvas size (visible area, current zoom), and calls `window.print()`; cleanup happens on `afterprint`. Drawing the PDF ourselves (jsPDF) would need bundled CJK fonts.

Chrome gives extension pages `body { font-family: system-ui; font-size: 75% }`, which localhost doesn't have; `styles.css` resets body to inherit from `:root`. Besides shrinking text, `system-ui` silently drops CJK glyphs when printed to PDF. SQL/JSON come from the worker. Files are saved with an `<a download>` (no `downloads` permission needed).

**i18n.** UI strings live in `src/i18n.tsx`; `zh` is typed `Record<MessageKey, string>`, so a missing translation is a type error, and `i18n.test.ts` checks that `{placeholders}` match. Chrome's own strings (extension name/description) are in `public/_locales/{en,zh_CN}` because `chrome.i18n` can't switch language at runtime. @dbml/core's error messages are English only.

## Testing in a real extension context

Branded Chrome ignores `--load-extension`; use Chrome for Testing / Playwright Chromium with `--disable-extensions-except=dist --load-extension=dist`, then open `chrome-extension://<id>/index.html` (the id comes from the service worker URL). `e2e/run.mjs` does exactly this (fresh profile per scenario; `E2E_CHROME` overrides the browser path). `e2e/scenarios/grammar-coverage.mjs` reads the grammar's element kinds and settings at run time and fails unless every one was exercised through the canvas/inspector.
