import { useEffect, useRef, useState } from "react";
import { Bluetooth, ChevronDown, Loader2, Repeat, Unplug } from "lucide-react";
import type { PrinterStatus } from "../printer/usePrinter";

type Props = {
  status: PrinterStatus;
  /** Set while quick connect looks for the last printer. */
  finding: boolean;
  lastPrinter?: { id: string; name: string };
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitch: () => void;
};

/** "M3-I724060085" → "M3". */
export function shortName(name: string): string {
  return name.split("-")[0] || name;
}

/**
 * Connect (to the last printer, or pick one if there's none yet) or
 * disconnect, with "Switch printer" in a menu beside it.
 */
export function ConnectButton({ status, finding, lastPrinter, onConnect, onDisconnect, onSwitch }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const connected = status === "connected" || status === "printing";
  const busy = finding || status === "connecting";

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenuOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const kind = connected ? "ghost" : "primary";
  return (
    <div className="split-button" ref={ref}>
      {connected ? (
        <button className={`button ${kind}`} onClick={onDisconnect} disabled={status === "printing"}>
          <Unplug size={16} /> Disconnect
        </button>
      ) : (
        <button
          className={`button ${kind}`}
          onClick={onConnect}
          disabled={busy}
          title={lastPrinter ? `Connect to ${lastPrinter.name}` : "Choose a printer to connect to"}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Bluetooth size={16} />}
          {finding ? `Looking for ${shortName(lastPrinter?.name ?? "")}…` : lastPrinter ? `Connect ${shortName(lastPrinter.name)}` : "Connect printer"}
        </button>
      )}
      <button
        className={`button ${kind} split-toggle`}
        onClick={() => setMenuOpen((o) => !o)}
        disabled={status === "printing"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More connection options"
      >
        <ChevronDown size={16} />
      </button>
      {menuOpen && (
        <div className="menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onSwitch();
            }}
          >
            <Repeat size={15} /> Switch printer…
          </button>
        </div>
      )}
    </div>
  );
}
