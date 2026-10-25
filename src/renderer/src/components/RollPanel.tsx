import { useState } from "react";
import { Disc3 } from "lucide-react";
import type { LabelPreset, LabelSize } from "../printer/label";
import type { RollInfo } from "../printer/usePrinter";

type Props = {
  roll: RollInfo;
  /** The size you've confirmed for this roll type before, if any. */
  knownSize?: LabelSize;
  labelSize: LabelSize;
  /** The printer's usual sizes, offered when asking about a new roll. */
  presets: LabelPreset[];
  onRemember: (size: LabelSize) => void;
  onUseSize: (size: LabelSize) => void;
};

const same = (a: LabelSize, b: LabelSize) => a.widthMm === b.widthMm && a.lengthMm === b.lengthMm;
const name = (s: LabelSize) => `${s.widthMm} × ${s.lengthMm} mm`;

/**
 * The loaded label roll, from its RFID tag. The tag only identifies the roll
 * type, so its size is asked once and then remembered for that type.
 */
export function RollPanel({ roll, knownSize, labelSize, presets, onRemember, onUseSize }: Props) {
  const left = Math.max(0, roll.allPaper - roll.usedPaper);
  const options = presets.some((p) => same(p, labelSize)) ? presets : [{ ...labelSize, name: name(labelSize) }, ...presets];
  const [choice, setChoice] = useState(name(labelSize));

  return (
    <div className="roll">
      <div className="roll-head">
        <Disc3 size={16} />
        <span>{knownSize ? `${name(knownSize)} roll` : "Label roll"}</span>
        {roll.allPaper > 0 && (
          <span className="muted roll-left">
            {left} of {roll.allPaper} left
          </span>
        )}
      </div>
      {roll.allPaper > 0 && (
        <div className="roll-meter" aria-hidden>
          <div style={{ width: `${(left / roll.allPaper) * 100}%` }} />
        </div>
      )}

      {knownSize && !same(knownSize, labelSize) && (
        <div className="roll-row">
          <span>Your label is {name(labelSize)}.</span>
          <button className="button ghost small" onClick={() => onUseSize(knownSize)}>
            Use {name(knownSize)}
          </button>
        </div>
      )}

      {!knownSize && (
        <div className="roll-ask">
          <span>What size are these labels? It's remembered for this roll type.</span>
          <div className="roll-row">
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {options.map((p) => (
                <option key={p.name} value={name(p)}>
                  {name(p)}
                </option>
              ))}
            </select>
            <button
              className="button primary small"
              onClick={() => {
                const size = options.find((p) => name(p) === choice) ?? labelSize;
                onRemember({ widthMm: size.widthMm, lengthMm: size.lengthMm });
              }}
            >
              Remember
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
