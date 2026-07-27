import type { EditorRenderer, RendererSize, RenderFrame } from "../Renderer";
import { hexToRgb } from "../color";

export class Canvas2DRenderer implements EditorRenderer {
  readonly kind = "canvas2d" as const;

  private context: CanvasRenderingContext2D | null = null;
  private size: RendererSize = { width: 1, height: 1, dpr: 1 };

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas2D is not available in this browser.");
    }

    this.context = context;
  }

  resize(size: RendererSize): void {
    this.size = size;
  }

  render(frame: RenderFrame): void {
    const context = this.context;
    if (!context) return;

    const { width, height } = this.size;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#111820";
    context.fillRect(0, 0, width, height);

    this.drawGrid(context, frame);
    this.drawTiles(context, frame);
    this.drawHover(context, frame);
  }

  destroy(): void {
    this.context = null;
  }

  private drawGrid(context: CanvasRenderingContext2D, frame: RenderFrame): void {
    const level = frame.project.levels.find((item) => item.id === frame.activeLevelId);
    if (!level) return;

    const tileSize = frame.project.tileSize;
    const screenTile = tileSize * frame.viewport.zoom;
    context.strokeStyle = "rgba(140, 161, 181, 0.2)";
    context.lineWidth = Math.max(1, frame.size.dpr);

    for (let x = 0; x <= level.width; x += 1) {
      const sx = this.worldToScreenX(x * tileSize, frame);
      context.beginPath();
      context.moveTo(sx, this.worldToScreenY(0, frame));
      context.lineTo(sx, this.worldToScreenY(level.height * tileSize, frame));
      context.stroke();
    }

    for (let y = 0; y <= level.height; y += 1) {
      const sy = this.worldToScreenY(y * tileSize, frame);
      context.beginPath();
      context.moveTo(this.worldToScreenX(0, frame), sy);
      context.lineTo(this.worldToScreenX(level.width * tileSize, frame), sy);
      context.stroke();
    }

    if (screenTile >= 18) {
      context.strokeStyle = "rgba(255, 255, 255, 0.08)";
      context.strokeRect(
        this.worldToScreenX(0, frame),
        this.worldToScreenY(0, frame),
        level.width * screenTile,
        level.height * screenTile,
      );
    }
  }

  private drawTiles(context: CanvasRenderingContext2D, frame: RenderFrame): void {
    const level = frame.project.levels.find((item) => item.id === frame.activeLevelId);
    if (!level) return;

    const tileSize = frame.project.tileSize;
    const screenTile = tileSize * frame.viewport.zoom;

    for (const layer of level.layers) {
      if (!layer.visible) continue;

      for (const [key, cell] of Object.entries(layer.cells)) {
        const [x, y] = key.split(",").map(Number);
        const rgb = hexToRgb(cell.color);
        context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${layer.opacity})`;
        context.fillRect(
          this.worldToScreenX(x * tileSize, frame),
          this.worldToScreenY(y * tileSize, frame),
          screenTile,
          screenTile,
        );
      }
    }
  }

  private drawHover(context: CanvasRenderingContext2D, frame: RenderFrame): void {
    if (!frame.hoverCell) return;

    const tileSize = frame.project.tileSize;
    context.strokeStyle = frame.selectedTool === "erase" ? "#ff7a90" : "#f8e37a";
    context.lineWidth = Math.max(2, 2 * frame.size.dpr);
    context.strokeRect(
      this.worldToScreenX(frame.hoverCell.x * tileSize, frame),
      this.worldToScreenY(frame.hoverCell.y * tileSize, frame),
      tileSize * frame.viewport.zoom,
      tileSize * frame.viewport.zoom,
    );
  }

  private worldToScreenX(worldX: number, frame: RenderFrame): number {
    return (worldX - frame.viewport.centerX) * frame.viewport.zoom + frame.size.width / 2;
  }

  private worldToScreenY(worldY: number, frame: RenderFrame): number {
    return (worldY - frame.viewport.centerY) * frame.viewport.zoom + frame.size.height / 2;
  }
}
