import { Battery, BatteryLow, BatteryMedium, BatteryFull, Loader2 } from "lucide-react";
import type { PrinterStatus } from "../printer/usePrinter";

type Props = { status: PrinterStatus; name?: string; battery?: number };

const LABELS: Record<PrinterStatus, string> = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  connected: "Ready",
  printing: "Printing…",
};

export function PrinterBadge({ status, name, battery }: Props) {
  const busy = status === "connecting" || status === "printing";
  return (
    <div className={`badge badge-${status}`}>
      {busy ? <Loader2 size={14} className="spin" /> : <span className="dot" />}
      <span>{status === "connected" && name ? name : LABELS[status]}</span>
      {battery !== undefined && status !== "disconnected" && <BatteryIcon percent={battery} />}
    </div>
  );
}

function BatteryIcon({ percent }: { percent: number }) {
  const Icon = percent >= 75 ? BatteryFull : percent >= 40 ? BatteryMedium : percent > 10 ? BatteryLow : Battery;
  return (
    <span className="battery" title={`Battery ${percent}%`}>
      <Icon size={16} />
      {percent}%
    </span>
  );
}
