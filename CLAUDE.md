# CLAUDE.md

This document is a handoff/specification note for continuing development of
Synchronous Platformer Editor.

## Project Goal

Build a web-first 2D platformer level editor with:

- LDtk-like level editing features.
- Figma/Miro-like realtime multiplayer editing.
- Tile, layer, entity, world/level, and export workflows for 2D platformer games.

The project is currently an early prototype. The main architectural priority is
to keep editor data, rendering, collaboration, and view styling separated.

## Current Tech Stack

- React
- TypeScript
- Vite
- WebGPU-first rendering
- Canvas2D fallback rendering

Package scripts:

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

The local development URL used so far is:

```text
http://127.0.0.1:5173/
```

## Architectural Direction

The intended split is:

```text
src/editor      Editor domain types and local editing data
src/rendering   Renderer interface, WebGPU renderer, Canvas2D fallback
src/ui          React components and editor interaction wiring
src/view        CSS/view customization and visual design tokens
src/project     Project file validation, import/export helpers over time
```

React should own the application shell and controls. It should not be used to
render map contents cell-by-cell. Canvas/WebGPU owns level rendering.

Rendering should stay behind `EditorRenderer` so WebGPU, WebGL, Canvas2D, or a
future custom renderer can be swapped without rewriting editor state logic.

Collaboration has not been implemented yet. When it is added, avoid coupling it
directly to WebGPU or React components. Prefer operation/data-model boundaries
that can later map to Yjs or another realtime sync system.

## Implemented Features

Current editor features:

- Web app shell with sidebar, toolbar, canvas, and status bar.
- WebGPU renderer selected when available.
- Canvas2D fallback if WebGPU initialization fails.
- Grid rendering.
- Tile rendering for visible tile layers.
- Hover cell highlight.
- Pan tool.
- Wheel zoom.
- Paint tool.
- Erase tool.
- Rectangle fill tool (drag to fill a rectangle with the selected tile, as one
  undo transaction).
- Selection (Select tool) with two modes — rectangle marquee and lasso
  (freeform closed path, boundary + interior). On a selection: drag inside it to
  move the cells (active layer only), Delete/Backspace clears them, Ctrl/Cmd+C
  copies and Ctrl/Cmd+V pastes at the hovered cell, Escape deselects. Move,
  delete and paste are each one undo transaction.
- Active layer selection.
- Layer visibility toggle (per layer).
- Active layer opacity slider.
- Per-layer identity color (sidebar dot + color picker for the active layer).
- "Layer focus" view mode: dims/desaturates non-active layers and tints each
  layer toward its identity color so the active layer's tiles stand out.
- Tileset/atlas support (Unity-like texture -> sprite -> tile): import an image
  (embedded as a data URL), then slice it into sprites yourself in a Sprite
  Editor modal (`src/ui/SpriteEditor.tsx`) — grid slice (cell size / offset /
  spacing) or drag custom regions. Applying syncs tiles to sprites as one undo
  transaction (existing sprite ids are preserved so painted cells stay valid).
  Sprite tiles are rendered with real textures in both WebGPU (textured
  pipeline) and Canvas2D (`drawImage`); color-only tiles still work as a
  fallback.
- Tile color palette selection.
- Operation-based edit model (`src/editor/operations.ts`) with origin-tagged
  undo/redo (`src/ui/useEditorHistory.ts`).
- Undo/redo for paint/erase strokes, layer visibility, opacity, and import.
- Keyboard shortcuts for tools, undo/redo, export, and zoom reset.
- Cursor-centered wheel zoom.
- JSON project export.
- JSON project import with basic runtime validation.
- View styles split into editable CSS files for future visual customization.

### Keyboard Shortcuts

- `V` select, `P` (or `B`) paint, `E` erase, `R` rectangle fill, `H` pan.
- `Delete`/`Backspace` clears the current selection's cells, `Escape` deselects.
- `Ctrl/Cmd+C` copy selection, `Ctrl/Cmd+V` paste at the hovered cell.
- `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo.
- `Ctrl/Cmd+S` export, `Ctrl/Cmd+0` reset zoom to 100%.
- Shortcuts are ignored while an input/textarea is focused or the Sprite Editor
  is open.

### Undo/Redo Notes

Undo/redo is **operation-based**, not snapshot-based.

- `src/editor/operations.ts` (no React): defines the `Operation` union
  (`setCell`, `patchLayer`, `replaceProject`) and `applyOperation(project, op)`,
  which returns the new project plus the inverse operation. Returns the SAME
  project reference when an operation changes nothing (used to skip no-op undo
  entries). This module is the framework-agnostic seam intended to later ride on
  Yjs/CRDT.
- `src/ui/useEditorHistory.ts` (React binding): holds `project` and
  origin-tagged `past`/`future` transaction stacks (capped at 100). A
  transaction is a list of ops + their inverses + an `origin`. A paint/erase
  stroke or opacity-slider drag is coalesced into one transaction via
  `begin()` / `mutate()` / `commit()`; atomic edits use `dispatch()` (or a lone
  `mutate()`). `undo(origin)` rewinds the most recent transaction by that
  origin; `redo(origin)` re-applies it.

Target behavior (per user request): Undo/Redo should be **per-user** — each
collaborator undoes only their own most-recent change. The origin tag already
threads through the history API (`LOCAL_ORIGIN` today); once collaboration lands,
route remote ops with their own origins and undo stays scoped to the local user
(mirrors a Yjs `UndoManager` bound to the local origin).

## Current Data Model

Defined in `src/editor/types.ts`.

```ts
export type ToolMode = "select" | "paint" | "erase" | "pan";

export type TileCell = {
  tileId: number;
  color: string;
};

export type TileDefinition = {
  id: number;
  name: string;
  color: string;      // fallback fill / tint when the tile has no sprite
  spriteId?: string;  // when set, the tile renders this sprite
};

export type TextureAsset = {
  id: string;
  name: string;
  src: string;        // data URL (self-contained across export/import)
  width: number;
  height: number;
};

export type Sprite = {
  id: string;
  name: string;
  textureId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TileLayer = {
  id: string;
  name: string;
  kind: "tile";
  visible: boolean;
  opacity: number;
  color: string; // identity color for sidebar swatch + "Layer focus" tint
  cells: Record<string, TileCell>;
};

export type EditorLevel = {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: TileLayer[];
};

export type EditorProject = {
  id: string;
  name: string;
  tileSize: number;
  textures: TextureAsset[];
  sprites: Sprite[];
  tiles: TileDefinition[];
  levels: EditorLevel[];
};
```

Cell keys are currently string coordinates in the form:

```text
"x,y"
```

Example:

```json
{
  "10,14": { "tileId": 1, "color": "#6fbf73" }
}
```

This is simple for prototyping, but may need to change later for large maps,
chunking, collaboration, compression, or sparse/dense layer optimization.

## Initial Project

Created by `src/editor/createInitialProject.ts`.

Current defaults:

- Project name: `Synchronous Platformer Editor`
- Tile size: `32`
- One level:
  - ID: `level-1`
  - Name: `Level 1`
  - Size: `40 x 20`
- Two layers:
  - `terrain`
  - `entities`
- Six tile definitions:
  - Grass: `#6fbf73`
  - Soil: `#3f7f5f`
  - Wood: `#d6a04d`
  - Ice: `#6c9df0`
  - Hazard: `#f06c7a`
  - Pickup: `#f2d05e`

Note: the `entities` layer is currently still implemented as a tile layer. True
entity definitions/instances are not implemented yet.

## Rendering

Renderer interface:

```text
src/rendering/Renderer.ts
```

Renderer implementations:

```text
src/rendering/webgpu/WebGpuRenderer.ts
src/rendering/canvas2d/Canvas2DRenderer.ts
```

Renderer selection:

```text
src/rendering/createRenderer.ts
```

Current behavior:

- Try `WebGpuRenderer`.
- If WebGPU is unavailable or initialization fails, log a warning and use
  `Canvas2DRenderer`.
- Status bar shows `Renderer: webgpu`, `Renderer: canvas2d`, or initializing.

The WebGPU renderer currently draws rect instances:

- Grid lines.
- Tile rectangles.
- Hover outline rectangles.

It does not yet use:

- Texture atlases.
- Real tileset images.
- GPU picking.
- Chunked tile buffers.
- Instanced atlas UVs.
- Camera-correct zoom around cursor.

## UI and Interaction

Main component:

```text
src/ui/EditorCanvas.tsx
```

Important local state:

- `project`: current editor project.
- `activeLayerId`: selected layer.
- `selectedTileId`: selected tile from palette.
- `selectedTool`: `select`, `paint`, `erase`, or `pan`.
- `viewport`: `{ centerX, centerY, zoom }`.
- `hoverCell`: grid cell under pointer.
- `rendererKind`: current renderer status.

Pointer behavior:

- Paint/erase applies to the current active layer.
- Drag with paint/erase continues applying while pointer is down.
- Pan tool, middle mouse, or Alt-drag pans the viewport.
- Wheel zooms between `0.25` and `4`.

Known interaction limitations:

- Selection is single-layer (move/copy/paste act on the active layer only).
- Paste anchors at the hovered cell; no floating paste-drag placement yet.
- No tile brush shapes.
- No eyedropper.
- Undo/redo is snapshot-based, not operation-based yet (see Collaboration
  Direction).

## Import and Export

Export:

- Button: `Export`
- Serializes current `EditorProject` to pretty JSON.
- Downloads a local `.json` file.

Import:

- Button: `Import`
- Reads a JSON file.
- Validates with `src/project/validateProject.ts`.
- If valid, replaces current project and resets active layer/tile/viewport.
- If invalid, logs an error to the console.

Current validation is intentionally basic. It checks shape and primitive types,
but does not validate:

- Tile IDs referenced by cells.
- Coordinate key format.
- Layer bounds.
- Duplicate IDs.
- Color string format.
- Version migrations.

## View Styling and Customization

The user explicitly wants the UI to remain easy to restyle later, including:

- Pixel-art/dot-style UI.
- Custom fonts.
- Custom button frames.
- Color/theme changes.

View styling entry point:

```text
src/styles.css
```

It imports:

```text
src/view/styles/design-tokens.css
src/view/styles/base.css
src/view/styles/editor-layout.css
src/view/styles/editor-controls.css
```

Start visual changes in:

```text
src/view/styles/design-tokens.css
```

That file owns theme-like values:

- Fonts.
- App/sidebar/toolbar/canvas colors.
- Text colors.
- Accent/danger colors.
- Borders.
- Control background.
- Control radius.
- Control frame width.
- Spacing.
- Text sizes.
- Motion duration.

Important note:

- CSS changes affect surrounding UI.
- Canvas map rendering is controlled by `src/rendering` and project data.
- If the map/grid/tile visuals need stylistic customization, add renderer-level
  visual settings separately rather than burying them in React components.

## Current File Map

```text
index.html
package.json
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
README.md
CLAUDE.md

src/main.tsx
src/App.tsx
src/styles.css
src/vite-env.d.ts

src/editor/types.ts
src/editor/createInitialProject.ts
src/editor/operations.ts
src/editor/tileset.ts
src/editor/selection.ts

src/ui/useEditorHistory.ts
src/ui/SpriteEditor.tsx

src/project/validateProject.ts

src/rendering/Renderer.ts
src/rendering/createRenderer.ts
src/rendering/color.ts
src/rendering/webgpu/WebGpuRenderer.ts
src/rendering/canvas2d/Canvas2DRenderer.ts

src/ui/EditorCanvas.tsx

src/view/README.md
src/view/styles/design-tokens.css
src/view/styles/base.css
src/view/styles/editor-layout.css
src/view/styles/editor-controls.css
```

## Verification Status

Last known verification:

```bash
npm run build
```

Build succeeded.

Browser runtime was also checked previously:

- Page rendered.
- No Vite error overlay.
- No browser error/warn logs after reload.
- Renderer initialized as `webgpu`.
- Layer and tile selection worked.

If starting from a fresh session, rerun:

```bash
npm install
npm run dev
npm run build
```

## Current Git/Workspace Notes

The active project path used during development was:

```text
C:\Users\goodn\Synchronous platformer editor
```

There is also another workspace root with a similar name under OneDrive:

```text
C:\Users\goodn\OneDrive\ドキュメント\Synchronous platformer editor
```

Be careful to work in the non-OneDrive path above unless the user explicitly
switches directories.

`git status` may show warnings about:

```text
unable to access 'C:\Users\goodn/.config/git/ignore': Permission denied
```

This warning appeared during Codex work and did not block development.

## Recommended Next Steps

Done:

- ~~Add undo/redo around tile paint/erase operations.~~ (snapshot-based)
- ~~Add keyboard shortcuts for tools, zoom reset, and export.~~
- ~~Add layer visibility and opacity controls.~~
- ~~Improve viewport zoom so zooming centers around the cursor.~~

Done:

- ~~Introduce a collaboration-oriented operation model before adding Yjs.~~
  (`src/editor/operations.ts` + `src/ui/useEditorHistory.ts`; undo/redo now
  operation-based and origin-tagged.)
- ~~Add real tileset/atlas support instead of color-only tiles.~~
  (`src/editor/tileset.ts` + `src/ui/SpriteEditor.tsx`; texture -> sprite -> tile
  model with a user-driven Sprite Editor; both renderers draw real textures.
  Follow-ups: move/resize handles for existing sprite rects, snap-to-grid while
  drawing, multi-cell brushes, per-tile collision metadata.)

- ~~Add selection and rectangular fill tools.~~ (`rect` fill tool + Select tool
  with rectangle/lasso modes, move-by-drag, delete, and copy/paste — see
  `src/editor/selection.ts`. Follow-ups: cross-layer selection, floating paste
  placement, tile brush shapes, eyedropper.)

Good next tasks:

1. Add project format versioning and stricter validation.
2. Split `EditorCanvas.tsx` into smaller UI components.
3. Add proper entity model separate from tile layers.
4. Wire operations to Yjs/CRDT + presence for realtime collaboration.

### Known rendering caveat (tilesets)

The WebGPU renderer draws in three passes: grid + flat-color tiles, then
textured sprite tiles, then the hover outline. So a sprite tile always renders
on top of a flat-color tile even if the color tile is on a higher layer. This is
fine while most tiles are sprites (color is a fallback), but interleaving by
layer order is a future improvement if mixed color/sprite layers become common.

## Collaboration Direction

Do not add realtime sync directly to React state as the final architecture.

Status: steps 1–3 below are implemented (`src/editor/operations.ts` +
`src/ui/useEditorHistory.ts`). Steps 4–5 (Yjs/CRDT mapping and presence) remain.

A better path is:

1. Define editor operations:
   - paint cell
   - erase cell
   - add layer
   - remove layer
   - rename layer
   - move entity
   - update tile definition
2. Apply operations to the local `EditorProject`.
3. Make undo/redo operate on operations, tagged by author/origin, so each user
   undoes only their own most-recent change (per-user undo — see the note under
   "Undo/Redo Notes"). Do not carry the whole-project snapshot approach forward.
4. Later map operations or shared project state onto Yjs/CRDT (its `UndoManager`
   can be scoped to the local client's origin to realize per-user undo).
5. Add presence separately:
   - user cursor
   - selected tool
   - selected layer
   - selected cells

This keeps the app aligned with the long-term Figma/Miro-like goal.

