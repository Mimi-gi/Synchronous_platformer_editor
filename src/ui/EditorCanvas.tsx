import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createInitialProject } from "../editor/createInitialProject";
import type { EditorProject, GridCell, ToolMode, Viewport } from "../editor/types";
import type { EditorRenderer, RendererKind, RendererSize } from "../rendering/Renderer";
import { createRenderer } from "../rendering/createRenderer";

const TOOL_LABELS: Record<ToolMode, string> = {
  select: "Select",
  paint: "Paint",
  erase: "Erase",
  pan: "Pan",
};

const PAINT_COLOR = "#7ddf8a";

export function EditorCanvas() {
  const [project, setProject] = useState<EditorProject>(() => createInitialProject());
  const [selectedTool, setSelectedTool] = useState<ToolMode>("paint");
  const [viewport, setViewport] = useState<Viewport>({ centerX: 480, centerY: 320, zoom: 1 });
  const [hoverCell, setHoverCell] = useState<GridCell | null>(null);
  const [rendererKind, setRendererKind] = useState<RendererKind | "initializing">("initializing");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<EditorRenderer | null>(null);
  const sizeRef = useRef<RendererSize>({ width: 1, height: 1, dpr: 1 });
  const dragRef = useRef<{ x: number; y: number; viewport: Viewport } | null>(null);

  const activeLevel = project.levels[0];
  const activeLayer = activeLevel.layers[0];
  const tileCount = useMemo(
    () => Object.keys(activeLayer.cells).length,
    [activeLayer.cells],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    createRenderer(canvas)
      .then((renderer) => {
        if (cancelled) {
          renderer.destroy();
          return;
        }

        rendererRef.current = renderer;
        setRendererKind(renderer.kind);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      sizeRef.current = { width, height, dpr };
      rendererRef.current?.resize(sizeRef.current);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      rendererRef.current?.render({
        project,
        viewport,
        size: sizeRef.current,
        activeLevelId: activeLevel.id,
        activeLayerId: activeLayer.id,
        hoverCell,
        selectedTool,
      });
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [activeLayer.id, activeLevel.id, hoverCell, project, selectedTool, viewport]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      const dpr = sizeRef.current.dpr;
      const x = ((cssX * dpr - sizeRef.current.width / 2) / viewport.zoom) + viewport.centerX;
      const y = ((cssY * dpr - sizeRef.current.height / 2) / viewport.zoom) + viewport.centerY;

      return { x, y };
    },
    [viewport],
  );

  const worldToCell = useCallback(
    (worldX: number, worldY: number): GridCell | null => {
      const tileSize = project.tileSize;
      const x = Math.floor(worldX / tileSize);
      const y = Math.floor(worldY / tileSize);

      if (x < 0 || y < 0 || x >= activeLevel.width || y >= activeLevel.height) {
        return null;
      }

      return { x, y };
    },
    [activeLevel.height, activeLevel.width, project.tileSize],
  );

  const applyToolAt = useCallback(
    (cell: GridCell | null) => {
      if (!cell || selectedTool === "select" || selectedTool === "pan") return;

      setProject((current) => {
        const level = current.levels[0];
        const layer = level.layers[0];
        const key = `${cell.x},${cell.y}`;
        const nextCells = { ...layer.cells };

        if (selectedTool === "paint") {
          nextCells[key] = { tileId: 1, color: PAINT_COLOR };
        } else {
          delete nextCells[key];
        }

        return {
          ...current,
          levels: [
            {
              ...level,
              layers: [
                {
                  ...layer,
                  cells: nextCells,
                },
                ...level.layers.slice(1),
              ],
            },
          ],
        };
      });
    },
    [selectedTool],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = screenToWorld(event.clientX, event.clientY);
    const cell = worldToCell(world.x, world.y);
    setHoverCell(cell);

    if (selectedTool === "pan" || event.button === 1 || event.altKey) {
      dragRef.current = { x: event.clientX, y: event.clientY, viewport };
      return;
    }

    applyToolAt(cell);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      const start = dragRef.current;
      setViewport({
        ...start.viewport,
        centerX: start.viewport.centerX - (event.clientX - start.x) * sizeRef.current.dpr / start.viewport.zoom,
        centerY: start.viewport.centerY - (event.clientY - start.y) * sizeRef.current.dpr / start.viewport.zoom,
      });
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    const cell = worldToCell(world.x, world.y);
    setHoverCell(cell);

    if (event.buttons === 1) {
      applyToolAt(cell);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const nextZoom = Math.min(4, Math.max(0.25, viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    setViewport((current) => ({ ...current, zoom: nextZoom }));
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Project navigation">
        <div>
          <p className="eyebrow">Project</p>
          <h1>{project.name}</h1>
        </div>

        <section className="panel">
          <h2>Level</h2>
          <div className="metric-row">
            <span>{activeLevel.name}</span>
            <strong>
              {activeLevel.width} x {activeLevel.height}
            </strong>
          </div>
          <div className="metric-row">
            <span>Tile size</span>
            <strong>{project.tileSize}px</strong>
          </div>
        </section>

        <section className="panel">
          <h2>Layers</h2>
          {activeLevel.layers.map((layer) => (
            <button
              className={layer.id === activeLayer.id ? "layer-button active" : "layer-button"}
              key={layer.id}
              type="button"
            >
              <span>{layer.name}</span>
              <small>{Object.keys(layer.cells).length}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace" aria-label="Editor workspace">
        <div className="toolbar" role="toolbar" aria-label="Editor tools">
          {(Object.keys(TOOL_LABELS) as ToolMode[]).map((tool) => (
            <button
              className={selectedTool === tool ? "tool-button active" : "tool-button"}
              key={tool}
              onClick={() => setSelectedTool(tool)}
              type="button"
              title={TOOL_LABELS[tool]}
            >
              {TOOL_LABELS[tool]}
            </button>
          ))}
        </div>

        <div className="canvas-frame">
          <canvas
            ref={canvasRef}
            aria-label="Level canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverCell(null)}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          />
        </div>

        <div className="statusbar">
          <span>Renderer: {rendererKind}</span>
          <span>Zoom: {Math.round(viewport.zoom * 100)}%</span>
          <span>Tiles: {tileCount}</span>
          <span>
            Cell: {hoverCell ? `${hoverCell.x}, ${hoverCell.y}` : "-"}
          </span>
        </div>
      </section>
    </main>
  );
}
