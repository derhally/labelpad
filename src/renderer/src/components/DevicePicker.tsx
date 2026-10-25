import { useEffect, useRef } from "react";
import { Bluetooth, Loader2, Printer, X } from "lucide-react";
import type { FoundPrinter } from "../printer/usePrinter";

type Props = {
  open: boolean;
  printers: FoundPrinter[];
  /** The printer connected last time; it stays pinned at the top, found or not. */
  lastPrinter?: { id: string; name: string };
  /** Names you've given printers. */
  names: Record<string, string>;
  onPick: (printer: FoundPrinter) => void;
  onClose: () => void;
};

/**
 * Lists printers as the Bluetooth scan finds them. Rows keep the order they
 * appeared in and the list has a fixed height, so nothing moves under the pointer.
 */
export function DevicePicker({ open, printers, lastPrinter, names, onPick, onClose }: Props) {
  const order = useRef<string[]>([]);
  useEffect(() => {
    if (!open) order.current = [];
  }, [open]);

  if (!open) return null;

  for (const p of printers) if (!order.current.includes(p.id)) order.current.push(p.id);
  const others = order.current.filter((id) => id !== lastPrinter?.id).flatMap((id) => printers.filter((p) => p.id === id));
  const last = lastPrinter && (printers.find((p) => p.id === lastPrinter.id) ?? null);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog picker" role="dialog" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <h2 id="picker-title">Connect a printer</h2>
            <p className="muted">Turn on your printer and keep it close to this computer.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>

        {lastPrinter && (
          <button className="device pinned" disabled={!last} onClick={() => last && onPick(last)}>
            <Printer size={18} />
            <span>
              <DeviceName id={lastPrinter.id} name={last?.name ?? lastPrinter.name} names={names} />
              <em className="device-tag">Last used</em>
            </span>
            {last ? (
              <span className="device-action">Connect</span>
            ) : (
              <span className="device-waiting">
                <Loader2 size={14} className="spin" /> Looking…
              </span>
            )}
          </button>
        )}

        <div className="device-list">
          {others.map((d) => (
            <button key={d.id} className="device" onClick={() => onPick(d)}>
              <Printer size={18} />
              <span>
                <DeviceName id={d.id} name={d.name} names={names} />
              </span>
              <span className="device-action">Connect</span>
            </button>
          ))}
          <div className={`scanning${others.length ? " compact" : ""}`}>
            <span className="pulse">
              <Bluetooth size={others.length ? 16 : 22} />
            </span>
            {others.length ? "Still looking…" : lastPrinter ? "Looking for other printers…" : "Searching for printers…"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Your name for a printer, with its own name beside it. */
function DeviceName({ id, name, names }: { id: string; name: string; names: Record<string, string> }) {
  return names[id] ? (
    <>
      {names[id]} <small className="muted device-model">{name}</small>
    </>
  ) : (
    <>{name}</>
  );
}
