import { Bluetooth, Printer, X } from "lucide-react";
import type { FoundPrinter } from "../printer/usePrinter";

type Props = {
  open: boolean;
  printers: FoundPrinter[];
  /** The printer connected last time; it's listed first when found. */
  lastPrinterId?: string;
  onPick: (printer: FoundPrinter) => void;
  onClose: () => void;
};

/** Lists printers as the Bluetooth scan finds them. */
export function DevicePicker({ open, printers, lastPrinterId, onPick, onClose }: Props) {
  if (!open) return null;

  const sorted = [...printers].sort((a, b) => Number(b.id === lastPrinterId) - Number(a.id === lastPrinterId));

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <h2 id="picker-title">Connect a printer</h2>
            <p className="muted">Turn on your printer and keep it close to this computer.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>

        <div className="device-list">
          {sorted.map((d) => (
            <button key={d.id} className="device" onClick={() => onPick(d)}>
              <Printer size={18} />
              <span>
                {d.name}
                {d.id === lastPrinterId && <em className="device-tag">Last used</em>}
              </span>
              <span className="device-action">Connect</span>
            </button>
          ))}
          <div className={`scanning${printers.length ? " compact" : ""}`}>
            <span className="pulse">
              <Bluetooth size={printers.length ? 16 : 22} />
            </span>
            {printers.length ? "Still looking…" : "Searching for printers…"}
          </div>
        </div>
      </div>
    </div>
  );
}
