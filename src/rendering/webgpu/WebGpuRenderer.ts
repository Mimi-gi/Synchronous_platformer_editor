import type { EditorRenderer, RendererSize, RenderFrame } from "../Renderer";
import { hexToRgb } from "../color";

type RectInstance = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: [number, number, number, number];
};

const FLOATS_PER_RECT = 8;

export class WebGpuRenderer implements EditorRenderer {
  readonly kind = "webgpu" as const;

  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private uniformBindGroup: GPUBindGroup | null = null;
  private instanceBuffer: GPUBuffer | null = null;
  private instanceCapacity = 0;
  private format: GPUTextureFormat = "bgra8unorm";

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not available in this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });

    if (!adapter) {
      throw new Error("No compatible WebGPU adapter was found.");
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");

    if (!context) {
      throw new Error("Could not create a WebGPU canvas context.");
    }

    this.device = device;
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
      device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.createPipeline();
  }

  resize(size: RendererSize): void {
    void size;
  }

  render(frame: RenderFrame): void {
    const device = this.device;
    const context = this.context;
    const pipeline = this.pipeline;
    const uniformBuffer = this.uniformBuffer;
    const uniformBindGroup = this.uniformBindGroup;

    if (!device || !context || !pipeline || !uniformBuffer || !uniformBindGroup) return;

    const rects = this.buildRects(frame);
    const instanceData = new Float32Array(rects.length * FLOATS_PER_RECT);

    rects.forEach((rect, index) => {
      const offset = index * FLOATS_PER_RECT;
      instanceData[offset] = rect.x;
      instanceData[offset + 1] = rect.y;
      instanceData[offset + 2] = rect.width;
      instanceData[offset + 3] = rect.height;
      instanceData[offset + 4] = rect.color[0];
      instanceData[offset + 5] = rect.color[1];
      instanceData[offset + 6] = rect.color[2];
      instanceData[offset + 7] = rect.color[3];
    });

    const instanceBuffer = this.ensureInstanceBuffer(instanceData.byteLength);
    if (!instanceBuffer) return;

    if (instanceData.byteLength > 0) {
      device.queue.writeBuffer(instanceBuffer, 0, instanceData);
    }

    const uniformData = new Float32Array([
      frame.viewport.centerX,
      frame.viewport.centerY,
      frame.viewport.zoom,
      0,
      frame.size.width,
      frame.size.height,
      0,
      0,
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.067, g: 0.094, b: 0.125, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, uniformBindGroup);
    pass.setVertexBuffer(0, instanceBuffer);
    pass.draw(6, rects.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.instanceBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.context = null;
    this.device = null;
    this.pipeline = null;
    this.uniformBindGroup = null;
    this.uniformBuffer = null;
    this.instanceBuffer = null;
  }

  private createPipeline(): void {
    const device = this.device;
    if (!device) return;

    const shader = device.createShaderModule({
      label: "editor-rect-shader",
      code: `
        struct Uniforms {
          center: vec2<f32>,
          zoom: f32,
          _pad0: f32,
          canvasSize: vec2<f32>,
          _pad1: vec2<f32>,
        };

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexInput {
          @location(0) rect: vec4<f32>,
          @location(1) color: vec4<f32>,
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) color: vec4<f32>,
        };

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var corners = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(1.0, 1.0),
          );

          let local = corners[input.vertexIndex];
          let world = input.rect.xy + local * input.rect.zw;
          let screen = (world - uniforms.center) * uniforms.zoom + uniforms.canvasSize * 0.5;
          let clip = vec2<f32>(
            screen.x / uniforms.canvasSize.x * 2.0 - 1.0,
            1.0 - screen.y / uniforms.canvasSize.y * 2.0,
          );

          var output: VertexOutput;
          output.position = vec4<f32>(clip, 0.0, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
          return input.color;
        }
      `,
    });

    this.uniformBuffer = device.createBuffer({
      label: "editor-viewport-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.uniformBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      label: "editor-rect-pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: {
        module: shader,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: FLOATS_PER_RECT * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "instance",
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: "float32x4",
              },
              {
                shaderLocation: 1,
                offset: 4 * Float32Array.BYTES_PER_ELEMENT,
                format: "float32x4",
              },
            ],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  private ensureInstanceBuffer(byteLength: number): GPUBuffer | null {
    const device = this.device;
    if (!device) return null;

    const required = Math.max(byteLength, FLOATS_PER_RECT * Float32Array.BYTES_PER_ELEMENT);
    if (this.instanceBuffer && this.instanceCapacity >= required) {
      return this.instanceBuffer;
    }

    this.instanceBuffer?.destroy();
    this.instanceCapacity = Math.max(required, this.instanceCapacity * 2, 4096);
    this.instanceBuffer = device.createBuffer({
      label: "editor-rect-instances",
      size: this.instanceCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    return this.instanceBuffer;
  }

  private buildRects(frame: RenderFrame): RectInstance[] {
    const level = frame.project.levels.find((item) => item.id === frame.activeLevelId);
    if (!level) return [];

    const tileSize = frame.project.tileSize;
    const lineWidth = Math.max(1 / frame.viewport.zoom, 0.75);
    const rects: RectInstance[] = [];
    const mapWidth = level.width * tileSize;
    const mapHeight = level.height * tileSize;

    for (let x = 0; x <= level.width; x += 1) {
      rects.push({
        x: x * tileSize - lineWidth / 2,
        y: 0,
        width: lineWidth,
        height: mapHeight,
        color: [0.55, 0.64, 0.72, 0.16],
      });
    }

    for (let y = 0; y <= level.height; y += 1) {
      rects.push({
        x: 0,
        y: y * tileSize - lineWidth / 2,
        width: mapWidth,
        height: lineWidth,
        color: [0.55, 0.64, 0.72, 0.16],
      });
    }

    for (const layer of level.layers) {
      if (!layer.visible) continue;

      for (const [key, cell] of Object.entries(layer.cells)) {
        const [x, y] = key.split(",").map(Number);
        const rgb = hexToRgb(cell.color);
        rects.push({
          x: x * tileSize,
          y: y * tileSize,
          width: tileSize,
          height: tileSize,
          color: [rgb.r / 255, rgb.g / 255, rgb.b / 255, layer.opacity],
        });
      }
    }

    if (frame.hoverCell) {
      const color: [number, number, number, number] =
        frame.selectedTool === "erase" ? [1, 0.48, 0.56, 1] : [0.97, 0.89, 0.48, 1];
      const x = frame.hoverCell.x * tileSize;
      const y = frame.hoverCell.y * tileSize;
      const w = Math.max(2 / frame.viewport.zoom, 1);

      rects.push({ x, y, width: tileSize, height: w, color });
      rects.push({ x, y: y + tileSize - w, width: tileSize, height: w, color });
      rects.push({ x, y, width: w, height: tileSize, color });
      rects.push({ x: x + tileSize - w, y, width: w, height: tileSize, color });
    }

    return rects;
  }
}
