import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import Moveable from "react-moveable";
import { renderLabel, type RenderIssues } from "../editor/render";
import { keepsAspect, type LabelElement } from "../editor/types";

type Props = {
  elements: LabelElement[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<LabelElement>, opts?: { transient?: boolean }) => void;
  onGestureStart: () => void;
  onEditText: (id: string) => void;
  onRendered: (canvas: HTMLCanvasElement, issues: RenderIssues) => void;
};

const MAX_ZOOM = 8;
const STAGE_PADDING = 96;

/**
 * The label canvas plus an invisible box per element that Moveable uses for
 * dragging, resizing and rotating. The canvas always shows the 1-bit render.
 */
export function EditorStage({ elements, width, height, selectedId, onSelect, onChange, onGestureStart, onEditText, onRendered }: Props) {
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
    renderLabel(offscreen, width, height, elements).then((issues) => {
      if (token !== renderToken.current || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(offscreen, 0, 0);
      onRendered(canvas, issues);
    });
  }, [elements, width, height, onRendered]);

  useLayoutEffect(() => {
    if (!gesturing.current) moveableRef.current?.updateRect();
  });

  // Box elements mount after the first render; make sure Moveable sees the target.
  useEffect(() => forceRender((n) => n + 1), [selectedId]);

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const target = selected ? (boxRefs.current.get(selected.id) ?? null) : null;
  const guides = [...boxRefs.current.entries()].filter(([id]) => id !== selectedId).map(([, el]) => el);

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
    if (!selected) return;
    const round = (n: number) => Math.round(n);
    onChange(
      selected.id,
      { x: round(selected.x), y: round(selected.y), width: Math.max(1, round(selected.width)), height: Math.max(1, round(selected.height)), rotation: Math.round(selected.rotation * 10) / 10 },
      { transient: true },
    );
  };

  return (
    <div className="stage" ref={stageRef} onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
      <div className="label-frame">
        <div className="label-surface" style={{ width: width * zoom, height: height * zoom }}>
          <canvas ref={canvasRef} className="label-canvas" width={width} height={height} />
          <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
            {elements.map((el) => (
              <div
                key={el.id}
                ref={(node) => {
                  if (node) boxRefs.current.set(el.id, node);
                  else boxRefs.current.delete(el.id);
                }}
                className={`box${el.id === selectedId ? " selected" : ""}`}
                style={boxStyle(el)}
                onMouseDown={(e) => {
                  if (el.id === selectedId) return;
                  const native = e.nativeEvent;
                  flushSync(() => onSelect(el.id));
                  moveableRef.current?.dragStart(native, e.currentTarget);
                }}
                onDoubleClick={() => el.type === "text" && onEditText(el.id)}
              />
            ))}
          </div>
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
    </div>
  );
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
