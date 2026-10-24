import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CATEGORY_LABELS, useSystemFonts, type FontCategory } from "../editor/fonts";

type Props = {
  open: boolean;
  value: string;
  /** The label's own text, shown in every font. */
  previewText: string;
  bold: boolean;
  italic: boolean;
  onPick: (font: string) => void;
  onClose: () => void;
};

const ORDER: FontCategory[] = ["sans", "serif", "mono", "script", "display", "symbol", "other"];

/** Browse installed fonts by style, each previewing the label's text. */
export function FontBrowser({ open, value, previewText, bold, italic, onPick, onClose }: Props) {
  const fonts = useSystemFonts();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontCategory | "all">("all");
  const [sample, setSample] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = {} as Record<FontCategory, number>;
    for (const f of fonts) c[f.category] = (c[f.category] ?? 0) + 1;
    return c;
  }, [fonts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts.filter((f) => (category === "all" || f.category === category) && (!q || f.family.toLowerCase().includes(q)));
  }, [fonts, query, category]);

  if (!open) return null;

  const text = (sample ?? previewText).trim() || "The quick brown fox";
  const style = { fontWeight: bold ? 700 : 400, fontStyle: italic ? "italic" : "normal" } as const;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog font-browser" role="dialog" aria-labelledby="fonts-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2 id="fonts-title">Choose a font</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="font-browser-controls">
          <div className="search">
            <Search size={15} />
            <input autoFocus placeholder={`Search ${fonts.length} fonts`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <input type="text" className="sample-input" placeholder="Preview text" value={sample ?? previewText} onChange={(e) => setSample(e.target.value)} />
        </div>

        <div className="chips" role="radiogroup" aria-label="Font style">
          <button role="radio" aria-checked={category === "all"} className={`chip${category === "all" ? " active" : ""}`} onClick={() => setCategory("all")}>
            All <span>{fonts.length}</span>
          </button>
          {ORDER.filter((c) => counts[c]).map((c) => (
            <button key={c} role="radio" aria-checked={category === c} className={`chip${category === c ? " active" : ""}`} onClick={() => setCategory(c)}>
              {CATEGORY_LABELS[c]} <span>{counts[c]}</span>
            </button>
          ))}
        </div>

        <div className="font-cards">
          {shown.map((f) => (
            <button
              key={f.family}
              className={`font-card${f.family === value ? " active" : ""}`}
              onClick={() => {
                onPick(f.family);
                onClose();
              }}
            >
              <span className="font-sample" style={{ ...style, fontFamily: `"${f.family}", sans-serif` }}>
                {text}
              </span>
              <span className="font-card-name">
                {f.family}
                <em>{CATEGORY_LABELS[f.category]}</em>
              </span>
            </button>
          ))}
          {!shown.length && <p className="muted empty">No fonts match.</p>}
        </div>
      </div>
    </div>
  );
}
