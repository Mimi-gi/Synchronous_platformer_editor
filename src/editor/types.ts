export type ToolMode = "select" | "paint" | "erase" | "pan";

export type TileCell = {
  tileId: number;
  color: string;
};

export type TileLayer = {
  id: string;
  name: string;
  kind: "tile";
  visible: boolean;
  opacity: number;
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
