import type { EditorRenderer } from "./Renderer";
import { Canvas2DRenderer } from "./canvas2d/Canvas2DRenderer";
import { WebGpuRenderer } from "./webgpu/WebGpuRenderer";

export async function createRenderer(canvas: HTMLCanvasElement): Promise<EditorRenderer> {
  const preferred = new WebGpuRenderer();

  try {
    await preferred.init(canvas);
    return preferred;
  } catch (error) {
    console.warn("WebGPU renderer unavailable; falling back to Canvas2D.", error);
    const fallback = new Canvas2DRenderer();
    await fallback.init(canvas);
    return fallback;
  }
}
