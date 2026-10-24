import { AlertTriangle, Minus, Plus, Printer, X } from "lucide-react";
import type { usePrinter } from "../printer/usePrinter";
import { Segmented } from "./fields";

type Props = {
  printer: ReturnType<typeof usePrinter>;
  density: number;
  copies: number;
  onDensity: (d: number) => void;
  onCopies: (c: number) => void;
  onPrint: () => void;
  onConnect: () => void;
};

export function PrintPanel({ printer, density, copies, onDensity, onCopies, onPrint, onConnect }: Props) {
  const { status, details, heartbeat } = printer;
  const connected = status === "connected" || status === "printing";
  const warning = heartbeat?.lidClosed === false ? "The lid is open." : heartbeat?.paperInserted === false ? "No labels loaded." : null;
  const densities = Array.from({ length: details.densityMax - details.densityMin + 1 }, (_, i) => details.densityMin + i);

  return (
    <div className="print-panel">
      <div className="print-options">
        <div className="field">
          <span>Darkness</span>
          <Segmented value={density} onChange={onDensity} options={densities.map((d) => ({ value: d, label: String(d) }))} />
        </div>
        <div className="field">
          <span>Copies</span>
          <div className="stepper">
            <button className="icon-button" onClick={() => onCopies(Math.max(1, copies - 1))} aria-label="Fewer copies">
              <Minus size={16} />
            </button>
            <span>{copies}</span>
            <button className="icon-button" onClick={() => onCopies(Math.min(99, copies + 1))} aria-label="More copies">
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>

      {warning && connected && (
        <div className="notice warn">
          <AlertTriangle size={16} /> {warning}
        </div>
      )}
      {printer.error && (
        <div className="notice error">
          <AlertTriangle size={16} />
          <span>{printer.error}</span>
          <button className="icon-button" onClick={() => printer.setError(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {status === "printing" && printer.progress ? (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${printer.progress.percent}%` }} />
          <span>
            Printing {printer.progress.page} of {printer.progress.pagesTotal}…
          </span>
        </div>
      ) : (
        <button className="button primary large" onClick={connected ? onPrint : onConnect} disabled={status === "connecting"}>
          <Printer size={18} /> {connected ? `Print ${copies > 1 ? `${copies} labels` : "label"}` : "Connect to print"}
          {connected && <kbd>Ctrl P</kbd>}
        </button>
      )}
    </div>
  );
}
