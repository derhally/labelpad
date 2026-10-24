import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  defaultName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
};

/** Ask for a name, then save the current label as a template. */
export function SaveTemplateDialog({ open, defaultName, onSave, onClose }: Props) {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
    }
  }, [open, defaultName]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="dialog" role="dialog" aria-labelledby="template-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="dialog-header">
          <div>
            <h2 id="template-title">Save as template</h2>
            <p className="muted">It will appear when you start a new label. A template with the same name is replaced.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>
        <div className="settings">
          <label className="field">
            <span>Name</span>
            <input type="text" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <div className="notice error"><span>{error}</span></div>}
          <div className="dialog-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={!name.trim() || saving}>
              Save template
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
