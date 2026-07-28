export type ToolMode = "select" | "paint" | "erase" | "pan";

export type TileCell = {
  tileId: number;
  color: string;
};

export type TileDefinition = {
  id: number;
  name: string;
  /** Fallback fill / tint used when the tile has no sprite. */
  color: string;
  /** When set, the tile renders this sprite instead of a flat color. */
  spriteId?: string;
};

/**
 * An imported image asset (Unity-like "texture"). Stored as a data URL so the
 * project stays self-contained across JSON export/import.
 */
export type TextureAsset = {
  id: string;
  name: string;
  /** Data URL (e.g. "data:image/png;base64,..."). */
  src: string;
  width: number;
  height: number;
};

/** A named rectangular region of a texture (Unity-like "sprite"). */
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
  /** Identity color used for the sidebar swatch and the "Layer focus" tint. */
  color: string;
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

export type Viewport = {
  centerX: number;
  centerY: number;
  zoom: number;
};

export type GridCell = {
  x: number;
  y: number;
};
