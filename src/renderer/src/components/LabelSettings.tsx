import { PRINTERS, type LabelSize, type PrinterId, type PrinterProfile } from "../printer/label";
import { Field, NumberInput, Segmented } from "./fields";

type Props = {
  size: LabelSize;
  profile: PrinterProfile;
  onChange: (size: LabelSize) => void;
  /** Lay the label out for another printer. */
  onPrinter: (printer: PrinterId) => void;
};

export function LabelSettings({ size, profile, onChange, onPrinter }: Props) {
  const presets = profile.presets;
  const preset = presets.find((p) => p.widthMm === size.widthMm && p.lengthMm === size.lengthMm);
  const printableMm = Math.floor((profile.printheadPixels / profile.dotsPerMm) * 10) / 10;
  // The canvas shows width across the printhead: vertical on the D11, horizontal on the M3.
  const aspect = (p: LabelSize) => (profile.direction === "left" ? `${p.lengthMm} / ${p.widthMm}` : `${p.widthMm} / ${p.lengthMm}`);
  return (
    <div className="inspector">
      <div className="inspector-head">
        <h2>Label</h2>
      </div>
      <Field label="Printer">
        <Segmented
          value={profile.id}
          onChange={onPrinter}
          options={Object.values(PRINTERS).map((p) => ({ value: p.id, label: p.name, title: `Lay this label out for the ${p.name}` }))}
        />
      </Field>
      <div className="presets">
        {presets.map((p) => (
          <button key={p.name} className={`preset${p === preset ? " active" : ""}`} onClick={() => onChange({ widthMm: p.widthMm, lengthMm: p.lengthMm })}>
            <span className="preset-shape" style={{ aspectRatio: aspect(p) }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="geometry">
        <span className="section-label">Custom size (mm)</span>
        <div className="grid-2">
          <NumberInput label="W" min={4} max={profile.maxWidthMm} step={1} value={size.widthMm} onChange={(widthMm) => onChange({ ...size, widthMm })} />
          <NumberInput label="L" min={5} max={200} step={1} value={size.lengthMm} onChange={(lengthMm) => onChange({ ...size, lengthMm })} />
        </div>
      </div>
      {size.widthMm > printableMm && (
        <p className="muted hint">
          The {profile.name} prints a {printableMm} mm strip, so the middle {printableMm} mm of this label is used.
        </p>
      )}
      <p className="muted hint">Add text, images, codes and icons with the tools on the left. Select anything on the label to edit it.</p>
    </div>
  );
}
