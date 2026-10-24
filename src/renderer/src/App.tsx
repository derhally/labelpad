import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bluetooth, Minus, Plus, Printer, Unplug, X } from "lucide-react";
import { DevicePicker } from "./components/DevicePicker";
import { PrinterBadge } from "./components/PrinterBadge";
import { canvasSize, drawTestLabel, LABEL_SIZES } from "./printer/label";
import { usePrinter } from "./printer/usePrinter";

const PREVIEW_ZOOM = 4;

export function App() {
  const printer = usePrinter();
  const { status, details, heartbeat } = printer;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sizeId, setSizeId] = useState(LABEL_SIZES[0].id);
  const [text, setText] = useState("Hello from\nNiimbot Studio");
  const [border, setBorder] = useState(true);
  const [density, setDensity] = useState(details.densityDefault);
  const [copies, setCopies] = useState(1);

  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0];
  const dots = useMemo(() => canvasSize(size, details.printheadPixels ?? 96), [size, details.printheadPixels]);

  useEffect(() => {
    setDensity((d) => Math.min(Math.max(d, details.densityMin), details.densityMax));
  }, [details.densityMin, details.densityMax]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dots.width;
    canvas.height = dots.height;
    drawTestLabel(canvas, { text, border });
  }, [dots, text, border]);

  const connect = () => {
    setPickerOpen(true);
    printer.connect().finally(() => setPickerOpen(false));
  };

  const print = () => {
    if (canvasRef.current) printer.print(canvasRef.current, { density, copies }).catch(() => undefined);
  };

  const connected = status === "connected" || status === "printing";
  const warning = heartbeat?.lidClosed === false ? "The lid is open." : heartbeat?.paperInserted === false ? "No labels loaded." : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <Printer size={18} />
          </span>
          Niimbot Studio
        </div>
        <div className="topbar-actions">
          <PrinterBadge status={status} name={details.deviceName ?? details.model} battery={printer.battery} />
          {connected ? (
            <button className="button ghost" onClick={printer.disconnect} disabled={status === "printing"}>
              <Unplug size={16} /> Disconnect
            </button>
          ) : (
            <button className="button primary" onClick={connect} disabled={status === "connecting"}>
              <Bluetooth size={16} /> Connect printer
            </button>
          )}
        </div>
      </header>

      <main className="workspace">
        <section className="stage">
          <div className="label-frame" style={{ width: `min(100%, ${dots.width * PREVIEW_ZOOM}px)` }}>
            <canvas ref={canvasRef} className="label-canvas" style={{ aspectRatio: `${dots.width} / ${dots.height}` }} />
          </div>
          <p className="muted stage-caption">
            {size.name} · {dots.width} × {dots.height} dots · preview shows exactly what prints
          </p>
        </section>

        <aside className="panel">
          <h1>Test label</h1>
          <p className="muted">Print a quick label to check that your D11 is connected and feeding correctly.</p>

          <label className="field">
            <span>Text</span>
            <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} />
          </label>

          <label className="field">
            <span>Label size</span>
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
              {LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="toggle">
            <input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} />
            <span>Rounded border</span>
          </label>

          <div className="field">
            <span>Darkness</span>
            <div className="segmented" role="radiogroup">
              {range(details.densityMin, details.densityMax).map((d) => (
                <button key={d} role="radio" aria-checked={density === d} className={density === d ? "active" : ""} onClick={() => setDensity(d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Copies</span>
            <div className="stepper">
              <button className="icon-button" onClick={() => setCopies((c) => Math.max(1, c - 1))} aria-label="Fewer copies">
                <Minus size={16} />
              </button>
              <span>{copies}</span>
              <button className="icon-button" onClick={() => setCopies((c) => Math.min(99, c + 1))} aria-label="More copies">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="panel-spacer" />

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
            <button className="button primary large" onClick={connected ? print : connect} disabled={status === "connecting"}>
              <Printer size={18} /> {connected ? `Print ${copies > 1 ? `${copies} labels` : "label"}` : "Connect to print"}
            </button>
          )}

          {connected && details.firmware && (
            <p className="muted small">
              {details.model} · firmware {details.firmware}
            </p>
          )}
        </aside>
      </main>

      <DevicePicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
