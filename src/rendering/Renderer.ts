import type { CellRect, EditorProject, GridCell, ToolMode, Viewport } from "../editor/types";

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
  layerFocus: boolean;
  /** In-progress drag rectangle for the rect tool / rectangle-select drag. */
  previewRect: CellRect | null;
  /** Selected cells ("x,y" keys) — committed selection, lasso preview, or a
   *  selection being dragged (already shifted to its live position). */
  selection: ReadonlySet<string> | null;
};

export interface EditorRenderer {
  readonly kind: RendererKind;
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(size: RendererSize): void;
  render(frame: RenderFrame): void;
  destroy(): void;
}
