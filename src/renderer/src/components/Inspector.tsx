import {
  AlignCenter, AlignEndHorizontal, AlignLeft, AlignRight, AlignStartHorizontal, AlignCenterHorizontal, ArrowDownToLine, ArrowUpToLine, Bold, ChevronDown, ChevronUp, Circle, Copy,
  ImageUp, Italic, LayoutGrid, Minus, Square, Trash2, TriangleAlert,
} from "lucide-react";
import { ICONS } from "../editor/icons";
import { fitFontSize } from "../editor/render";
import { DATE_PRESETS, dateTimeText, formatDate, formatTime } from "../editor/dateFormat";
import { BARCODE_FORMATS, type LabelElement, type TextStyle } from "../editor/types";
import { useState } from "react";
import { FontBrowser } from "./FontBrowser";
import { FontPicker } from "./FontPicker";
import { AlignControls } from "./AlignControls";
import { spell } from "../locale";
import { DetentSlider, Field, NumberInput, Segmented, Toggle } from "./fields";
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
  label: { width: number; height: number; dotsPerMm: number };
  onArrange: (patches: Record<string, Partial<LabelElement>>) => void;
};

const CUSTOM = "__custom";

export function Inspector({ el, issue, onChange, onCheckpoint, onDuplicate, onDelete, onReorder, onPickIcon, onReplaceImage, label, onArrange }: Props) {
  const meta = TYPE_META[el.type];
  // Typing is one undo step per focus, not per keystroke.
  const typing = { onFocus: onCheckpoint };
  const type = (patch: Partial<LabelElement>) => onChange(patch, { transient: true });
  const mm = (dots: number) => dots / label.dotsPerMm;
  const dots = (mm: number) => mm * label.dotsPerMm;
  // Slider ranges in dots are set for 8 dots per mm and grow with the resolution.
  const k = label.dotsPerMm / 8;
  const mmStops = (mms: number[]) => mms.map((v) => Math.round(dots(v)));
  const now = new Date();

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
          <CounterHint onInsert={() => onChange({ text: `${el.text}{count}` })} />
          <TextStyleFields el={el} previewText={el.text} onChange={onChange} onCheckpoint={onCheckpoint} dotsPerMm={label.dotsPerMm} box={el} />
        </>
      )}

      {el.type === "datetime" && (
        <>
          <Field label="Show">
            <Segmented
              value={el.show}
              onChange={(show) => onChange({ show })}
              options={[
                { value: "datetime", label: "Date + time" },
                { value: "date", label: "Date" },
                { value: "time", label: "Time" },
              ]}
            />
          </Field>
          {el.show !== "time" && (
            <Field label="Date format">
              <select
                value={DATE_PRESETS.some((p) => p.pattern === el.dateFormat) ? el.dateFormat : CUSTOM}
                onChange={(e) => onChange({ dateFormat: e.target.value === CUSTOM ? "DD MMM YYYY" : e.target.value })}
              >
                {DATE_PRESETS.map((p) => (
                  <option key={p.pattern} value={p.pattern}>
                    {formatDate(now, p.pattern)}
                    {p.label ? ` (${p.label.toLowerCase()})` : ""}
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </Field>
          )}
          {el.show !== "time" && !DATE_PRESETS.some((p) => p.pattern === el.dateFormat) && (
            <Field label="Custom pattern">
              <input id="inspector-text" type="text" value={el.dateFormat} {...typing} onChange={(e) => type({ dateFormat: e.target.value })} />
              <p className="muted hint token-help">YYYY year · MM or MMM month · DD day · ddd weekday</p>
            </Field>
          )}
          {el.show !== "date" && (
            <Field label="Time">
              <Segmented
                value={el.hour12 ? "12" : "24"}
                onChange={(v) => onChange({ hour12: v === "12" })}
                options={[
                  { value: "24", label: `24-hour · ${formatTime(now, false)}` },
                  { value: "12", label: `12-hour · ${formatTime(now, true)}` },
                ]}
              />
            </Field>
          )}
          <div className="grid-2">
            <Field label="Text before">
              <input type="text" placeholder="e.g. Packed " value={el.prefix} {...typing} onChange={(e) => type({ prefix: e.target.value })} />
            </Field>
            {el.show !== "time" && (
              <Field label="Add days">
                <NumberInput min={-3650} max={3650} value={el.offsetDays} onChange={(offsetDays) => onChange({ offsetDays: Math.round(offsetDays) })} />
              </Field>
            )}
          </div>
          {el.show !== "time" && el.offsetDays !== 0 && (
            <p className="muted hint">
              Prints the date {Math.abs(el.offsetDays)} day{Math.abs(el.offsetDays) === 1 ? "" : "s"} {el.offsetDays > 0 ? "after" : "before"} printing, for use-by labels.
            </p>
          )}
          <p className="muted hint">
            Prints as: <strong>{dateTimeText(el, now)}</strong>
          </p>
          <TextStyleFields el={el} previewText={dateTimeText(el, now)} onChange={onChange} onCheckpoint={onCheckpoint} dotsPerMm={label.dotsPerMm} box={el} />
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
            <DetentSlider min={20} max={235} value={el.threshold} stops={[128]} onStart={onCheckpoint} onChange={(threshold) => type({ threshold })} />
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
          <CounterHint onInsert={() => onChange({ value: `${el.value}{count}` })} />
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
          <CounterHint onInsert={() => onChange({ value: `${el.value}{count}` })} />
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
            <DetentSlider min={1} max={4} step={0.25} value={el.strokeWidth} stops={[1, 1.5, 2, 3]} onStart={onCheckpoint} onChange={(strokeWidth) => type({ strokeWidth })} />
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
            <DetentSlider
              min={1}
              max={Math.round(16 * k)}
              value={el.strokeWidth}
              stops={mmStops([0.25, 0.5, 1, 1.5])}
              onStart={onCheckpoint}
              onChange={(strokeWidth) => type({ strokeWidth })}
            />
          </Field>
          {el.shape !== "line" && (
            <Toggle checked={el.filled} onChange={(filled) => onChange({ filled })}>
              Filled
            </Toggle>
          )}
          {el.shape === "rect" && (
            <Field label={`Corner radius · ${el.cornerRadius} dots`}>
              <DetentSlider
                min={0}
                max={Math.round(40 * k)}
                value={el.cornerRadius}
                stops={[0, ...mmStops([1, 2, 3, 4])]}
                onStart={onCheckpoint}
                onChange={(cornerRadius) => type({ cornerRadius })}
              />
            </Field>
          )}
        </>
      )}

      <div className="geometry">
        <span className="section-label">Position on label</span>
        <AlignControls els={[el]} label={label} onApply={onArrange} />
        <span className="section-label">Position and size (mm)</span>
        <div className="grid-2">
          <NumberInput label="X" step={0.5} value={mm(el.x)} onChange={(v) => onChange({ x: dots(v) })} />
          <NumberInput label="Y" step={0.5} value={mm(el.y)} onChange={(v) => onChange({ y: dots(v) })} />
          <NumberInput label="W" step={0.5} min={0.5} value={mm(el.width)} onChange={(v) => onChange({ width: dots(v) })} />
          <NumberInput label="H" step={0.5} min={0.5} value={mm(el.height)} onChange={(v) => onChange({ height: dots(v) })} />
          <NumberInput label="↻" step={15} value={el.rotation} suffix="°" onChange={(v) => onChange({ rotation: ((v % 360) + 360) % 360 })} />
        </div>
      </div>
    </div>
  );
}

/** Font, alignment and fit, shared by text and date/time. */
function TextStyleFields({
  el,
  previewText,
  onChange,
  onCheckpoint,
  dotsPerMm,
  box,
}: {
  el: TextStyle;
  previewText: string;
  onChange: Update;
  onCheckpoint: () => void;
  dotsPerMm: number;
  /** The text box, to work out the size "Fit text to box" picks. */
  box: { width: number; height: number };
}) {
  const [browsing, setBrowsing] = useState(false);
  const size = Math.round(el.autoFit ? fitFontSize(el, previewText, box.width, box.height) : el.fontSize);
  return (
    <>
      <div className="field">
        <span>Font</span>
        <div className="font-row">
          <FontPicker value={el.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
          <button className="button ghost" onClick={() => setBrowsing(true)} title="Browse fonts by style, with a preview of this label's text">
            <LayoutGrid size={16} /> Browse
          </button>
        </div>
      </div>
      <FontBrowser
        open={browsing}
        value={el.fontFamily}
        previewText={previewText}
        bold={el.bold}
        italic={el.italic}
        onPick={(fontFamily) => onChange({ fontFamily })}
        onClose={() => setBrowsing(false)}
      />
      <div className="row">
        <Segmented
          value={el.align}
          onChange={(align) => onChange({ align })}
          options={[
            { value: "left", label: <AlignLeft size={16} />, title: "Align left" },
            { value: "center", label: <AlignCenter size={16} />, title: spell("Center") },
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
      <Segmented
        value={el.valign}
        onChange={(valign) => onChange({ valign })}
        options={[
          { value: "top", label: <><AlignStartHorizontal size={16} /> Top</>, title: "Align to top" },
          { value: "middle", label: <><AlignCenterHorizontal size={16} /> Middle</>, title: spell("Center vertically") },
          { value: "bottom", label: <><AlignEndHorizontal size={16} /> Bottom</>, title: "Align to bottom" },
        ]}
      />
      {/* The size always shows; moving it turns off fitting, which starts from the fitted size. */}
      <Field label={`Size · ${(size / dotsPerMm).toFixed(1)} mm${el.autoFit ? ", fits the box" : ""}`}>
        <DetentSlider
          min={6}
          max={Math.max(Math.round(12 * dotsPerMm), size)}
          value={size}
          // Common text heights: 2, 3, 4, 5, 6, 8 and 10 mm.
          stops={[2, 3, 4, 5, 6, 8, 10].map((mm) => Math.round(mm * dotsPerMm))}
          onStart={onCheckpoint}
          onChange={(fontSize) => onChange({ fontSize, autoFit: false }, { transient: true })}
        />
      </Field>
      <Toggle checked={el.autoFit} onChange={(autoFit) => onChange(autoFit ? { autoFit } : { autoFit, fontSize: size })}>
        Fit text to box
      </Toggle>
      <Toggle checked={el.invert} onChange={(invert) => onChange({ invert })}>
        White on black
      </Toggle>
    </>
  );
}

/** Explains {count} and adds it to the end of the field. */
function CounterHint({ onInsert }: { onInsert: () => void }) {
  return (
    <p className="muted hint counter-hint">
      <button type="button" className="link-button" onClick={onInsert}>
        + Number
      </button>{" "}
      adds <code>{"{count}"}</code>, which counts up on each label you print. <code>{"{count:3}"}</code> pads it to 001.
    </p>
  );
}
