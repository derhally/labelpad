import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import Moveable from "react-moveable";
import { ZoomIn, ZoomOut } from "lucide-react";
import { bounds } from "../editor/arrange";
import { renderLabel, type RenderIssues } from "../editor/render";
import { keepsAspect, type LabelElement } from "../editor/types";
import type { Zoom } from "../settings/useSettings";

type Props = {
  elements: LabelElement[];
  width: number;
  height: number;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onChange: (id: string, patch: Partial<LabelElement>, opts?: { transient?: boolean }) => void;
  onChangeMany: (patches: Record<string, Partial<LabelElement>>, opts?: { transient?: boolean }) => void;
  onGestureStart: () => void;
  onEditText: (id: string) => void;
  /** Right-click on items: the items it applies to, and where the pointer is. */
  onContextMenu: (ids: string[], x: number, y: number) => void;
  onRendered: (canvas: HTMLCanvasElement, issues: RenderIssues) => void;
  /** Inset of the safe-margin guide in dots; printers can't print reliably closer to the edge. */
  margin: number;
  /** Changes each minute while the label shows the time, to redraw it. */
  clock: number;
  /** The number {count} shows in the preview. */
  count: number;
  /** Printer resolution, to show the label at the size it prints. */
  dotsPerMm: number;
  zoomLevel: Zoom;
  onZoom: (zoom: Zoom) => void;
};

/** Screen pixels per label dot. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
/** The white frame around the label. */
const FRAME_PADDING = 24;
/** Each zoom-in / zoom-out step. */
const ZOOM_STEP = 1.25;

/**
 * The label canvas plus an invisible box per element that Moveable uses for
 * dragging, resizing and rotating. The canvas always shows the 1-bit render.
 */
/** A drag-to-select rectangle, in label dots. */
type Marquee = { x0: number; y0: number; x1: number; y1: number; additive: boolean };

export function EditorStage({
  elements,
  width,
  height,
  margin,
  selectedIds,
  onSelect,
  onChange,
  onChangeMany,
  onGestureStart,
  onEditText,
  onContextMenu,
  onRendered,
  clock,
  count,
  dotsPerMm,
  zoomLevel,
  onZoom,
}: Props) {
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const boxRefs = useRef(new Map<string, HTMLDivElement>());
  const gesturing = useRef(false);
  const [fitZoom, setFitZoom] = useState(4);
  const [, forceRender] = useState(0);
  const freeMove = useAltKey();

  // CSS pixels are 1/96 inch, so this shows the label at about the size it prints.
  const actualZoom = 96 / (dotsPerMm * 25.4);
  const fitted = zoomLevel === "fit";
  const zoom = fitted ? fitZoom : clamp((actualZoom * zoomLevel) / 100, MIN_ZOOM, MAX_ZOOM);
  const percent = (zoom / actualZoom) * 100;
  const [minPercent, maxPercent] = [(MIN_ZOOM / actualZoom) * 100, (MAX_ZOOM / actualZoom) * 100];
  const zoomTo = (p: number) => onZoom(Math.round(clamp(p, minPercent, maxPercent)));

  // Fit the label to the available space.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !fitted) return;
    const fit = () => {
      const cs = getComputedStyle(stage);
      const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - FRAME_PADDING;
      const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - FRAME_PADDING;
      // Round down so the label never quite overflows. Large 300 dpi labels can need less than 1×.
      setFitZoom(Math.max(MIN_ZOOM, Math.floor(Math.min(w / width, h / height, MAX_ZOOM) * 4) / 4));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [width, height, fitted]);

  // Ctrl + mouse wheel (or a trackpad pinch) zooms.
  const percentRef = useRef(percent);
  percentRef.current = percent;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(percentRef.current * Math.pow(1.002, -e.deltaY));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  });

  // Re-render the label whenever anything changes, dropping stale async renders.
  const renderToken = useRef(0);
  useEffect(() => {
    const token = ++renderToken.current;
    const offscreen = document.createElement("canvas");
    renderLabel(offscreen, width, height, elements, new Date(), { count }).then((issues) => {
      if (token !== renderToken.current || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(offscreen, 0, 0);
      onRendered(canvas, issues);
    });
  }, [elements, width, height, onRendered, clock, count]);

  useLayoutEffect(() => {
    if (!gesturing.current) moveableRef.current?.updateRect();
  });

  // Box elements mount after the first render; make sure Moveable sees the targets.
  const selectionKey = selectedIds.join(",");
  useEffect(() => forceRender((n) => n + 1), [selectionKey]);

  const group = elements.filter((e) => selectedIds.includes(e.id));
  const selected = group.length === 1 ? group[0] : null;
  const target = selected ? (boxRefs.current.get(selected.id) ?? null) : null;
  const groupTargets = group.length > 1 ? group.map((e) => boxRefs.current.get(e.id)).filter((n): n is HTMLDivElement => !!n) : [];
  const guides = [...boxRefs.current.entries()].filter(([id]) => !selectedIds.includes(id)).map(([, el]) => el);
  const byId = (node: HTMLElement | SVGElement) => elements.find((e) => e.id === (node as HTMLElement).dataset.id);

  // Drag on an empty part of the label to select everything the box touches.
  const toDots = (e: { clientX: number; clientY: number }) => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const startMarquee = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const p = toDots(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? selectedIds : [];
    let box: Marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive };
    setMarquee(box);
    const move = (ev: PointerEvent) => {
      const q = toDots(ev);
      box = { ...box, x1: q.x, y1: q.y };
      setMarquee(box);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      const [l, r] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
      const [t, b] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
      // A click without a drag just clears the selection.
      if ((r - l) * zoom < 3 && (b - t) * zoom < 3) return onSelect(base);
      const hit = elements.filter((el) => {
        const eb = bounds(el);
        return eb.left < r && eb.right > l && eb.top < b && eb.bottom > t;
      });
      onSelect([...new Set([...base, ...hit.map((el) => el.id)])]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const boxStyle = (el: LabelElement): CSSProperties => ({
    width: el.width * zoom,
    height: el.height * zoom,
    transform: `translate(${el.x * zoom}px, ${el.y * zoom}px) rotate(${el.rotation}deg)`,
  });

  const startGesture = () => {
    gesturing.current = true;
    onGestureStart();
  };

  const endGesture = () => {
    gesturing.current = false;
    if (group.length > 1) {
      onChangeMany(Object.fromEntries(group.map((el) => [el.id, { x: Math.round(el.x), y: Math.round(el.y) }])), { transient: true });
      return;
    }
    if (!selected) return;
    const round = (n: number) => Math.round(n);
    onChange(
      selected.id,
      { x: round(selected.x), y: round(selected.y), width: Math.max(1, round(selected.width)), height: Math.max(1, round(selected.height)), rotation: Math.round(selected.rotation * 10) / 10 },
      { transient: true },
    );
  };

  // Snap to the safe-margin guides (not the label's outer edge, which nothing
  // should sit on), the label's middle, and the edges and centres of other
  // items, with equal gaps between items too. Guidelines are measured from the
  // label's corner, hence the snap container. Hold Alt to move or resize freely.
  const guideLines = (size: number) => [margin, size / 2, size - margin].map((d) => d * zoom);
  const snapProps = {
    snappable: !freeMove,
    snapContainer: surfaceRef.current,
    snapThreshold: 6,
    snapGap: true,
    isDisplaySnapDigit: false,
    isDisplayInnerSnapDigit: false,
    snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
    elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
    verticalGuidelines: guideLines(width),
    horizontalGuidelines: guideLines(height),
    elementGuidelines: guides,
  };

  return (
    <div className="stage-area">
      <div
        className={`stage${fitted ? " fitted" : ""}`}
        ref={stageRef}
        onPointerDown={(e) => (e.target as HTMLElement).matches(".stage, .stage-content") && !e.shiftKey && onSelect([])}
        // Moveable's handles sit outside the label, so keep them lined up while scrolling.
        onScroll={() => moveableRef.current?.updateRect()}
        onContextMenu={(e) => {
          // An item, or the selection's handles (which sit on top of grouped items).
          const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
          const onHandles = !id && selectedIds.length > 0 && !!(e.target as HTMLElement).closest(".moveable-control-box, .moveable-area");
          if (!id && !onHandles) return;
          e.preventDefault();
          const ids = id && !selectedIds.includes(id) ? [id] : selectedIds;
          if (id && !selectedIds.includes(id)) onSelect([id]);
          onContextMenu(ids, e.clientX, e.clientY);
        }}
      >
        <div className="stage-content">
          <div className="label-frame">
            <div className="label-surface" ref={surfaceRef} style={{ width: width * zoom, height: height * zoom }}>
              <canvas ref={canvasRef} className="label-canvas" width={width} height={height} />
              <div className="overlay" onPointerDown={startMarquee}>
                {elements.map((el) => (
                  <div
                    key={el.id}
                    ref={(node) => {
                      if (node) boxRefs.current.set(el.id, node);
                      else boxRefs.current.delete(el.id);
                    }}
                    data-id={el.id}
                    className={`box${selectedIds.includes(el.id) ? (group.length > 1 ? " selected in-selection" : " selected") : ""}`}
                    style={boxStyle(el)}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      const native = e.nativeEvent;
                      const isSelected = selectedIds.includes(el.id);
                      // Shift (or Ctrl/Cmd) adds or removes an item without moving anything.
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        onSelect(isSelected ? selectedIds.filter((id) => id !== el.id) : [...selectedIds, el.id]);
                        return;
                      }
                      if (isSelected && group.length === 1) return;
                      if (!isSelected) flushSync(() => onSelect([el.id]));
                      moveableRef.current?.dragStart(native, e.currentTarget);
                    }}
                    onDoubleClick={() => el.type === "text" && onEditText(el.id)}
                  />
                ))}
              </div>
              <div
                className="safe-margin"
                aria-hidden
                style={{ left: margin * zoom, top: margin * zoom, width: (width - 2 * margin) * zoom, height: (height - 2 * margin) * zoom }}
              />
              {marquee && (
                <div
                  className="marquee"
                  style={{
                    left: Math.min(marquee.x0, marquee.x1) * zoom,
                    top: Math.min(marquee.y0, marquee.y1) * zoom,
                    width: Math.abs(marquee.x1 - marquee.x0) * zoom,
                    height: Math.abs(marquee.y1 - marquee.y0) * zoom,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {selected && target && (
          <Moveable
            ref={moveableRef}
            target={target}
            draggable
            resizable
            rotatable
            keepRatio={keepsAspect(selected)}
            origin={false}
            rotationPosition="top"
            {...snapProps}
            snapRotationThreshold={4}
            snapRotationDegrees={[0, 90, 180, 270]}
            onDragStart={(e) => {
              startGesture();
              e.set([selected.x * zoom, selected.y * zoom]);
            }}
            onDrag={(e) => {
              const [tx, ty] = e.beforeTranslate;
              e.target.style.transform = `translate(${tx}px, ${ty}px) rotate(${selected.rotation}deg)`;
              onChange(selected.id, { x: tx / zoom, y: ty / zoom }, { transient: true });
            }}
            onDragEnd={endGesture}
            onResizeStart={(e) => {
              startGesture();
              e.setOrigin(["%", "%"]);
              if (e.dragStart) e.dragStart.set([selected.x * zoom, selected.y * zoom]);
            }}
            onResize={(e) => {
              const [tx, ty] = e.drag.beforeTranslate;
              e.target.style.width = `${e.width}px`;
              e.target.style.height = `${e.height}px`;
              e.target.style.transform = `translate(${tx}px, ${ty}px) rotate(${selected.rotation}deg)`;
              onChange(selected.id, { x: tx / zoom, y: ty / zoom, width: e.width / zoom, height: e.height / zoom }, { transient: true });
            }}
            onResizeEnd={endGesture}
            onRotateStart={(e) => {
              startGesture();
              e.set(selected.rotation);
            }}
            onRotate={(e) => {
              e.target.style.transform = `translate(${selected.x * zoom}px, ${selected.y * zoom}px) rotate(${e.beforeRotate}deg)`;
              onChange(selected.id, { rotation: normalizeAngle(e.beforeRotate) }, { transient: true });
            }}
            onRotateEnd={endGesture}
          />
        )}

        {groupTargets.length > 1 && (
          <Moveable
            ref={moveableRef}
            target={groupTargets}
            draggable
            passDragArea
            {...snapProps}
            onDragGroupStart={(e) => {
              startGesture();
              e.events.forEach((ev) => {
                const el = byId(ev.target);
                if (el) ev.set([el.x * zoom, el.y * zoom]);
              });
            }}
            onDragGroup={(e) => {
              const patches: Record<string, Partial<LabelElement>> = {};
              e.events.forEach((ev) => {
                const el = byId(ev.target);
                if (!el) return;
                const [tx, ty] = ev.beforeTranslate;
                ev.target.style.transform = `translate(${tx}px, ${ty}px) rotate(${el.rotation}deg)`;
                patches[el.id] = { x: tx / zoom, y: ty / zoom };
              });
              onChangeMany(patches, { transient: true });
            }}
            onDragGroupEnd={endGesture}
          />
        )}
      </div>
      <div className="stage-footer">
        <span className="stage-size">
          {width} × {height} dots · the preview shows exactly what prints
        </span>
        <div className="zoom-bar">
          <button className={`zoom-chip${fitted ? " active" : ""}`} title="Fit the label to the window" onClick={() => onZoom("fit")}>
            Fit
          </button>
          <button
            className={`zoom-chip${zoomLevel === 100 ? " active" : ""}`}
            title="Show the label at the size it prints (how close depends on your screen)"
            onClick={() => onZoom(100)}
          >
            Actual size
          </button>
          <button className="icon-button" title="Zoom out (Ctrl + scroll)" onClick={() => zoomTo(percent / ZOOM_STEP)} disabled={percent <= minPercent + 0.5}>
            <ZoomOut size={15} />
          </button>
          <input
            type="range"
            className="zoom-slider"
            aria-label="Zoom"
            // Logarithmic, so each bit of the slider zooms by the same factor.
            min={Math.log(minPercent)}
            max={Math.log(maxPercent)}
            step="any"
            value={Math.log(percent)}
            onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))}
          />
          <button className="icon-button" title="Zoom in (Ctrl + scroll)" onClick={() => zoomTo(percent * ZOOM_STEP)} disabled={percent >= maxPercent - 0.5}>
            <ZoomIn size={15} />
          </button>
          <span className="zoom-value">{Math.round(percent)}%</span>
        </div>
      </div>
    </div>
  );
}

/** Whether Alt (Option on a Mac) is held down. */
function useAltKey(): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setDown(e.altKey);
    const blur = () => setDown(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return down;
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
