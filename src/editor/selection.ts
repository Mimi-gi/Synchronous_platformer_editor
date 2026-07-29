import type { CellRect, EditorProject, GridCell, TileCell } from "./types";

export type CellSet = Set<string>;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseCellKey(key: string): GridCell {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

export function rectToCells(rect: CellRect): CellSet {
  const set = new Set<string>();
  for (let y = rect.minY; y <= rect.maxY; y += 1) {
    for (let x = rect.minX; x <= rect.maxX; x += 1) {
      set.add(cellKey(x, y));
    }
  }
  return set;
}

export function shiftCells(cells: Iterable<string>, dx: number, dy: number): CellSet {
  const set = new Set<string>();
  for (const key of cells) {
    const { x, y } = parseCellKey(key);
    set.add(cellKey(x + dx, y + dy));
  }
  return set;
}

/** Cells a straight line between two cells passes through (Bresenham). */
function rasterLine(a: GridCell, b: GridCell, out: CellSet): void {
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    out.add(cellKey(x0, y0));
    if (x0 === b.x && y0 === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** True if the point (px, py) lies inside the polygon (ray casting). */
function pointInPolygon(px: number, py: number, polygon: GridCell[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Cells enclosed by a freeform (lasso) path, boundary included. The path is a
 * list of cell coordinates; the polygon is implicitly closed. Boundary cells
 * come from rasterizing the path segments; interior cells from a point-in-
 * polygon test on each cell center within the path's bounding box.
 */
export function lassoToCells(path: GridCell[], width: number, height: number): CellSet {
  const set = new Set<string>();
  if (path.length === 0) return set;

  // Boundary: rasterize every segment plus the closing segment.
  for (let i = 0; i < path.length; i += 1) {
    const next = path[(i + 1) % path.length];
    rasterLine(path[i], next, set);
  }

  // Interior: test cell centers inside the polygon's bounding box.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of path) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, path)) set.add(cellKey(x, y));
    }
  }

  // Clamp to the level bounds.
  const clamped = new Set<string>();
  for (const key of set) {
    const { x, y } = parseCellKey(key);
    if (x >= 0 && y >= 0 && x < width && y < height) clamped.add(key);
  }
  return clamped;
}

/**
 * Live preview of moving a set of cells within one layer: the moved cells are
 * removed from their original positions and re-placed at the offset (dropping
 * any that fall outside the level). Does not touch history.
 */
export function moveCellsPreview(
  project: EditorProject,
  layerId: string,
  content: Map<string, TileCell>,
  dx: number,
  dy: number,
  width: number,
  height: number,
): EditorProject {
  const level = project.levels[0];
  const layerIndex = level.layers.findIndex((layer) => layer.id === layerId);
  if (layerIndex < 0) return project;

  const layer = level.layers[layerIndex];
  const nextCells: Record<string, TileCell> = { ...layer.cells };
  for (const key of content.keys()) {
    delete nextCells[key];
  }
  for (const [key, cell] of content) {
    const { x, y } = parseCellKey(key);
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
      nextCells[cellKey(nx, ny)] = cell;
    }
  }

  const nextLayers = [...level.layers];
  nextLayers[layerIndex] = { ...layer, cells: nextCells };
  return { ...project, levels: [{ ...level, layers: nextLayers }, ...project.levels.slice(1)] };
}
