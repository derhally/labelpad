import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { renderLabel } from "../editor/render";
import { builtInTemplates, deleteTemplate, userTemplates, type Template } from "../editor/templates";
import type { LabelDoc } from "../editor/types";
import { canvasSize } from "../printer/label";

type Props = {
  open: boolean;
  blank: LabelDoc;
  onPick: (doc: LabelDoc) => void;
  onClose: () => void;
};

/** Start a new label: blank, from a built-in template, or from one you saved. */
export function TemplateGallery({ open, blank, onPick, onClose }: Props) {
  const [mine, setMine] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [builtIn] = useState(builtInTemplates);

  useEffect(() => {
    if (!open) return;
    setError(null);
    userTemplates()
      .then(setMine)
      .catch((e) => setError(String(e)));
  }, [open]);

  if (!open) return null;

  const remove = async (t: Template) => {
    if (!(await ask(`Delete the template "${t.name}"?`, { title: "Delete template", kind: "warning", okLabel: "Delete" }))) return;
    try {
      await deleteTemplate(t.id);
      setMine((m) => m.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-labelledby="gallery-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <h2 id="gallery-title">New label</h2>
            <p className="muted">Start blank or from a template.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="gallery-scroll">
          <div className="template-grid">
            <button className="template-card" onClick={() => onPick(blank)}>
              <span className="template-thumb blank">
                <Plus size={22} />
              </span>
              <span className="template-name">Blank</span>
              <span className="muted template-size">
                {blank.size.widthMm} × {blank.size.lengthMm} mm
              </span>
            </button>
            {builtIn.map((t) => (
              <TemplateCard key={t.id} template={t} onPick={onPick} />
            ))}
          </div>

          <span className="section-label gallery-heading">My templates</span>
          {error && <div className="notice error"><span>{error}</span></div>}
          {mine.length ? (
            <div className="template-grid">
              {mine.map((t) => (
                <TemplateCard key={t.id} template={t} onPick={onPick} onDelete={() => void remove(t)} />
              ))}
            </div>
          ) : (
            <p className="muted hint">Templates you save with “Save as template” appear here.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({ template, onPick, onDelete }: { template: Template; onPick: (doc: LabelDoc) => void; onDelete?: () => void }) {
  const thumb = useThumbnail(template.doc);
  const { size } = template.doc;
  return (
    <div className="template-card-wrap">
      <button className="template-card" onClick={() => onPick(template.doc)}>
        <span className="template-thumb">{thumb && <img src={thumb} alt="" />}</span>
        <span className="template-name">{template.name}</span>
        <span className="muted template-size">
          {size.widthMm} × {size.lengthMm} mm
        </span>
      </button>
      {onDelete && (
        <button className="icon-button danger template-delete" onClick={onDelete} title="Delete template">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/** The label rendered as it would print, for the card preview. */
function useThumbnail(doc: LabelDoc): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const { width, height } = canvasSize(doc.size, 96);
    const canvas = document.createElement("canvas");
    renderLabel(canvas, width, height, doc.elements).then(() => live && setUrl(canvas.toDataURL()));
    return () => {
      live = false;
    };
  }, [doc]);
  return url;
}
