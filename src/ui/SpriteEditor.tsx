import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Sprite, TextureAsset } from "../editor/types";
import { gridSliceRects, makeId } from "../editor/tileset";

/** A sprite being edited. `spriteId` is present for sprites that already exist. */
export type DraftSprite = {
  localId: string;
  spriteId?: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type SpriteEditorProps = {
  texture: TextureAsset;
  existingSprites: Sprite[];
  defaultCell: number;
  onApply: (drafts: DraftSprite[]) => void;
  onClose: () => void;
};

const STAGE_MAX = 720;

const pixelated: CSSProperties = { imageRendering: "pixelated" };

export function SpriteEditor({ texture, existingSprites, defaultCell, onApply, onClose }: SpriteEditorProps) {
  const scale = useMemo(() => {
    const raw = STAGE_MAX / texture.width;
    return Math.min(8, Math.max(0.1, raw));
  }, [texture.width]);
  const displayWidth = texture.width * scale;
  const displayHeight = texture.height * scale;

  const [drafts, setDrafts] = useState<DraftSprite[]>(() =>
    existingSprites.map((sprite) => ({
      localId: makeId("draft"),
      spriteId: sprite.id,
      name: sprite.name,
      x: sprite.x,
      y: sprite.y,
      w: sprite.w,
      h: sprite.h,
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cellWidth, setCellWidth] = useState(defaultCell);
  const [cellHeight, setCellHeight] = useState(defaultCell);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [spacingX, setSpacingX] = useState(0);
  const [spacingY, setSpacingY] = useState(0);
  const [pending, setPending] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setDrafts((list) => list.filter((item) => item.localId !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        const target = event.target;
        const typing =
          target instanceof HTMLElement &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!typing) {
          event.preventDefault();
          removeSelected();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, removeSelected]);

  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const x = Math.round((clientX - rect.left) / scale);
      const y = Math.round((clientY - rect.top) / scale);
      return {
        x: Math.max(0, Math.min(texture.width, x)),
        y: Math.max(0, Math.min(texture.height, y)),
      };
    },
    [scale, texture.height, texture.width],
  );

  const handleStagePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(null);
    const point = toImage(event.clientX, event.clientY);
    dragStart.current = point;
    pendingRef.current = { x: point.x, y: point.y, w: 0, h: 0 };
    setPending(pendingRef.current);
  };

  const handleStagePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragStart.current) return;
    const start = dragStart.current;
    const point = toImage(event.clientX, event.clientY);
    const rect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    };
    pendingRef.current = rect;
    setPending(rect);
  };

  const handleStagePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragStart.current = null;
    const rect = pendingRef.current;
    pendingRef.current = null;
    setPending(null);

    if (rect && rect.w >= 1 && rect.h >= 1) {
      const draft: DraftSprite = {
        localId: makeId("draft"),
        name: `${texture.name} ${drafts.length}`,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      };
      setDrafts((list) => [...list, draft]);
    }
  };

  const applyGridSlice = () => {
    const rects = gridSliceRects({
      imageWidth: texture.width,
      imageHeight: texture.height,
      cellWidth,
      cellHeight,
      offsetX,
      offsetY,
      spacingX,
      spacingY,
    });
    setDrafts(
      rects.map((rect, index) => ({
        localId: makeId("draft"),
        name: `${texture.name} ${index}`,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      })),
    );
    setSelectedId(null);
  };

  const numberField = (label: string, value: number, set: (value: number) => void) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => set(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
      />
    </label>
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Sprite editor">
      <div className="sprite-editor">
        <header className="sprite-editor-header">
          <h2>Slice sprites — {texture.name}</h2>
          <button className="tool-button" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <div className="sprite-editor-body">
          <aside className="sprite-editor-controls">
            <section className="panel">
              <h3>Grid slice</h3>
              <div className="field-grid">
                {numberField("Cell W", cellWidth, setCellWidth)}
                {numberField("Cell H", cellHeight, setCellHeight)}
                {numberField("Offset X", offsetX, setOffsetX)}
                {numberField("Offset Y", offsetY, setOffsetY)}
                {numberField("Spacing X", spacingX, setSpacingX)}
                {numberField("Spacing Y", spacingY, setSpacingY)}
              </div>
              <button className="tool-button" onClick={applyGridSlice} type="button">
                Slice into grid
              </button>
            </section>

            <section className="panel">
              <h3>Sprites</h3>
              <p className="assets-empty">
                Drag on the image to cut a custom region. Click a region to select it.
              </p>
              <div className="metric-row">
                <span>Count</span>
                <strong>{drafts.length}</strong>
              </div>
              <div className="sprite-editor-actions">
                <button
                  className="tool-button"
                  onClick={removeSelected}
                  type="button"
                  disabled={!selectedId}
                >
                  Delete selected
                </button>
                <button
                  className="tool-button"
                  onClick={() => {
                    setDrafts([]);
                    setSelectedId(null);
                  }}
                  type="button"
                  disabled={drafts.length === 0}
                >
                  Clear all
                </button>
              </div>
            </section>

            <div className="sprite-editor-footer">
              <button className="tool-button" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="tool-button active" onClick={() => onApply(drafts)} type="button">
                Apply
              </button>
            </div>
          </aside>

          <div className="sprite-editor-stage">
            <div className="sprite-stage-inner" style={{ width: displayWidth, height: displayHeight }}>
              <img
                src={texture.src}
                alt={texture.name}
                draggable={false}
                style={{ width: displayWidth, height: displayHeight, ...pixelated }}
              />
              <svg
                ref={svgRef}
                className="sprite-stage-overlay"
                width={displayWidth}
                height={displayHeight}
                viewBox={`0 0 ${texture.width} ${texture.height}`}
                onPointerDown={handleStagePointerDown}
                onPointerMove={handleStagePointerMove}
                onPointerUp={handleStagePointerUp}
              >
                {drafts.map((draft) => (
                  <rect
                    key={draft.localId}
                    x={draft.x}
                    y={draft.y}
                    width={draft.w}
                    height={draft.h}
                    className={draft.localId === selectedId ? "sprite-rect selected" : "sprite-rect"}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedId(draft.localId);
                    }}
                  />
                ))}
                {pending && pending.w > 0 && pending.h > 0 ? (
                  <rect
                    x={pending.x}
                    y={pending.y}
                    width={pending.w}
                    height={pending.h}
                    className="sprite-rect pending"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
