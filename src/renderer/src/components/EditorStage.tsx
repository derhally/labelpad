import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import Moveable from "react-moveable";
import { bounds } from "../editor/arrange";
import { renderLabel, type RenderIssues } from "../editor/render";
import { keepsAspect, type LabelElement } from "../editor/types";

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
  onRendered: (canvas: HTMLCanvasElement, issues: RenderIssues) => void;
  /** Changes each minute while the label shows the time, to redraw it. */
  clock: number;
  /** The number {count} shows in the preview. */
  count: number;
};

const MAX_ZOOM = 8;
const STAGE_PADDING = 96;

/**
 * The label canvas plus an invisible box per element that Moveable uses for
 * dragging, resizing and rotating. The canvas always shows the 1-bit render.
 */
/** A drag-to-select rectangle, in label dots. */
type Marquee = { x0: number; y0: number; x1: number; y1: number; additive: boolean };

export function EditorStage({ elements, width, height, selectedIds, onSelect, onChange, onChangeMany, onGestureStart, onEditText, onRendered, clock, count }: Props) {
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const boxRefs = useRef(new Map<string, HTMLDivElement>());
  const gesturing = useRef(false);
  const [zoom, setZoom] = useState(4);
  const [, forceRender] = useState(0);

  // Fit the label to the available space.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const z = Math.min((stage.clientWidth - STAGE_PADDING) / width, (stage.clientHeight - STAGE_PADDING) / height, MAX_ZOOM);
      setZoom(Math.max(1, Math.round(z * 4) / 4));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [width, height]);

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

  return (
    <div className="stage" ref={stageRef} onPointerDown={(e) => e.target === e.currentTarget && !e.shiftKey && onSelect([])}>
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
      <p className="stage-caption">
        {width} × {height} dots · {Math.round(zoom * 100) / 100}× zoom · the preview shows exactly what prints
      </p>

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
          snappable
          snapThreshold={6}
          snapRotationThreshold={4}
          snapRotationDegrees={[0, 90, 180, 270]}
          isDisplaySnapDigit={false}
          snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
          elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
          verticalGuidelines={[0, (width * zoom) / 2, width * zoom]}
          horizontalGuidelines={[0, (height * zoom) / 2, height * zoom]}
          elementGuidelines={guides}
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
          snappable
          snapThreshold={6}
          isDisplaySnapDigit={false}
          snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
          elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
          verticalGuidelines={[0, (width * zoom) / 2, width * zoom]}
          horizontalGuidelines={[0, (height * zoom) / 2, height * zoom]}
          elementGuidelines={guides}
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
  );
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
