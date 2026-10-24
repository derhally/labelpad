import { LABEL_PRESETS, type LabelSize } from "../printer/label";
import { NumberInput } from "./fields";

type Props = { size: LabelSize; printableMm: number; onChange: (size: LabelSize) => void };

export function LabelSettings({ size, printableMm, onChange }: Props) {
  const preset = LABEL_PRESETS.find((p) => p.widthMm === size.widthMm && p.lengthMm === size.lengthMm);
  return (
    <div className="inspector">
      <div className="inspector-head">
        <h2>Label</h2>
      </div>
      <div className="presets">
        {LABEL_PRESETS.map((p) => (
          <button key={p.name} className={`preset${p === preset ? " active" : ""}`} onClick={() => onChange({ widthMm: p.widthMm, lengthMm: p.lengthMm })}>
            <span className="preset-shape" style={{ aspectRatio: `${p.lengthMm} / ${p.widthMm}` }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="geometry">
        <span className="section-label">Custom size (mm)</span>
        <div className="grid-2">
          <NumberInput label="W" min={4} max={30} step={1} value={size.widthMm} onChange={(widthMm) => onChange({ ...size, widthMm })} />
          <NumberInput label="L" min={5} max={200} step={1} value={size.lengthMm} onChange={(lengthMm) => onChange({ ...size, lengthMm })} />
        </div>
      </div>
      {size.widthMm > printableMm && (
        <p className="muted hint">The D11 prints a {printableMm} mm strip, so the middle {printableMm} mm of this label is used.</p>
      )}
      <p className="muted hint">Add text, images, codes and icons with the tools on the left. Select anything on the label to edit it.</p>
    </div>
  );
}
