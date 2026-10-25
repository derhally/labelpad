import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { ICON_IDS, ICONS, POPULAR_IDS } from "../editor/icons";

/** Rendering every match at once makes typing lag, so show this many and ask for a narrower search. */
const MAX_SHOWN = 300;

type Props = { open: boolean; onPick: (icon: string) => void; onClose: () => void };

export function IconPicker({ open, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/s+/g, "-");
    return q ? ICON_IDS.filter((id) => id.includes(q)) : POPULAR_IDS;
  }, [query]);

  if (!open) return null;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-labelledby="icon-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2 id="icon-title">Choose an icon</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <label className="search">
          <Search size={16} />
          <input autoFocus placeholder={`Search all ${ICON_IDS.length.toLocaleString()} icons`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="icon-grid">
          {matches.slice(0, MAX_SHOWN).map((id) => {
            const Icon = ICONS[id];
            return (
              <button key={id} className="icon-cell" title={id} onClick={() => onPick(id)}>
                <Icon size={22} />
                <span>{id.replace(/-/g, " ")}</span>
              </button>
            );
          })}
          {matches.length === 0 && <p className="muted empty">No icons match "{query}".</p>}
          {matches.length > MAX_SHOWN && <p className="muted empty">{(matches.length - MAX_SHOWN).toLocaleString()} more. Type more of the name to narrow it down.</p>}
        </div>
      </div>
    </div>
  );
}
