let counter = 0;

/** Reasonably unique id without pulling in a uuid dependency. */
export function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Reads a File as a data URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Loads an image (e.g. a data URL) to read its natural pixel size. */
export function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

export type SpriteRect = { x: number; y: number; w: number; h: number };

export type GridSliceParams = {
  imageWidth: number;
  imageHeight: number;
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
  spacingX: number;
  spacingY: number;
};

/** Upper bound so an oversized grid cannot freeze the app. */
const MAX_CELLS = 4096;

/**
 * Slices an image into a grid of sprite rectangles (Unity "Grid By Cell Size").
 * `offset` skips a margin before the first cell; `spacing` is the gap between
 * cells. Cells that would extend past the image edge are dropped.
 */
export function gridSliceRects(params: GridSliceParams): SpriteRect[] {
  const cellWidth = Math.max(1, Math.floor(params.cellWidth));
  const cellHeight = Math.max(1, Math.floor(params.cellHeight));
  const spacingX = Math.max(0, Math.floor(params.spacingX));
  const spacingY = Math.max(0, Math.floor(params.spacingY));
  const offsetX = Math.max(0, Math.floor(params.offsetX));
  const offsetY = Math.max(0, Math.floor(params.offsetY));

  const rects: SpriteRect[] = [];
  for (let y = offsetY; y + cellHeight <= params.imageHeight; y += cellHeight + spacingY) {
    for (let x = offsetX; x + cellWidth <= params.imageWidth; x += cellWidth + spacingX) {
      rects.push({ x, y, w: cellWidth, h: cellHeight });
      if (rects.length >= MAX_CELLS) return rects;
    }
  }
  return rects;
}
