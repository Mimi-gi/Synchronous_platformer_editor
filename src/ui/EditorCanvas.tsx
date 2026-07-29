import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { createInitialProject } from "../editor/createInitialProject";
import type {
  CellRect,
  EditorProject,
  GridCell,
  Sprite,
  TextureAsset,
  TileCell,
  ToolMode,
  Viewport,
} from "../editor/types";
import type { Operation } from "../editor/operations";
import { loadImageSize, makeId, readFileAsDataUrl } from "../editor/tileset";
import {
  cellKey,
  lassoToCells,
  moveCellsPreview,
  parseCellKey,
  rectToCells,
  shiftCells,
} from "../editor/selection";
import type { EditorRenderer, RendererKind, RendererSize } from "../rendering/Renderer";
import { createRenderer } from "../rendering/createRenderer";
import { isEditorProject } from "../project/validateProject";
import { useEditorHistory } from "./useEditorHistory";
import { SpriteEditor } from "./SpriteEditor";
import type { DraftSprite } from "./SpriteEditor";

/** CSS background that shows a single sprite region scaled to fill the element. */
function spriteBackground(texture: TextureAsset, sprite: Sprite): CSSProperties {
  const sizeX = (texture.width / sprite.w) * 100;
  const sizeY = (texture.height / sprite.h) * 100;
  const posX = texture.width > sprite.w ? (sprite.x / (texture.width - sprite.w)) * 100 : 0;
  const posY = texture.height > sprite.h ? (sprite.y / (texture.height - sprite.h)) * 100 : 0;
  return {
    backgroundImage: `url("${texture.src}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${sizeX}% ${sizeY}%`,
    backgroundPosition: `${posX}% ${posY}%`,
    imageRendering: "pixelated",
  };
}

const TOOL_LABELS: Record<ToolMode, string> = {
  select: "Select",
  paint: "Paint",
  erase: "Erase",
  rect: "Rect",
  pan: "Pan",
};

const TOOL_SHORTCUTS: Record<ToolMode, string> = {
  select: "V",
  paint: "P",
  erase: "E",
  rect: "R",
  pan: "H",
};

const LAYER_COLOR_PALETTE = ["#4cc2ff", "#ff7ab6", "#ffd166", "#8ce99a", "#b197fc", "#ffa94d"];

export function EditorCanvas() {
  const {
    project,
    getSnapshot,
    setProjectSilent,
    dispatch,
    transact,
    begin,
    mutate,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useEditorHistory(createInitialProject);

  const [activeLayerId, setActiveLayerId] = useState("terrain");
  const [selectedTileId, setSelectedTileId] = useState(1);
  const [selectedTool, setSelectedTool] = useState<ToolMode>("paint");
  const [layerFocus, setLayerFocus] = useState(true);
  const [editingTextureId, setEditingTextureId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ centerX: 480, centerY: 320, zoom: 1 });
  const [hoverCell, setHoverCell] = useState<GridCell | null>(null);
  const [previewRect, setPreviewRect] = useState<CellRect | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [selectMode, setSelectMode] = useState<"rect" | "lasso">("rect");
  const [rendererKind, setRendererKind] = useState<RendererKind | "initializing">("initializing");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textureInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<EditorRenderer | null>(null);
  const sizeRef = useRef<RendererSize>({ width: 1, height: 1, dpr: 1 });
  const dragRef = useRef<{ x: number; y: number; viewport: Viewport } | null>(null);
  // True while a paint/erase stroke transaction is open, so pointer-move keeps
  // applying to the same undo entry.
  const strokingRef = useRef(false);
  // Start cell of an in-progress rect-tool / rectangle-select drag.
  const rectDragStartRef = useRef<GridCell | null>(null);
  // Accumulated path (cell coords) of an in-progress lasso selection.
  const lassoPathRef = useRef<GridCell[] | null>(null);
  // In-progress move of a selection (drag inside the selection).
  const moveRef = useRef<{
    startCell: GridCell;
    base: EditorProject;
    layerId: string;
    content: Map<string, TileCell>;
    originalSelection: Set<string>;
  } | null>(null);
  // Copy/paste buffer: cell contents relative to the selection's top-left.
  const clipboardRef = useRef<{ dx: number; dy: number; cell: TileCell }[] | null>(null);
  const hoverCellRef = useRef<GridCell | null>(null);
  hoverCellRef.current = hoverCell;

  const activeLevel = project.levels[0];
  const activeLayer = activeLevel.layers.find((layer) => layer.id === activeLayerId) ?? activeLevel.layers[0];
  const selectedTile = project.tiles.find((tile) => tile.id === selectedTileId) ?? project.tiles[0];
  const tileCount = useMemo(
    () => Object.keys(activeLayer.cells).length,
    [activeLayer.cells],
  );
  const spritesById = useMemo(
    () => new Map<string, Sprite>(project.sprites.map((sprite) => [sprite.id, sprite])),
    [project.sprites],
  );
  const texturesById = useMemo(
    () => new Map<string, TextureAsset>(project.textures.map((texture) => [texture.id, texture])),
    [project.textures],
  );
  const editingTexture = editingTextureId ? texturesById.get(editingTextureId) : undefined;

  // --- Renderer lifecycle ------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    createRenderer(canvas)
      .then((renderer) => {
        if (cancelled) {
          renderer.destroy();
          return;
        }

        rendererRef.current = renderer;
        setRendererKind(renderer.kind);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      sizeRef.current = { width, height, dpr };
      rendererRef.current?.resize(sizeRef.current);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      rendererRef.current?.render({
        project,
        viewport,
        size: sizeRef.current,
        activeLevelId: activeLevel.id,
        activeLayerId: activeLayer.id,
        hoverCell,
        selectedTool,
        layerFocus,
        previewRect,
        selection,
      });
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    activeLayer.id,
    activeLevel.id,
    hoverCell,
    layerFocus,
    previewRect,
    project,
    selectedTool,
    selection,
    viewport,
  ]);

  // --- Coordinate helpers ------------------------------------------------

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      const dpr = sizeRef.current.dpr;
      const x = ((cssX * dpr - sizeRef.current.width / 2) / viewport.zoom) + viewport.centerX;
      const y = ((cssY * dpr - sizeRef.current.height / 2) / viewport.zoom) + viewport.centerY;

      return { x, y };
    },
    [viewport],
  );

  const worldToCell = useCallback(
    (worldX: number, worldY: number): GridCell | null => {
      const tileSize = project.tileSize;
      const x = Math.floor(worldX / tileSize);
      const y = Math.floor(worldY / tileSize);

      if (x < 0 || y < 0 || x >= activeLevel.width || y >= activeLevel.height) {
        return null;
      }

      return { x, y };
    },
    [activeLevel.height, activeLevel.width, project.tileSize],
  );

  const clampCells = useCallback(
    (cells: Set<string>): Set<string> => {
      const result = new Set<string>();
      for (const key of cells) {
        const { x, y } = parseCellKey(key);
        if (x >= 0 && y >= 0 && x < activeLevel.width && y < activeLevel.height) result.add(key);
      }
      return result;
    },
    [activeLevel.height, activeLevel.width],
  );

  // Like worldToCell but clamps to the level bounds so rect drags keep tracking
  // even when the pointer leaves the map.
  const worldToCellClamped = useCallback(
    (worldX: number, worldY: number): GridCell => {
      const tileSize = project.tileSize;
      const x = Math.floor(worldX / tileSize);
      const y = Math.floor(worldY / tileSize);
      return {
        x: Math.max(0, Math.min(activeLevel.width - 1, x)),
        y: Math.max(0, Math.min(activeLevel.height - 1, y)),
      };
    },
    [activeLevel.height, activeLevel.width, project.tileSize],
  );

  // --- Editing operations ------------------------------------------------

  const applyToolAt = useCallback(
    (cell: GridCell | null) => {
      if (!cell || selectedTool === "select" || selectedTool === "pan") return;

      const key = `${cell.x},${cell.y}`;
      const op: Operation =
        selectedTool === "paint"
          ? {
              type: "setCell",
              layerId: activeLayer.id,
              key,
              cell: { tileId: selectedTile.id, color: selectedTile.color },
            }
          : { type: "setCell", layerId: activeLayer.id, key, cell: null };

      mutate(op);
    },
    [activeLayer.id, mutate, selectedTile.color, selectedTile.id, selectedTool],
  );

  const fillRect = useCallback(
    (rect: CellRect) => {
      const ops: Operation[] = [];
      for (let y = rect.minY; y <= rect.maxY; y += 1) {
        for (let x = rect.minX; x <= rect.maxX; x += 1) {
          ops.push({
            type: "setCell",
            layerId: activeLayer.id,
            key: `${x},${y}`,
            cell: { tileId: selectedTile.id, color: selectedTile.color },
          });
        }
      }
      transact(ops);
    },
    [activeLayer.id, selectedTile.color, selectedTile.id, transact],
  );

  const deleteSelection = useCallback(() => {
    if (!selection || selection.size === 0) return;
    const ops: Operation[] = [];
    for (const key of selection) {
      ops.push({ type: "setCell", layerId: activeLayer.id, key, cell: null });
    }
    transact(ops);
  }, [activeLayer.id, selection, transact]);

  const copySelection = useCallback(() => {
    if (!selection || selection.size === 0) return;
    const layer = getSnapshot().levels[0].layers.find((item) => item.id === activeLayer.id);
    if (!layer) return;

    let minX = Infinity;
    let minY = Infinity;
    for (const key of selection) {
      const { x, y } = parseCellKey(key);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }

    const cells: { dx: number; dy: number; cell: TileCell }[] = [];
    for (const key of selection) {
      const cell = layer.cells[key];
      if (!cell) continue;
      const { x, y } = parseCellKey(key);
      cells.push({ dx: x - minX, dy: y - minY, cell });
    }
    clipboardRef.current = cells.length > 0 ? cells : null;
  }, [activeLayer.id, getSnapshot, selection]);

  const pasteClipboard = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard) return;
    const anchor = hoverCellRef.current ?? { x: 0, y: 0 };
    const ops: Operation[] = [];
    const pasted = new Set<string>();

    for (const { dx, dy, cell } of clipboard) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (x < 0 || y < 0 || x >= activeLevel.width || y >= activeLevel.height) continue;
      ops.push({ type: "setCell", layerId: activeLayer.id, key: cellKey(x, y), cell });
      pasted.add(cellKey(x, y));
    }

    if (ops.length > 0) {
      transact(ops);
      setSelection(pasted);
    }
  }, [activeLayer.id, activeLevel.height, activeLevel.width, transact]);

  const toggleLayerVisibility = useCallback(
    (layerId: string) => {
      const layer = getSnapshot().levels[0].layers.find((item) => item.id === layerId);
      if (!layer) return;
      dispatch({ type: "patchLayer", layerId, patch: { visible: !layer.visible } });
    },
    [dispatch, getSnapshot],
  );

  const setLayerOpacity = useCallback(
    (layerId: string, opacity: number) => {
      mutate({ type: "patchLayer", layerId, patch: { opacity } });
    },
    [mutate],
  );

  const setLayerColor = useCallback(
    (layerId: string, color: string) => {
      dispatch({ type: "patchLayer", layerId, patch: { color } });
    },
    [dispatch],
  );

  const resetZoom = useCallback(() => {
    setViewport((current) => ({ ...current, zoom: 1 }));
  }, []);

  // --- Import / export ---------------------------------------------------

  const downloadProject = useCallback(() => {
    const current = getSnapshot();
    const blob = new Blob([JSON.stringify(current, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${current.name.toLowerCase().replaceAll(" ", "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [getSnapshot]);

  const importProject = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) return;

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as unknown;
          if (!isEditorProject(parsed)) {
            throw new Error("The selected JSON does not match the editor project format.");
          }

          // Backfill identity colors for projects saved before layer colors existed.
          const nextProject: EditorProject = {
            ...parsed,
            levels: parsed.levels.map((level) => ({
              ...level,
              layers: level.layers.map((layer, index) => ({
                ...layer,
                color: layer.color ?? LAYER_COLOR_PALETTE[index % LAYER_COLOR_PALETTE.length],
              })),
            })),
          };

          const nextLevel = nextProject.levels[0];
          const nextLayer = nextLevel.layers[0];
          const nextTile = nextProject.tiles[0];

          dispatch({ type: "replaceProject", project: nextProject });
          setActiveLayerId(nextLayer.id);
          setSelectedTileId(nextTile.id);
          setViewport({
            centerX: (nextLevel.width * nextProject.tileSize) / 2,
            centerY: (nextLevel.height * nextProject.tileSize) / 2,
            zoom: 1,
          });
        } catch (error) {
          console.error("Could not import project JSON.", error);
        }
      });
      reader.readAsText(file);
    },
    [dispatch],
  );

  const importTexture = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const src = await readFileAsDataUrl(file);
        const { width, height } = await loadImageSize(src);
        const texture: TextureAsset = {
          id: makeId("texture"),
          name: file.name.replace(/\.[^.]+$/, ""),
          src,
          width,
          height,
        };

        // Just register the texture; the user slices it into sprites themselves.
        dispatch({ type: "addTexture", texture });
        setEditingTextureId(texture.id);
      } catch (error) {
        console.error("Could not import texture.", error);
      }
    },
    [dispatch],
  );

  // Commits the sprites drawn in the Sprite Editor for a texture, syncing tiles:
  // added sprites get a tile, removed sprites lose theirs, and edited sprites
  // keep their id so already-painted cells stay valid.
  const applySprites = useCallback(
    (textureId: string, drafts: DraftSprite[]) => {
      const snapshot = getSnapshot();
      const existing = snapshot.sprites.filter((sprite) => sprite.textureId === textureId);
      const keptIds = new Set(drafts.map((draft) => draft.spriteId).filter(Boolean) as string[]);
      const ops: Operation[] = [];
      let nextTileId = snapshot.tiles.reduce((max, tile) => Math.max(max, tile.id), 0) + 1;

      // Removed sprites: drop the sprite and any tiles referencing it.
      for (const sprite of existing) {
        if (keptIds.has(sprite.id)) continue;
        for (const tile of snapshot.tiles.filter((tile) => tile.spriteId === sprite.id)) {
          ops.push({ type: "removeTile", tileId: tile.id });
        }
        ops.push({ type: "removeSprite", spriteId: sprite.id });
      }

      for (const draft of drafts) {
        if (draft.spriteId) {
          const sprite = existing.find((item) => item.id === draft.spriteId);
          if (
            sprite &&
            (sprite.x !== draft.x ||
              sprite.y !== draft.y ||
              sprite.w !== draft.w ||
              sprite.h !== draft.h ||
              sprite.name !== draft.name)
          ) {
            ops.push({
              type: "updateSprite",
              spriteId: sprite.id,
              patch: { x: draft.x, y: draft.y, w: draft.w, h: draft.h, name: draft.name },
            });
          }
        } else {
          const spriteId = makeId("sprite");
          ops.push({
            type: "addSprite",
            sprite: { id: spriteId, name: draft.name, textureId, x: draft.x, y: draft.y, w: draft.w, h: draft.h },
          });
          ops.push({ type: "addTile", tile: { id: nextTileId, name: draft.name, color: "#8aa0b4", spriteId } });
          nextTileId += 1;
        }
      }

      if (ops.length > 0) transact(ops);
      setEditingTextureId(null);
    },
    [getSnapshot, transact],
  );

  // --- Keyboard shortcuts ------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The Sprite Editor modal owns keyboard input while it is open.
      if (editingTextureId !== null) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod) {
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === "y") {
          event.preventDefault();
          redo();
        } else if (key === "s") {
          event.preventDefault();
          downloadProject();
        } else if (key === "0") {
          event.preventDefault();
          resetZoom();
        } else if (key === "c") {
          copySelection();
        } else if (key === "v") {
          event.preventDefault();
          pasteClipboard();
        }
        return;
      }

      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === "escape") {
        setSelection(null);
        return;
      }

      switch (key) {
        case "v":
          setSelectedTool("select");
          break;
        case "b":
        case "p":
          setSelectedTool("paint");
          break;
        case "e":
          setSelectedTool("erase");
          break;
        case "r":
          setSelectedTool("rect");
          break;
        case "h":
          setSelectedTool("pan");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    copySelection,
    deleteSelection,
    downloadProject,
    editingTextureId,
    pasteClipboard,
    redo,
    resetZoom,
    undo,
  ]);

  // --- Pointer interaction -----------------------------------------------

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = screenToWorld(event.clientX, event.clientY);
    const cell = worldToCell(world.x, world.y);
    setHoverCell(cell);

    if (selectedTool === "pan" || event.button === 1 || event.altKey) {
      dragRef.current = { x: event.clientX, y: event.clientY, viewport };
      return;
    }

    if (selectedTool === "paint" || selectedTool === "erase") {
      begin();
      strokingRef.current = true;
      applyToolAt(cell);
      return;
    }

    if (selectedTool === "rect") {
      const start = worldToCellClamped(world.x, world.y);
      rectDragStartRef.current = start;
      setPreviewRect({ minX: start.x, minY: start.y, maxX: start.x, maxY: start.y });
      return;
    }

    if (selectedTool === "select") {
      const start = worldToCellClamped(world.x, world.y);
      const startKey = cellKey(start.x, start.y);

      if (selection && selection.has(startKey)) {
        // Drag inside the selection -> move it (active layer only).
        const base = getSnapshot();
        const layer = base.levels[0].layers.find((item) => item.id === activeLayer.id);
        const content = new Map<string, TileCell>();
        if (layer) {
          for (const key of selection) {
            const cell = layer.cells[key];
            if (cell) content.set(key, cell);
          }
        }
        moveRef.current = {
          startCell: start,
          base,
          layerId: activeLayer.id,
          content,
          originalSelection: new Set(selection),
        };
        return;
      }

      // Otherwise start a fresh selection.
      setSelection(null);
      if (selectMode === "rect") {
        rectDragStartRef.current = start;
        setPreviewRect({ minX: start.x, minY: start.y, maxX: start.x, maxY: start.y });
      } else {
        lassoPathRef.current = [start];
      }
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const start = dragRef.current;
      setViewport({
        ...start.viewport,
        centerX: start.viewport.centerX - (event.clientX - start.x) * sizeRef.current.dpr / start.viewport.zoom,
        centerY: start.viewport.centerY - (event.clientY - start.y) * sizeRef.current.dpr / start.viewport.zoom,
      });
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    const cell = worldToCell(world.x, world.y);
    setHoverCell(cell);

    // Moving a selection: live-preview the shifted cells (no history yet).
    if (moveRef.current) {
      const move = moveRef.current;
      const current = worldToCellClamped(world.x, world.y);
      const dx = current.x - move.startCell.x;
      const dy = current.y - move.startCell.y;
      const preview = moveCellsPreview(
        move.base,
        move.layerId,
        move.content,
        dx,
        dy,
        activeLevel.width,
        activeLevel.height,
      );
      setProjectSilent(preview);
      setSelection(clampCells(shiftCells(move.originalSelection, dx, dy)));
      return;
    }

    if (rectDragStartRef.current) {
      const start = rectDragStartRef.current;
      const end = worldToCellClamped(world.x, world.y);
      setPreviewRect({
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
      });
      return;
    }

    if (lassoPathRef.current) {
      const path = lassoPathRef.current;
      const current = worldToCellClamped(world.x, world.y);
      const last = path[path.length - 1];
      if (!last || last.x !== current.x || last.y !== current.y) {
        path.push(current);
      }
      setSelection(lassoToCells(path, activeLevel.width, activeLevel.height));
      return;
    }

    if (event.buttons === 1 && strokingRef.current) {
      applyToolAt(cell);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;

    if (strokingRef.current) {
      commit();
      strokingRef.current = false;
      return;
    }

    // Finalize a selection move: commit the shift as one transaction.
    if (moveRef.current) {
      const move = moveRef.current;
      moveRef.current = null;
      const world = screenToWorld(event.clientX, event.clientY);
      const current = worldToCellClamped(world.x, world.y);
      const dx = current.x - move.startCell.x;
      const dy = current.y - move.startCell.y;

      // Reset to the pre-move project so the transaction's inverses are correct.
      setProjectSilent(move.base);

      if (dx !== 0 || dy !== 0) {
        const ops: Operation[] = [];
        for (const key of move.content.keys()) {
          ops.push({ type: "setCell", layerId: move.layerId, key, cell: null });
        }
        for (const [key, cell] of move.content) {
          const { x, y } = parseCellKey(key);
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < activeLevel.width && ny < activeLevel.height) {
            ops.push({ type: "setCell", layerId: move.layerId, key: cellKey(nx, ny), cell });
          }
        }
        transact(ops);
        setSelection(clampCells(shiftCells(move.originalSelection, dx, dy)));
      }
      return;
    }

    if (rectDragStartRef.current) {
      const start = rectDragStartRef.current;
      rectDragStartRef.current = null;
      const world = screenToWorld(event.clientX, event.clientY);
      const end = worldToCellClamped(world.x, world.y);
      const rect: CellRect = {
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
      };
      setPreviewRect(null);
      if (selectedTool === "rect") {
        fillRect(rect);
      } else {
        setSelection(rectToCells(rect));
      }
      return;
    }

    if (lassoPathRef.current) {
      const path = lassoPathRef.current;
      lassoPathRef.current = null;
      setSelection(lassoToCells(path, activeLevel.width, activeLevel.height));
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = sizeRef.current.dpr;
    const pointerX = (event.clientX - rect.left) * dpr;
    const pointerY = (event.clientY - rect.top) * dpr;

    setViewport((current) => {
      const nextZoom = Math.min(4, Math.max(0.25, current.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
      // World position under the cursor before zooming; keep it fixed afterwards.
      const worldX = (pointerX - sizeRef.current.width / 2) / current.zoom + current.centerX;
      const worldY = (pointerY - sizeRef.current.height / 2) / current.zoom + current.centerY;

      return {
        zoom: nextZoom,
        centerX: worldX - (pointerX - sizeRef.current.width / 2) / nextZoom,
        centerY: worldY - (pointerY - sizeRef.current.height / 2) / nextZoom,
      };
    });
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Project navigation">
        <div>
          <p className="eyebrow">Project</p>
          <h1>{project.name}</h1>
        </div>

        <section className="panel">
          <h2>Level</h2>
          <div className="metric-row">
            <span>{activeLevel.name}</span>
            <strong>
              {activeLevel.width} x {activeLevel.height}
            </strong>
          </div>
          <div className="metric-row">
            <span>Tile size</span>
            <strong>{project.tileSize}px</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Layers</h2>
            <button
              className={layerFocus ? "chip-toggle active" : "chip-toggle"}
              onClick={() => setLayerFocus((current) => !current)}
              type="button"
              aria-pressed={layerFocus}
              title="Emphasize the active layer and tint layers by their color"
            >
              Layer focus
            </button>
          </div>
          {activeLevel.layers.map((layer) => (
            <div
              className={layer.id === activeLayer.id ? "layer-row active" : "layer-row"}
              key={layer.id}
            >
              <button
                className="layer-visibility"
                onClick={() => toggleLayerVisibility(layer.id)}
                type="button"
                aria-pressed={layer.visible}
                title={layer.visible ? "Hide layer" : "Show layer"}
              >
                <span
                  className={layer.visible ? "vis-dot on" : "vis-dot"}
                  style={{ "--layer-color": layer.color } as CSSProperties}
                />
              </button>
              <button
                className={layer.id === activeLayer.id ? "layer-button active" : "layer-button"}
                onClick={() => setActiveLayerId(layer.id)}
                type="button"
                aria-pressed={layer.id === activeLayer.id}
              >
                <span>{layer.name}</span>
                <small>{Object.keys(layer.cells).length}</small>
              </button>
            </div>
          ))}

          <div className="layer-color-row">
            <span>Layer color</span>
            <input
              type="color"
              value={activeLayer.color}
              onChange={(event) => setLayerColor(activeLayer.id, event.target.value)}
              title={`${activeLayer.name} color`}
              aria-label={`${activeLayer.name} color`}
            />
          </div>

          <label className="layer-opacity">
            <span className="layer-opacity-label">
              Opacity
              <strong>{Math.round(activeLayer.opacity * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={activeLayer.opacity}
              onPointerDown={() => begin()}
              onPointerUp={() => commit()}
              onKeyDown={() => begin()}
              onBlur={() => commit()}
              onChange={(event) => setLayerOpacity(activeLayer.id, Number(event.target.value))}
            />
          </label>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Assets</h2>
            <button
              className="chip-toggle"
              onClick={() => textureInputRef.current?.click()}
              type="button"
              title="Import an image and slice it into tiles"
            >
              Import texture
            </button>
          </div>
          {project.textures.length === 0 ? (
            <p className="assets-empty">Import an image, then slice it into sprites.</p>
          ) : (
            project.textures.map((texture) => {
              const count = project.sprites.filter((sprite) => sprite.textureId === texture.id).length;
              return (
                <div className="texture-row" key={texture.id}>
                  <button
                    className="texture-info"
                    onClick={() => setEditingTextureId(texture.id)}
                    type="button"
                    title="Edit sprites"
                  >
                    <span>{texture.name}</span>
                    <small>{count} sprites</small>
                  </button>
                  <button
                    className="chip-toggle"
                    onClick={() => setEditingTextureId(texture.id)}
                    type="button"
                  >
                    Edit
                  </button>
                </div>
              );
            })
          )}
          <input
            ref={textureInputRef}
            accept="image/*"
            className="file-input"
            onChange={importTexture}
            type="file"
          />
        </section>

        <section className="panel">
          <h2>Tiles</h2>
          <div className="palette-grid" aria-label="Tile palette">
            {project.tiles.map((tile) => {
              const sprite = tile.spriteId ? spritesById.get(tile.spriteId) : undefined;
              const texture = sprite ? texturesById.get(sprite.textureId) : undefined;
              const spanStyle = sprite && texture ? spriteBackground(texture, sprite) : undefined;
              return (
                <button
                  className={tile.id === selectedTile.id ? "tile-swatch active" : "tile-swatch"}
                  key={tile.id}
                  onClick={() => {
                    setSelectedTileId(tile.id);
                    setSelectedTool("paint");
                  }}
                  style={{ "--swatch-color": tile.color } as CSSProperties}
                  title={tile.name}
                  type="button"
                >
                  <span style={spanStyle} />
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="workspace" aria-label="Editor workspace">
        <div className="toolbar" role="toolbar" aria-label="Editor tools">
          {(Object.keys(TOOL_LABELS) as ToolMode[]).map((tool) => (
            <button
              className={selectedTool === tool ? "tool-button active" : "tool-button"}
              key={tool}
              onClick={() => setSelectedTool(tool)}
              type="button"
              title={`${TOOL_LABELS[tool]} (${TOOL_SHORTCUTS[tool]})`}
            >
              {TOOL_LABELS[tool]}
            </button>
          ))}
          {selectedTool === "select" ? (
            <div className="select-mode" role="group" aria-label="Selection mode">
              <button
                className={selectMode === "rect" ? "chip-toggle active" : "chip-toggle"}
                onClick={() => setSelectMode("rect")}
                type="button"
                title="Rectangle selection"
              >
                Rect
              </button>
              <button
                className={selectMode === "lasso" ? "chip-toggle active" : "chip-toggle"}
                onClick={() => setSelectMode("lasso")}
                type="button"
                title="Lasso (freeform) selection"
              >
                Lasso
              </button>
            </div>
          ) : null}
          <span className="toolbar-spacer" />
          <button
            className="tool-button"
            onClick={() => undo()}
            type="button"
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className="tool-button"
            onClick={() => redo()}
            type="button"
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
          <button className="tool-button" onClick={downloadProject} type="button" title="Export (Ctrl+S)">
            Export
          </button>
          <button className="tool-button" onClick={() => fileInputRef.current?.click()} type="button">
            Import
          </button>
          <input
            ref={fileInputRef}
            accept="application/json"
            className="file-input"
            onChange={importProject}
            type="file"
          />
        </div>

        <div className="canvas-frame">
          <canvas
            ref={canvasRef}
            aria-label="Level canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverCell(null)}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          />
        </div>

        <div className="statusbar">
          <span>Renderer: {rendererKind}</span>
          <span>Zoom: {Math.round(viewport.zoom * 100)}%</span>
          <span>Tiles: {tileCount}</span>
          <span>
            Cell: {hoverCell ? `${hoverCell.x}, ${hoverCell.y}` : "-"}
          </span>
          {selection && selection.size > 0 ? <span>Sel: {selection.size} cells</span> : null}
        </div>
      </section>

      {editingTexture ? (
        <SpriteEditor
          texture={editingTexture}
          existingSprites={project.sprites.filter((sprite) => sprite.textureId === editingTexture.id)}
          defaultCell={project.tileSize}
          onApply={(drafts) => applySprites(editingTexture.id, drafts)}
          onClose={() => setEditingTextureId(null)}
        />
      ) : null}
    </main>
  );
}
