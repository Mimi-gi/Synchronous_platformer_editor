import type { Sprite, TextureAsset, TileDefinition } from "../../editor/types";
import type { EditorRenderer, RendererSize, RenderFrame } from "../Renderer";
import { layerFocusStyle, tileAppearance } from "../color";

export class Canvas2DRenderer implements EditorRenderer {
  readonly kind = "canvas2d" as const;

  private context: CanvasRenderingContext2D | null = null;
  private size: RendererSize = { width: 1, height: 1, dpr: 1 };
  // Decoded texture images keyed by texture id (with the src they were loaded
  // from, so a replaced texture reloads).
  private images = new Map<string, { src: string; image: HTMLImageElement }>();

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas2D is not available in this browser.");
    }

    this.context = context;
  }

  private getImage(texture: TextureAsset): HTMLImageElement | null {
    const cached = this.images.get(texture.id);
    if (cached && cached.src === texture.src) {
      return cached.image.complete && cached.image.naturalWidth > 0 ? cached.image : null;
    }

    const image = new Image();
    image.src = texture.src;
    this.images.set(texture.id, { src: texture.src, image });
    return image.complete && image.naturalWidth > 0 ? image : null;
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
    const tilesById = new Map<number, TileDefinition>(frame.project.tiles.map((tile) => [tile.id, tile]));
    const spritesById = new Map<string, Sprite>(frame.project.sprites.map((sprite) => [sprite.id, sprite]));
    const texturesById = new Map<string, TextureAsset>(
      frame.project.textures.map((texture) => [texture.id, texture]),
    );

    context.imageSmoothingEnabled = false;

    for (const layer of level.layers) {
      if (!layer.visible) continue;

      const isActiveLayer = layer.id === frame.activeLayerId;
      const style = layerFocusStyle({
        layerColor: layer.color,
        isActiveLayer,
        layerFocus: frame.layerFocus,
      });

      for (const [key, cell] of Object.entries(layer.cells)) {
        const [x, y] = key.split(",").map(Number);
        const dx = this.worldToScreenX(x * tileSize, frame);
        const dy = this.worldToScreenY(y * tileSize, frame);

        const tile = tilesById.get(cell.tileId);
        const sprite = tile?.spriteId ? spritesById.get(tile.spriteId) : undefined;
        const texture = sprite ? texturesById.get(sprite.textureId) : undefined;
        const image = texture ? this.getImage(texture) : null;

        if (sprite && image) {
          context.globalAlpha = layer.opacity * style.alpha;
          context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, dx, dy, screenTile, screenTile);
          // Identity-color wash for "Layer focus" (desaturation is skipped for
          // sprites in the Canvas2D fallback).
          if (style.tintAmount > 0) {
            context.globalAlpha = layer.opacity * style.alpha * style.tintAmount;
            context.fillStyle = `rgb(${style.tint.r}, ${style.tint.g}, ${style.tint.b})`;
            context.fillRect(dx, dy, screenTile, screenTile);
          }
          context.globalAlpha = 1;
          continue;
        }

        // Flat-color tile (no sprite, or its image is still decoding).
        const paint = tileAppearance({
          cellColor: cell.color,
          layerColor: layer.color,
          layerOpacity: layer.opacity,
          isActiveLayer,
          layerFocus: frame.layerFocus,
        });
        context.fillStyle = `rgba(${Math.round(paint.r)}, ${Math.round(paint.g)}, ${Math.round(paint.b)}, ${paint.a})`;
        context.fillRect(dx, dy, screenTile, screenTile);
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
