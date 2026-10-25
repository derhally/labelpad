import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Props = {
  /** The printer being named, or null when closed. */
  printer: { id: string; name: string } | null;
  current: string;
  /** An empty name goes back to the printer's own. */
  onSave: (name: string) => void;
  onClose: () => void;
};

/** Give a printer a name of your own, such as "Kitchen". */
export function RenamePrinterDialog({ printer, current, onSave, onClose }: Props) {
  const [name, setName] = useState(current);

  useEffect(() => {
    if (printer) setName(current);
  }, [printer, current]);

  if (!printer) return null;

  return (
    <div className="backdrop" onClick={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-labelledby="rename-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name.trim());
          onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2 id="rename-title">Rename printer</h2>
            <p className="muted">LabelPad shows this name for {printer.name}. Leave it empty to use the printer's own name.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>
        <div className="settings">
          <label className="field">
            <span>Name</span>
            <input type="text" autoFocus value={name} maxLength={40} placeholder={printer.name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
