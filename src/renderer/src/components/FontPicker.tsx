import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { COMMON_FONTS, useSystemFonts } from "../editor/fonts";

type Props = { value: string; onChange: (font: string) => void };

/** Searchable list of installed fonts, each shown in its own typeface. */
export function FontPicker({ value, onChange }: Props) {
  const fonts = useSystemFonts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const { common, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: string) => !q || f.toLowerCase().includes(q);
    const installed = new Set(fonts);
    const common = COMMON_FONTS.filter((f) => installed.has(f) && match(f));
    return { common, rest: fonts.filter((f) => match(f) && !common.includes(f)) };
  }, [fonts, query]);

  const pick = (font: string) => {
    onChange(font);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="font-picker" ref={root}>
      <button type="button" className="font-current" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span style={{ fontFamily: `"${value}"` }}>{value}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="font-menu">
          <div className="search">
            <Search size={15} />
            <input
              autoFocus
              placeholder={`Search ${fonts.length} fonts`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter") {
                  const first = common[0] ?? rest[0];
                  if (first) pick(first);
                }
              }}
            />
          </div>
          <div className="font-list" role="listbox">
            {common.length > 0 && <span className="font-group">Popular</span>}
            {common.map((f) => (
              <FontOption key={f} font={f} selected={f === value} onPick={pick} />
            ))}
            {rest.length > 0 && <span className="font-group">All fonts</span>}
            {rest.map((f) => (
              <FontOption key={f} font={f} selected={f === value} onPick={pick} />
            ))}
            {!common.length && !rest.length && <p className="muted empty">No fonts match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function FontOption({ font, selected, onPick }: { font: string; selected: boolean; onPick: (f: string) => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} className={`font-option${selected ? " active" : ""}`} onClick={() => onPick(font)}>
      <span style={{ fontFamily: `"${font}"` }}>{font}</span>
    </button>
  );
}
