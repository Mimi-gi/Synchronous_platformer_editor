import type { EditorProject, TileLayer } from "../editor/types";

export function isEditorProject(value: unknown): value is EditorProject {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.tileSize !== "number") return false;
  if (!Array.isArray(value.tiles) || value.tiles.length === 0) return false;
  if (!Array.isArray(value.levels) || value.levels.length === 0) return false;

  return value.tiles.every(isTileDefinition) && value.levels.every(isLevel);
}

function isLevel(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.width !== "number") return false;
  if (typeof value.height !== "number") return false;
  if (!Array.isArray(value.layers) || value.layers.length === 0) return false;

  return value.layers.every(isTileLayer);
}

function isTileLayer(value: unknown): value is TileLayer {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (value.kind !== "tile") return false;
  if (typeof value.visible !== "boolean") return false;
  if (typeof value.opacity !== "number") return false;
  if (!isRecord(value.cells)) return false;

  return Object.values(value.cells).every((cell) => {
    if (!isRecord(cell)) return false;
    return typeof cell.tileId === "number" && typeof cell.color === "string";
  });
}

function isTileDefinition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    typeof value.color === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
