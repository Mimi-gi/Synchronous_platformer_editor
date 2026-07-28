import type {
  EditorProject,
  Sprite,
  TextureAsset,
  TileCell,
  TileDefinition,
  TileLayer,
} from "./types";

/**
 * Editor operations are the single, framework-agnostic vocabulary for every
 * change to an `EditorProject`. They are plain serializable data so that the
 * same operations can later be shipped over the wire and applied on top of a
 * Yjs/CRDT document. Nothing in this module depends on React.
 *
 * Each operation is applied through `applyOperation`, which also returns the
 * inverse operation. Undo/redo is expressed entirely as (re)applying
 * operations, never as whole-project snapshots — see `useEditorHistory`.
 */

export type LayerPatch = Partial<Pick<TileLayer, "name" | "visible" | "opacity" | "color">>;

export type SpritePatch = Partial<Pick<Sprite, "name" | "x" | "y" | "w" | "h">>;

export type Operation =
  // Paint (cell != null) or erase (cell == null) a single cell on a layer.
  | { type: "setCell"; layerId: string; key: string; cell: TileCell | null }
  // Change layer metadata (name / visibility / opacity / identity color).
  | { type: "patchLayer"; layerId: string; patch: LayerPatch }
  // Asset operations (Unity-like texture -> sprite -> tile pipeline). Adds and
  // removes are inverses of each other, so importing a sliced tileset (a
  // transaction of addTexture + addSprite… + addTile…) is fully undoable.
  | { type: "addTexture"; texture: TextureAsset }
  | { type: "removeTexture"; textureId: string }
  | { type: "addSprite"; sprite: Sprite }
  | { type: "removeSprite"; spriteId: string }
  | { type: "updateSprite"; spriteId: string; patch: SpritePatch }
  | { type: "addTile"; tile: TileDefinition }
  | { type: "removeTile"; tileId: number }
  // Replace the whole project (used by import). Kept as an operation so it also
  // participates in undo/redo instead of bypassing history.
  | { type: "replaceProject"; project: EditorProject };

/** Identifies who authored an operation. Enables per-user undo later. */
export type Origin = string;

export const LOCAL_ORIGIN: Origin = "local";

export type ApplyResult = {
  /** New project, or the SAME reference when the operation changed nothing. */
  project: EditorProject;
  /** Operation that reverses this one against the returned project. */
  inverse: Operation;
};

function withLayers(project: EditorProject, layers: TileLayer[]): EditorProject {
  const [level, ...rest] = project.levels;
  return { ...project, levels: [{ ...level, layers }, ...rest] };
}

function noop(project: EditorProject, op: Operation): ApplyResult {
  return { project, inverse: op };
}

function cellsEqual(a: TileCell | null, b: TileCell | null): boolean {
  if (a === null || b === null) return a === b;
  return a.tileId === b.tileId && a.color === b.color;
}

export function applyOperation(project: EditorProject, op: Operation): ApplyResult {
  switch (op.type) {
    case "setCell": {
      const level = project.levels[0];
      const layerIndex = level.layers.findIndex((layer) => layer.id === op.layerId);
      if (layerIndex < 0) return { project, inverse: op };

      const layer = level.layers[layerIndex];
      const previous = layer.cells[op.key] ?? null;
      if (cellsEqual(previous, op.cell)) {
        return { project, inverse: op };
      }

      const inverse: Operation = {
        type: "setCell",
        layerId: op.layerId,
        key: op.key,
        cell: previous,
      };

      const nextCells = { ...layer.cells };
      if (op.cell) nextCells[op.key] = op.cell;
      else delete nextCells[op.key];

      const nextLayers = [...level.layers];
      nextLayers[layerIndex] = { ...layer, cells: nextCells };
      return { project: withLayers(project, nextLayers), inverse };
    }

    case "patchLayer": {
      const level = project.levels[0];
      const layerIndex = level.layers.findIndex((layer) => layer.id === op.layerId);
      if (layerIndex < 0) return { project, inverse: op };

      const layer = level.layers[layerIndex];
      const keys = Object.keys(op.patch) as (keyof LayerPatch)[];
      const changed = keys.some((key) => layer[key] !== op.patch[key]);
      if (!changed) return { project, inverse: op };

      const inversePatch: LayerPatch = {};
      for (const key of keys) {
        // Restore whatever the field was before this patch.
        (inversePatch as Record<string, unknown>)[key] = layer[key];
      }
      const inverse: Operation = { type: "patchLayer", layerId: op.layerId, patch: inversePatch };

      const nextLayers = [...level.layers];
      nextLayers[layerIndex] = { ...layer, ...op.patch };
      return { project: withLayers(project, nextLayers), inverse };
    }

    case "addTexture": {
      const inverse: Operation = { type: "removeTexture", textureId: op.texture.id };
      return { project: { ...project, textures: [...project.textures, op.texture] }, inverse };
    }

    case "removeTexture": {
      const texture = project.textures.find((item) => item.id === op.textureId);
      if (!texture) return noop(project, op);
      const inverse: Operation = { type: "addTexture", texture };
      return {
        project: { ...project, textures: project.textures.filter((item) => item.id !== op.textureId) },
        inverse,
      };
    }

    case "addSprite": {
      const inverse: Operation = { type: "removeSprite", spriteId: op.sprite.id };
      return { project: { ...project, sprites: [...project.sprites, op.sprite] }, inverse };
    }

    case "removeSprite": {
      const sprite = project.sprites.find((item) => item.id === op.spriteId);
      if (!sprite) return noop(project, op);
      const inverse: Operation = { type: "addSprite", sprite };
      return {
        project: { ...project, sprites: project.sprites.filter((item) => item.id !== op.spriteId) },
        inverse,
      };
    }

    case "updateSprite": {
      const index = project.sprites.findIndex((item) => item.id === op.spriteId);
      if (index < 0) return noop(project, op);

      const sprite = project.sprites[index];
      const keys = Object.keys(op.patch) as (keyof SpritePatch)[];
      const changed = keys.some((key) => sprite[key] !== op.patch[key]);
      if (!changed) return noop(project, op);

      const inversePatch: SpritePatch = {};
      for (const key of keys) {
        (inversePatch as Record<string, unknown>)[key] = sprite[key];
      }
      const nextSprites = [...project.sprites];
      nextSprites[index] = { ...sprite, ...op.patch };
      return {
        project: { ...project, sprites: nextSprites },
        inverse: { type: "updateSprite", spriteId: op.spriteId, patch: inversePatch },
      };
    }

    case "addTile": {
      const inverse: Operation = { type: "removeTile", tileId: op.tile.id };
      return { project: { ...project, tiles: [...project.tiles, op.tile] }, inverse };
    }

    case "removeTile": {
      const tile = project.tiles.find((item) => item.id === op.tileId);
      if (!tile) return noop(project, op);
      const inverse: Operation = { type: "addTile", tile };
      return {
        project: { ...project, tiles: project.tiles.filter((item) => item.id !== op.tileId) },
        inverse,
      };
    }

    case "replaceProject": {
      if (op.project === project) return { project, inverse: op };
      const inverse: Operation = { type: "replaceProject", project };
      return { project: op.project, inverse };
    }
  }
}
