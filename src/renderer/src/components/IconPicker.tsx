import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { ICON_IDS, ICONS } from "../editor/icons";

type Props = { open: boolean; onPick: (icon: string) => void; onClose: () => void };

export function IconPicker({ open, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_IDS.filter((id) => id.includes(q)) : ICON_IDS;
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
          <input autoFocus placeholder="Search icons" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="icon-grid">
          {matches.map((id) => {
            const Icon = ICONS[id];
            return (
              <button key={id} className="icon-cell" title={id} onClick={() => onPick(id)}>
                <Icon size={22} />
                <span>{id.replace(/-/g, " ")}</span>
              </button>
            );
          })}
          {matches.length === 0 && <p className="muted empty">No icons match "{query}".</p>}
        </div>
      </div>
    </div>
  );
}
