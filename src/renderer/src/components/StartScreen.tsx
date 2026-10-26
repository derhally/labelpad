import { useEffect, useState } from "react";
import { FilePlus2, FolderOpen, LayoutTemplate, PenLine, Search, X } from "lucide-react";
import { Toggle } from "./fields";
import { forgetRecent, recentLabels, type RecentLabel } from "../editor/recent";
import { useThumbnail } from "../editor/thumbnail";
import { readLabel } from "../editor/useLabelFile";
import type { LabelDoc } from "../editor/types";
import { PRINTERS, type LabelSize, type PrinterId } from "../printer/label";

type Props = {
  /** Shown; the recent list is read again each time it opens. */
  open: boolean;
  /** Size and printer new labels start with. */
  size: LabelSize;
  printer: PrinterId;
  /** Labels already open in tabs (restored from last time); 0 hides "Continue". */
  openCount: number;
  showAtLaunch: boolean;
  onShowAtLaunch: (show: boolean) => void;
  onNew: (size: LabelSize) => void;
  onTemplates: () => void;
  onOpenFile: () => void;
  onOpenRecent: (path: string) => void;
  onContinue: () => void;
};

/** What the window shows at launch: start a label, or pick up one of the last few you worked on. */
export function StartScreen({ open, size, printer, openCount, showAtLaunch, onShowAtLaunch, onNew, onTemplates, onOpenFile, onOpenRecent, onContinue }: Props) {
  const [recent, setRecent] = useState<RecentLabel[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    recentLabels()
      .then((r) => live && setRecent(r))
      .catch(() => live && setRecent([]));
    return () => {
      live = false;
    };
  }, [open]);

  if (!open) return null;

  const sizeName = (s: LabelSize) => `${s.widthMm} × ${s.lengthMm} mm`;
  const otherSizes = PRINTERS[printer].presets.filter((p) => p.widthMm !== size.widthMm || p.lengthMm !== size.lengthMm).slice(0, 4);
  const q = query.trim().toLowerCase();
  const shown = recent?.filter((r) => r.title.toLowerCase().includes(q)) ?? [];
  const remove = (path: string) => {
    forgetRecent(path);
    setRecent((r) => r?.filter((x) => x.path !== path) ?? null);
  };

  return (
    <div className="start">
      <section className="start-actions">
        <h1>{recent?.length ? "Welcome back" : "Welcome to LabelPad"}</h1>
        <button className="start-new" onClick={() => onNew(size)}>
          <FilePlus2 size={26} />
          <span>
            <strong>New label</strong>
            <small>
              {sizeName(size)} · {PRINTERS[printer].name}
            </small>
          </span>
        </button>
        {openCount > 0 && (
          <button className="start-link" onClick={onContinue}>
            <PenLine size={18} />
            <span>Continue editing</span>
            <small className="muted">{openCount === 1 ? "1 label" : `${openCount} labels`}</small>
          </button>
        )}
        <button className="start-link" onClick={onTemplates}>
          <LayoutTemplate size={18} />
          <span>Start from a template</span>
          <small className="muted">Ctrl N</small>
        </button>
        <button className="start-link" onClick={onOpenFile}>
          <FolderOpen size={18} />
          <span>Open a file…</span>
          <small className="muted">Ctrl O</small>
        </button>

        {otherSizes.length > 0 && (
          <>
            <span className="section-label start-sizes-label">Other sizes</span>
            <div className="start-sizes">
              {otherSizes.map((s) => (
                <button key={s.name} className="chip" onClick={() => onNew(s)}>
                  {s.name}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="start-launch">
          <Toggle checked={showAtLaunch} onChange={onShowAtLaunch}>
            Show this screen at launch
          </Toggle>
        </div>
      </section>

      <section className="start-recent">
        <header>
          <h2>Recent labels</h2>
          {!!recent?.length && (
            <label className="start-search">
              <Search size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recent labels" aria-label="Search recent labels" />
            </label>
          )}
        </header>
        {recent && !recent.length && <p className="muted start-empty">Labels you open or save will show up here, so you can get back to them quickly.</p>}
        {recent && !!recent.length && !shown.length && <p className="muted start-empty">No recent label matches “{query.trim()}”.</p>}
        <div className="start-grid">
          {shown.map((r) => (
            <RecentCard key={r.path} label={r} onOpen={() => onOpenRecent(r.path)} onRemove={() => remove(r.path)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RecentCard({ label, onOpen, onRemove }: { label: RecentLabel; onOpen: () => void; onRemove: () => void }) {
  const [doc, setDoc] = useState<LabelDoc | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    readLabel(label.path)
      .then((d) => live && setDoc(d))
      .catch(() => live && setBroken(true));
    return () => {
      live = false;
    };
  }, [label.path, label.modified]);
  const thumb = useThumbnail(doc);

  return (
    <div className="recent-card-wrap">
      <button className="recent-card" onClick={onOpen} title={label.path}>
        <span className="recent-thumb">
          {thumb ? <img src={thumb} alt="" /> : <span className="muted">{broken ? "No preview" : ""}</span>}
        </span>
        <span className="recent-name">{label.title}</span>
        <span className="muted recent-meta">
          {doc && <span>{doc.size.widthMm} × {doc.size.lengthMm} mm ·</span>}
          <span>{timeAgo(label.modified)}</span>
        </span>
      </button>
      <button className="icon-button recent-remove" onClick={onRemove} title="Remove from this list" aria-label={`Remove ${label.title} from this list`}>
        <X size={14} />
      </button>
    </div>
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "2 hours ago", "yesterday", in the computer's language. */
function timeAgo(ms: number): string {
  const seconds = (ms - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}
