import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, ChevronDown, ChevronUp, Circle, Copy,
  ImageUp, Italic, Minus, Square, Trash2, TriangleAlert,
} from "lucide-react";
import { ICONS } from "../editor/icons";
import { FONT_FAMILIES } from "../editor/render";
import { BARCODE_FORMATS, type LabelElement } from "../editor/types";
import { DOTS_PER_MM } from "../printer/label";
import { Field, NumberInput, Segmented, Toggle } from "./fields";
import { TYPE_META } from "./Toolbar";

type Update = (patch: Partial<LabelElement>, opts?: { transient?: boolean }) => void;

type Props = {
  el: LabelElement;
  issue?: string;
  onChange: Update;
  onCheckpoint: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (to: "up" | "down" | "top" | "bottom") => void;
  onPickIcon: () => void;
  onReplaceImage: () => void;
};

export function Inspector({ el, issue, onChange, onCheckpoint, onDuplicate, onDelete, onReorder, onPickIcon, onReplaceImage }: Props) {
  const meta = TYPE_META[el.type];
  // Typing is one undo step per focus, not per keystroke.
  const typing = { onFocus: onCheckpoint };
  const type = (patch: Partial<LabelElement>) => onChange(patch, { transient: true });
  const mm = (dots: number) => dots / DOTS_PER_MM;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className="type-chip">
          <meta.icon size={15} /> {meta.label}
        </span>
        <div className="row-actions">
          <button className="icon-button" title="Bring forward" onClick={() => onReorder("up")}>
            <ChevronUp size={16} />
          </button>
          <button className="icon-button" title="Send backward" onClick={() => onReorder("down")}>
            <ChevronDown size={16} />
          </button>
          <button className="icon-button" title="Bring to front" onClick={() => onReorder("top")}>
            <ArrowUpToLine size={16} />
          </button>
          <button className="icon-button" title="Send to back" onClick={() => onReorder("bottom")}>
            <ArrowDownToLine size={16} />
          </button>
          <button className="icon-button" title="Duplicate (Ctrl+D)" onClick={onDuplicate}>
            <Copy size={16} />
          </button>
          <button className="icon-button danger" title="Delete (Del)" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {issue && (
        <div className="notice warn">
          <TriangleAlert size={16} />
          <span>{issue}</span>
        </div>
      )}

      {el.type === "text" && (
        <>
          <Field label="Text">
            <textarea id="inspector-text" rows={3} value={el.text} {...typing} onChange={(e) => type({ text: e.target.value })} />
          </Field>
          <Field label="Font">
            <select value={el.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <Segmented
              value={el.align}
              onChange={(align) => onChange({ align })}
              options={[
                { value: "left", label: <AlignLeft size={16} />, title: "Align left" },
                { value: "center", label: <AlignCenter size={16} />, title: "Centre" },
                { value: "right", label: <AlignRight size={16} />, title: "Align right" },
              ]}
            />
            <div className="segmented">
              <button className={el.bold ? "active" : ""} title="Bold" onClick={() => onChange({ bold: !el.bold })}>
                <Bold size={16} />
              </button>
              <button className={el.italic ? "active" : ""} title="Italic" onClick={() => onChange({ italic: !el.italic })}>
                <Italic size={16} />
              </button>
            </div>
          </div>
          <Toggle checked={el.autoFit} onChange={(autoFit) => onChange({ autoFit })}>
            Fit text to box
          </Toggle>
          {!el.autoFit && (
            <Field label={`Size · ${el.fontSize} dots`}>
              <input type="range" min={6} max={96} value={el.fontSize} onPointerDown={onCheckpoint} onChange={(e) => type({ fontSize: Number(e.target.value) })} />
            </Field>
          )}
          <Toggle checked={el.invert} onChange={(invert) => onChange({ invert })}>
            White on black
          </Toggle>
        </>
      )}

      {el.type === "image" && (
        <>
          <button className="button ghost" onClick={onReplaceImage}>
            <ImageUp size={16} /> {el.src ? "Replace image" : "Choose image"}
          </button>
          <Field label="Style">
            <Segmented
              value={el.mode}
              onChange={(mode) => onChange({ mode })}
              options={[
                { value: "dither", label: "Photo", title: "Dithered shading, best for photos" },
                { value: "threshold", label: "Logo", title: "Crisp black and white, best for logos and line art" },
              ]}
            />
          </Field>
          <Field label="Darkness">
            <input type="range" min={20} max={235} value={el.threshold} onPointerDown={onCheckpoint} onChange={(e) => type({ threshold: Number(e.target.value) })} />
          </Field>
          <Toggle checked={el.invert} onChange={(invert) => onChange({ invert })}>
            Invert
          </Toggle>
        </>
      )}

      {el.type === "barcode" && (
        <>
          <Field label="Value">
            <input type="text" value={el.value} {...typing} onChange={(e) => type({ value: e.target.value })} />
          </Field>
          <Field label="Format">
            <select value={el.format} onChange={(e) => onChange({ format: e.target.value as typeof el.format })}>
              {BARCODE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f === "CODE128" ? "Code 128 (any text)" : f === "CODE39" ? "Code 39" : f === "UPC" ? "UPC-A" : f === "ITF14" ? "ITF-14" : f.replace("EAN", "EAN-")}
                </option>
              ))}
            </select>
          </Field>
          <Toggle checked={el.showText} onChange={(showText) => onChange({ showText })}>
            Show value under bars
          </Toggle>
        </>
      )}

      {el.type === "qr" && (
        <>
          <Field label="Text or link">
            <textarea rows={3} value={el.value} {...typing} onChange={(e) => type({ value: e.target.value })} />
          </Field>
          <Field label="Error correction">
            <Segmented
              value={el.errorCorrection}
              onChange={(errorCorrection) => onChange({ errorCorrection })}
              options={[
                { value: "L", label: "Low", title: "Smallest code, recovers 7% damage" },
                { value: "M", label: "Medium", title: "Recovers 15% damage" },
                { value: "Q", label: "High", title: "Recovers 25% damage" },
                { value: "H", label: "Max", title: "Largest code, recovers 30% damage" },
              ]}
            />
          </Field>
        </>
      )}

      {el.type === "icon" && (
        <>
          <button className="button ghost icon-choice" onClick={onPickIcon}>
            {(() => {
              const Icon = ICONS[el.icon];
              return Icon ? <Icon size={20} /> : null;
            })()}
            <span>{el.icon.replace(/-/g, " ")}</span>
            <span className="muted">Change</span>
          </button>
          <Field label={`Line weight · ${el.strokeWidth}`}>
            <input type="range" min={1} max={4} step={0.25} value={el.strokeWidth} onPointerDown={onCheckpoint} onChange={(e) => type({ strokeWidth: Number(e.target.value) })} />
          </Field>
        </>
      )}

      {el.type === "shape" && (
        <>
          <Field label="Shape">
            <Segmented
              value={el.shape}
              onChange={(shape) => onChange({ shape })}
              options={[
                { value: "rect", label: <Square size={16} />, title: "Rectangle" },
                { value: "ellipse", label: <Circle size={16} />, title: "Ellipse" },
                { value: "line", label: <Minus size={16} />, title: "Line" },
              ]}
            />
          </Field>
          <Field label={`Line weight · ${el.strokeWidth} dots`}>
            <input type="range" min={1} max={16} value={el.strokeWidth} onPointerDown={onCheckpoint} onChange={(e) => type({ strokeWidth: Number(e.target.value) })} />
          </Field>
          {el.shape !== "line" && (
            <Toggle checked={el.filled} onChange={(filled) => onChange({ filled })}>
              Filled
            </Toggle>
          )}
          {el.shape === "rect" && (
            <Field label={`Corner radius · ${el.cornerRadius} dots`}>
              <input type="range" min={0} max={40} value={el.cornerRadius} onPointerDown={onCheckpoint} onChange={(e) => type({ cornerRadius: Number(e.target.value) })} />
            </Field>
          )}
        </>
      )}

      <div className="geometry">
        <span className="section-label">Position and size (mm)</span>
        <div className="grid-2">
          <NumberInput label="X" step={0.5} value={mm(el.x)} onChange={(v) => onChange({ x: v * DOTS_PER_MM })} />
          <NumberInput label="Y" step={0.5} value={mm(el.y)} onChange={(v) => onChange({ y: v * DOTS_PER_MM })} />
          <NumberInput label="W" step={0.5} min={0.5} value={mm(el.width)} onChange={(v) => onChange({ width: v * DOTS_PER_MM })} />
          <NumberInput label="H" step={0.5} min={0.5} value={mm(el.height)} onChange={(v) => onChange({ height: v * DOTS_PER_MM })} />
          <NumberInput label="↻" step={15} value={el.rotation} suffix="°" onChange={(v) => onChange({ rotation: ((v % 360) + 360) % 360 })} />
        </div>
      </div>
    </div>
  );
}
