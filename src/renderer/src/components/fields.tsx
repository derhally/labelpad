import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

type NumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  label?: string;
};

export function NumberInput({ value, onChange, min, max, step = 1, suffix, label }: NumberInputProps) {
  return (
    <div className="number-input">
      {label && <span className="number-label">{label}</span>}
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(clamp(n, min, max));
        }}
      />
      {suffix && <span className="number-suffix">{suffix}</span>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  // One highlight slides to the chosen option instead of each button lighting up.
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const index = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const measure = () => {
      const button = ref.current?.querySelectorAll<HTMLButtonElement>(":scope > button")[index];
      setPill(button ? { left: button.offsetLeft, width: button.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [index, options.length]);

  return (
    <div className="segmented" role="radiogroup" ref={ref}>
      {pill && <span className="segmented-pill" aria-hidden style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          title={o.title}
          aria-checked={value === o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Values the slider settles on when you let go close to them. */
  stops: number[];
  onChange: (value: number) => void;
  onStart?: () => void;
};

/**
 * A range slider with stops: while dragging, values near a stop snap to it,
 * and the stops are marked under the track.
 */
export function DetentSlider({ value, min, max, step = 1, stops, onChange, onStart }: SliderProps) {
  const inRange = stops.filter((s) => s >= min && s <= max);
  const pull = (max - min) * 0.025;
  const snap = (v: number) => inRange.find((s) => Math.abs(s - v) <= pull) ?? v;
  const at = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="detent-slider">
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={onStart} onChange={(e) => onChange(snap(Number(e.target.value)))} />
      <div className="detents" aria-hidden>
        {inRange.map((s) => (
          <span key={s} className={s === value ? "on" : ""} style={{ left: at(s) }} />
        ))}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
