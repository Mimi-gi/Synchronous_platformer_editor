import type { EditorProject, GridCell, ToolMode, Viewport } from "../editor/types";

export type RendererKind = "webgpu" | "canvas2d";

export type RendererSize = {
  width: number;
  height: number;
  dpr: number;
};

export type RenderFrame = {
  project: EditorProject;
  viewport: Viewport;
  size: RendererSize;
  activeLevelId: string;
  activeLayerId: string;
  hoverCell: GridCell | null;
  selectedTool: ToolMode;
};

export interface EditorRenderer {
  readonly kind: RendererKind;
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(size: RendererSize): void;
  render(frame: RenderFrame): void;
  destroy(): void;
}
