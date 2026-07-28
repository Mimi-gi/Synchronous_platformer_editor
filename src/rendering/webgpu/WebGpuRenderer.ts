import type { Sprite, TextureAsset, TileDefinition } from "../../editor/types";
import type { EditorRenderer, RendererSize, RenderFrame } from "../Renderer";
import { layerFocusStyle, tileAppearance } from "../color";

const FLOATS_PER_COLOR = 8; // rect(4) + color(4)
const FLOATS_PER_TEX = 16; // rect(4) + uvRect(4) + tint(4) + params(4)

type TextureEntry = {
  src: string;
  status: "loading" | "ready" | "error";
  texture?: GPUTexture;
  bindGroup?: GPUBindGroup;
};

type TextureGroup = { bindGroup: GPUBindGroup; floats: number[] };

export class WebGpuRenderer implements EditorRenderer {
  readonly kind = "webgpu" as const;

  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private colorPipeline: GPURenderPipeline | null = null;
  private texturePipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private uniformBindGroup: GPUBindGroup | null = null;
  private textureLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private colorBuffer: GPUBuffer | null = null;
  private colorCapacity = 0;
  private textureBuffer: GPUBuffer | null = null;
  private textureCapacity = 0;
  private textures = new Map<string, TextureEntry>();
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

    this.createPipelines();
  }

  resize(size: RendererSize): void {
    void size;
  }

  render(frame: RenderFrame): void {
    const device = this.device;
    const context = this.context;
    const colorPipeline = this.colorPipeline;
    const texturePipeline = this.texturePipeline;
    const uniformBuffer = this.uniformBuffer;
    const uniformBindGroup = this.uniformBindGroup;

    if (!device || !context || !colorPipeline || !texturePipeline || !uniformBuffer || !uniformBindGroup) {
      return;
    }

    for (const texture of frame.project.textures) {
      this.ensureTexture(texture);
    }

    const { colorFloats, hoverFloats, groups } = this.buildInstances(frame);

    // Color buffer holds grid + flat-color tiles first, then hover quads so the
    // hover outline can be drawn on top of textured tiles in a later pass.
    const colorCount = colorFloats.length / FLOATS_PER_COLOR;
    const hoverCount = hoverFloats.length / FLOATS_PER_COLOR;
    const colorData = new Float32Array([...colorFloats, ...hoverFloats]);
    const colorBuffer = this.ensureColorBuffer(colorData.byteLength);
    if (colorBuffer && colorData.byteLength > 0) {
      device.queue.writeBuffer(colorBuffer, 0, colorData);
    }

    // Textured tiles, concatenated across textures with per-group base offsets.
    const textureFloats: number[] = [];
    const drawGroups: { bindGroup: GPUBindGroup; base: number; count: number }[] = [];
    for (const group of groups) {
      const base = textureFloats.length / FLOATS_PER_TEX;
      const count = group.floats.length / FLOATS_PER_TEX;
      if (count === 0) continue;
      textureFloats.push(...group.floats);
      drawGroups.push({ bindGroup: group.bindGroup, base, count });
    }
    const textureData = new Float32Array(textureFloats);
    const textureBuffer = this.ensureTextureBuffer(textureData.byteLength);
    if (textureBuffer && textureData.byteLength > 0) {
      device.queue.writeBuffer(textureBuffer, 0, textureData);
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

    pass.setBindGroup(0, uniformBindGroup);

    // 1. Grid + flat-color tiles.
    if (colorBuffer && colorCount > 0) {
      pass.setPipeline(colorPipeline);
      pass.setVertexBuffer(0, colorBuffer);
      pass.draw(6, colorCount, 0, 0);
    }

    // 2. Textured tiles, one draw per texture.
    if (textureBuffer && drawGroups.length > 0) {
      pass.setPipeline(texturePipeline);
      pass.setVertexBuffer(0, textureBuffer);
      for (const group of drawGroups) {
        pass.setBindGroup(1, group.bindGroup);
        pass.draw(6, group.count, 0, group.base);
      }
    }

    // 3. Hover outline, on top of everything.
    if (colorBuffer && hoverCount > 0) {
      pass.setPipeline(colorPipeline);
      pass.setVertexBuffer(0, colorBuffer);
      pass.draw(6, hoverCount, 0, colorCount);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    for (const entry of this.textures.values()) {
      entry.texture?.destroy();
    }
    this.textures.clear();
    this.colorBuffer?.destroy();
    this.textureBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.context = null;
    this.device = null;
    this.colorPipeline = null;
    this.texturePipeline = null;
    this.uniformBindGroup = null;
    this.uniformBuffer = null;
    this.colorBuffer = null;
    this.textureBuffer = null;
    this.textureLayout = null;
    this.sampler = null;
  }

  private ensureTexture(asset: TextureAsset): void {
    const existing = this.textures.get(asset.id);
    if (existing && existing.src === asset.src) return;

    const entry: TextureEntry = { src: asset.src, status: "loading" };
    this.textures.set(asset.id, entry);

    const image = new Image();
    image.onload = () => {
      const device = this.device;
      if (!device || this.textures.get(asset.id) !== entry) return;

      createImageBitmap(image)
        .then((bitmap) => {
          if (this.textures.get(asset.id) !== entry) {
            bitmap.close();
            return;
          }
          const texture = device.createTexture({
            size: [bitmap.width, bitmap.height, 1],
            format: "rgba8unorm",
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          });
          device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture },
            [bitmap.width, bitmap.height],
          );
          entry.texture = texture;
          entry.bindGroup = device.createBindGroup({
            layout: this.textureLayout!,
            entries: [
              { binding: 0, resource: this.sampler! },
              { binding: 1, resource: texture.createView() },
            ],
          });
          entry.status = "ready";
          bitmap.close();
        })
        .catch((error) => {
          console.error(error);
          entry.status = "error";
        });
    };
    image.onerror = () => {
      entry.status = "error";
    };
    image.src = asset.src;
  }

  private buildInstances(frame: RenderFrame): {
    colorFloats: number[];
    hoverFloats: number[];
    groups: TextureGroup[];
  } {
    const colorFloats: number[] = [];
    const hoverFloats: number[] = [];
    const groups = new Map<string, TextureGroup>();

    const level = frame.project.levels.find((item) => item.id === frame.activeLevelId);
    if (!level) return { colorFloats, hoverFloats, groups: [] };

    const tileSize = frame.project.tileSize;
    const lineWidth = Math.max(1 / frame.viewport.zoom, 0.75);
    const mapWidth = level.width * tileSize;
    const mapHeight = level.height * tileSize;

    const pushColor = (x: number, y: number, w: number, h: number, color: [number, number, number, number]) => {
      colorFloats.push(x, y, w, h, color[0], color[1], color[2], color[3]);
    };

    // Grid lines.
    for (let x = 0; x <= level.width; x += 1) {
      pushColor(x * tileSize - lineWidth / 2, 0, lineWidth, mapHeight, [0.55, 0.64, 0.72, 0.16]);
    }
    for (let y = 0; y <= level.height; y += 1) {
      pushColor(0, y * tileSize - lineWidth / 2, mapWidth, lineWidth, [0.55, 0.64, 0.72, 0.16]);
    }

    const tilesById = new Map<number, TileDefinition>(frame.project.tiles.map((tile) => [tile.id, tile]));
    const spritesById = new Map<string, Sprite>(frame.project.sprites.map((sprite) => [sprite.id, sprite]));
    const texturesById = new Map<string, TextureAsset>(
      frame.project.textures.map((texture) => [texture.id, texture]),
    );

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
        const tile = tilesById.get(cell.tileId);
        const sprite = tile?.spriteId ? spritesById.get(tile.spriteId) : undefined;
        const texture = sprite ? texturesById.get(sprite.textureId) : undefined;
        const entry = texture ? this.textures.get(texture.id) : undefined;

        if (sprite && texture && entry?.status === "ready" && entry.bindGroup) {
          let group = groups.get(texture.id);
          if (!group) {
            group = { bindGroup: entry.bindGroup, floats: [] };
            groups.set(texture.id, group);
          }
          group.floats.push(
            x * tileSize,
            y * tileSize,
            tileSize,
            tileSize,
            sprite.x / texture.width,
            sprite.y / texture.height,
            sprite.w / texture.width,
            sprite.h / texture.height,
            style.tint.r / 255,
            style.tint.g / 255,
            style.tint.b / 255,
            style.tintAmount,
            style.desaturate,
            layer.opacity * style.alpha,
            0,
            0,
          );
          continue;
        }

        // Flat-color fallback (no sprite, or its texture is not ready yet).
        const paint = tileAppearance({
          cellColor: cell.color,
          layerColor: layer.color,
          layerOpacity: layer.opacity,
          isActiveLayer,
          layerFocus: frame.layerFocus,
        });
        pushColor(x * tileSize, y * tileSize, tileSize, tileSize, [
          paint.r / 255,
          paint.g / 255,
          paint.b / 255,
          paint.a,
        ]);
      }
    }

    // Hover outline (four thin quads).
    if (frame.hoverCell) {
      const color: [number, number, number, number] =
        frame.selectedTool === "erase" ? [1, 0.48, 0.56, 1] : [0.97, 0.89, 0.48, 1];
      const x = frame.hoverCell.x * tileSize;
      const y = frame.hoverCell.y * tileSize;
      const w = Math.max(2 / frame.viewport.zoom, 1);
      hoverFloats.push(x, y, tileSize, w, ...color);
      hoverFloats.push(x, y + tileSize - w, tileSize, w, ...color);
      hoverFloats.push(x, y, w, tileSize, ...color);
      hoverFloats.push(x + tileSize - w, y, w, tileSize, ...color);
    }

    return { colorFloats, hoverFloats, groups: [...groups.values()] };
  }

  private createPipelines(): void {
    const device = this.device;
    if (!device) return;

    this.uniformBuffer = device.createBuffer({
      label: "editor-viewport-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });

    this.uniformBindGroup = device.createBindGroup({
      layout: uniformLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.textureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    this.sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });

    const blend: GPUBlendState = {
      color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };

    const uniformsStruct = `
      struct Uniforms {
        center: vec2<f32>,
        zoom: f32,
        _pad0: f32,
        canvasSize: vec2<f32>,
        _pad1: vec2<f32>,
      };
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      fn toClip(world: vec2<f32>) -> vec4<f32> {
        let screen = (world - uniforms.center) * uniforms.zoom + uniforms.canvasSize * 0.5;
        let clip = vec2<f32>(
          screen.x / uniforms.canvasSize.x * 2.0 - 1.0,
          1.0 - screen.y / uniforms.canvasSize.y * 2.0,
        );
        return vec4<f32>(clip, 0.0, 1.0);
      }

      fn cornerAt(index: u32) -> vec2<f32> {
        var corners = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 0.0),
          vec2<f32>(0.0, 1.0),
          vec2<f32>(0.0, 1.0),
          vec2<f32>(1.0, 0.0),
          vec2<f32>(1.0, 1.0),
        );
        return corners[index];
      }
    `;

    const colorShader = device.createShaderModule({
      label: "editor-color-shader",
      code: `
        ${uniformsStruct}

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
          let local = cornerAt(input.vertexIndex);
          let world = input.rect.xy + local * input.rect.zw;
          var output: VertexOutput;
          output.position = toClip(world);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
          return input.color;
        }
      `,
    });

    this.colorPipeline = device.createRenderPipeline({
      label: "editor-color-pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
      vertex: {
        module: colorShader,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: FLOATS_PER_COLOR * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: { module: colorShader, entryPoint: "fragmentMain", targets: [{ format: this.format, blend }] },
      primitive: { topology: "triangle-list" },
    });

    const textureShader = device.createShaderModule({
      label: "editor-texture-shader",
      code: `
        ${uniformsStruct}

        @group(1) @binding(0) var texSampler: sampler;
        @group(1) @binding(1) var tex: texture_2d<f32>;

        struct VertexInput {
          @location(0) rect: vec4<f32>,
          @location(1) uvRect: vec4<f32>,
          @location(2) tint: vec4<f32>,
          @location(3) params: vec4<f32>,
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) uv: vec2<f32>,
          @location(1) tint: vec4<f32>,
          @location(2) params: vec4<f32>,
        };

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          let local = cornerAt(input.vertexIndex);
          let world = input.rect.xy + local * input.rect.zw;
          var output: VertexOutput;
          output.position = toClip(world);
          output.uv = input.uvRect.xy + local * input.uvRect.zw;
          output.tint = input.tint;
          output.params = input.params;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
          let sampled = textureSample(tex, texSampler, input.uv);
          let luma = dot(sampled.rgb, vec3<f32>(0.299, 0.587, 0.114));
          let desaturated = mix(sampled.rgb, vec3<f32>(luma), input.params.x);
          let tinted = mix(desaturated, input.tint.rgb, input.tint.w);
          return vec4<f32>(tinted, sampled.a * input.params.y);
        }
      `,
    });

    this.texturePipeline = device.createRenderPipeline({
      label: "editor-texture-pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout, this.textureLayout] }),
      vertex: {
        module: textureShader,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: FLOATS_PER_TEX * Float32Array.BYTES_PER_ELEMENT,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: "float32x4" },
              { shaderLocation: 2, offset: 8 * Float32Array.BYTES_PER_ELEMENT, format: "float32x4" },
              { shaderLocation: 3, offset: 12 * Float32Array.BYTES_PER_ELEMENT, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: { module: textureShader, entryPoint: "fragmentMain", targets: [{ format: this.format, blend }] },
      primitive: { topology: "triangle-list" },
    });
  }

  private ensureColorBuffer(byteLength: number): GPUBuffer | null {
    const device = this.device;
    if (!device) return null;

    const required = Math.max(byteLength, FLOATS_PER_COLOR * Float32Array.BYTES_PER_ELEMENT);
    if (this.colorBuffer && this.colorCapacity >= required) return this.colorBuffer;

    this.colorBuffer?.destroy();
    this.colorCapacity = Math.max(required, this.colorCapacity * 2, 4096);
    this.colorBuffer = device.createBuffer({
      label: "editor-color-instances",
      size: this.colorCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    return this.colorBuffer;
  }

  private ensureTextureBuffer(byteLength: number): GPUBuffer | null {
    const device = this.device;
    if (!device) return null;

    const required = Math.max(byteLength, FLOATS_PER_TEX * Float32Array.BYTES_PER_ELEMENT);
    if (this.textureBuffer && this.textureCapacity >= required) return this.textureBuffer;

    this.textureBuffer?.destroy();
    this.textureCapacity = Math.max(required, this.textureCapacity * 2, 4096);
    this.textureBuffer = device.createBuffer({
      label: "editor-texture-instances",
      size: this.textureCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    return this.textureBuffer;
  }
}
