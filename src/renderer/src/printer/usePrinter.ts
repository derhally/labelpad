import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing";

/** Mirrors `printer::PrinterInfo` from the Rust side. */
type RustPrinterInfo = {
  modelId?: number;
  model?: {
    model: string;
    printDirection: "left" | "top";
    printheadPixels: number;
    densityMin: number;
    densityMax: number;
    densityDefault: number;
  };
  protocolVersion: number;
  batteryPercents?: number;
  softwareVersion?: string;
  printheadWidth?: number;
  printTask?: string;
  rfid?: RollInfo;
};

/** The label roll's RFID tag. Mirrors `printer::RfidInfo`. */
export type RollInfo = {
  tagPresent: boolean;
  uuid: string;
  barcode: string;
  serialNumber: string;
  allPaper: number;
  usedPaper: number;
  consumablesType: number;
};

export type HeartbeatData = {
  lidClosed?: boolean;
  batteryPercents?: number;
  paperInserted?: boolean;
};

type PrinterEvent =
  | { type: "heartbeat"; data: HeartbeatData }
  | { type: "printProgress"; page: number; pagesTotal: number; percent: number; sending: boolean }
  | { type: "rfid"; info: RollInfo }
  | { type: "disconnected" };

export type FoundPrinter = { id: string; name: string; rssi?: number };

export type PrinterDetails = {
  deviceName?: string;
  model?: string;
  printheadPixels?: number;
  densityMin: number;
  densityMax: number;
  densityDefault: number;
  firmware?: string;
  battery?: number;
};

export type PrintProgress = { page: number; pagesTotal: number; percent: number; sending: boolean };

export type PrintOptions = { density: number; copies: number };

/** Niimbot D11 values, used until a printer reports its own. */
export const D11_DEFAULTS: PrinterDetails = {
  model: "D11",
  printheadPixels: 96,
  densityMin: 1,
  densityMax: 3,
  densityDefault: 2,
};

/**
 * Printer state for the UI. Bluetooth and the Niimbot protocol live in Rust
 * (src-tauri/printer); this hook calls its commands and listens for its events.
 */
export function usePrinter() {
  const [status, setStatus] = useState<PrinterStatus>("disconnected");
  const [details, setDetails] = useState<PrinterDetails>(D11_DEFAULTS);
  const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
  const [progress, setProgress] = useState<PrintProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundPrinter[]>([]);
  const [roll, setRoll] = useState<RollInfo | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const reset = useCallback(() => {
    setStatus("disconnected");
    setHeartbeat(null);
    setProgress(null);
    setDetails(D11_DEFAULTS);
    setRoll(null);
  }, []);

  useEffect(() => {
    const unlisten = [
      listen<FoundPrinter[]>("printers-found", (e) => setFound(e.payload)),
      listen<PrinterEvent>("printer-event", (e) => {
        const ev = e.payload;
        if (ev.type === "heartbeat") setHeartbeat(ev.data);
        else if (ev.type === "printProgress") setProgress(ev);
        else if (ev.type === "rfid") setRoll(ev.info.tagPresent ? ev.info : null);
        else if (ev.type === "disconnected") {
          if (statusRef.current !== "disconnected") setError("The printer disconnected.");
          reset();
        }
      }),
    ];
    return () => unlisten.forEach((p) => p.then((off) => off()));
  }, [reset]);

  /** Start scanning; the device picker shows `found` as printers appear. */
  const startScan = useCallback(async () => {
    setError(null);
    setFound([]);
    try {
      await invoke("scan_start");
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, []);

  const stopScan = useCallback(() => invoke("scan_stop").catch(() => undefined), []);

  /** Connect and read the printer's details; throws with the reason if it fails. */
  const connectTo = useCallback(
    async (printer: FoundPrinter) => {
      setError(null);
      setStatus("connecting");
      try {
        const info = await invoke<RustPrinterInfo>("printer_connect", { id: printer.id });
        const m = info.model;
        setDetails({
          deviceName: printer.name,
          model: m?.model ?? "Unknown model",
          printheadPixels: m?.printheadPixels ?? info.printheadWidth ?? D11_DEFAULTS.printheadPixels,
          densityMin: m?.densityMin ?? D11_DEFAULTS.densityMin,
          densityMax: m?.densityMax ?? D11_DEFAULTS.densityMax,
          densityDefault: m?.densityDefault ?? D11_DEFAULTS.densityDefault,
          firmware: info.softwareVersion,
          battery: info.batteryPercents,
        });
        setRoll(info.rfid?.tagPresent ? info.rfid : null);
        setStatus("connected");
      } catch (e) {
        reset();
        setError(String(e));
        throw e;
      }
    },
    [reset],
  );

  const connect = useCallback((printer: FoundPrinter) => connectTo(printer).then(() => true, () => false), [connectTo]);

  const disconnect = useCallback(async () => {
    reset();
    await invoke("printer_disconnect").catch(() => undefined);
  }, [reset]);

  /** Print `copies` of each canvas; numbered labels pass one canvas per number. */
  const print = useCallback(async (canvases: HTMLCanvasElement[], { density, copies }: PrintOptions) => {
    setError(null);
    setStatus("printing");
    setProgress({ page: 1, pagesTotal: copies * canvases.length, percent: 0, sending: true });
    try {
      const { width, height } = canvases[0];
      await invoke("printer_print", { width, height, pages: canvases.map(packBits), density, copies });
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setProgress(null);
      setStatus((s) => (s === "printing" ? "connected" : s));
    }
  }, []);

  const battery = heartbeat?.batteryPercents ?? details.battery;

  return { status, details, heartbeat, battery, roll, progress, error, setError, found, startScan, stopScan, connect, connectTo, disconnect, print };
}

/** The canvas as 1 bit per pixel, MSB first, row-major; 1 = black (printed). */
function packBits(canvas: HTMLCanvasElement): number[] {
  const { width, height } = canvas;
  const px = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  const out = new Array<number>(Math.ceil((width * height) / 8)).fill(0);
  for (let i = 0; i < width * height; i++) {
    // The editor already snapped the canvas to pure black and white.
    if (px[i * 4] < 128) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}
