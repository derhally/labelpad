import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageEncoder,
  LabelType,
  NiimbotBluetoothClient,
  PageColorType,
  type HeartbeatData,
  type PrintDirection,
} from "@mmote/niimbluelib";

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing";

export type PrinterDetails = {
  deviceName?: string;
  model?: string;
  printheadPixels?: number;
  printDirection: PrintDirection;
  densityMin: number;
  densityMax: number;
  densityDefault: number;
  firmware?: string;
  battery?: number;
};

export type PrintProgress = { page: number; pagesTotal: number; percent: number };

export type PrintOptions = { density: number; copies: number };

/** Niimbot D11 values, used until a printer reports its own. */
export const D11_DEFAULTS: PrinterDetails = {
  model: "D11",
  printheadPixels: 96,
  printDirection: "left",
  densityMin: 1,
  densityMax: 3,
  densityDefault: 2,
};

/**
 * Wraps a niimbluelib Bluetooth client in React state: connection status,
 * printer details, live heartbeat (paper, lid, battery) and print progress.
 */
export function usePrinter() {
  const clientRef = useRef<NiimbotBluetoothClient | null>(null);
  const [status, setStatus] = useState<PrinterStatus>("disconnected");
  const [details, setDetails] = useState<PrinterDetails>(D11_DEFAULTS);
  const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
  const [progress, setProgress] = useState<PrintProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    clientRef.current = null;
    setStatus("disconnected");
    setHeartbeat(null);
    setProgress(null);
    setDetails(D11_DEFAULTS);
  }, []);

  useEffect(() => () => void clientRef.current?.disconnect(), []);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    await clientRef.current?.disconnect();

    const client = new NiimbotBluetoothClient();
    clientRef.current = client;

    client.on("disconnect", () => {
      if (clientRef.current === client) reset();
    });
    client.on("heartbeat", (e) => setHeartbeat(e.data));
    client.on("printprogress", (e) =>
      setProgress({ page: e.page, pagesTotal: e.pagesTotal, percent: e.pagePrintProgress }),
    );

    try {
      const info = await client.connect();
      const meta = client.getModelMetadata();
      const printerInfo = client.getPrinterInfo();
      setDetails({
        deviceName: info.deviceName,
        model: meta?.model ?? "Unknown model",
        printheadPixels: meta?.printheadPixels ?? printerInfo.printheadWidth ?? D11_DEFAULTS.printheadPixels,
        printDirection: meta?.printDirection ?? D11_DEFAULTS.printDirection,
        densityMin: meta?.densityMin ?? D11_DEFAULTS.densityMin,
        densityMax: meta?.densityMax ?? D11_DEFAULTS.densityMax,
        densityDefault: meta?.densityDefault ?? D11_DEFAULTS.densityDefault,
        firmware: printerInfo.softwareVersion,
        battery: printerInfo.batteryPercents,
      });
      setStatus("connected");
    } catch (e) {
      clientRef.current = null;
      setStatus("disconnected");
      // Closing the device picker rejects with "User cancelled…"; that's not a failure worth showing.
      if (!/cancel/i.test(errorMessage(e))) {
        setError(errorMessage(e));
      }
    }
  }, [reset]);

  const disconnect = useCallback(async () => {
    const client = clientRef.current;
    reset();
    await client?.disconnect();
  }, [reset]);

  const print = useCallback(
    async (canvas: HTMLCanvasElement, { density, copies }: PrintOptions) => {
      const client = clientRef.current;
      if (!client?.isConnected()) throw new Error("Printer is not connected");

      setError(null);
      setStatus("printing");
      setProgress({ page: 1, pagesTotal: copies, percent: 0 });

      const taskName = client.getPrintTaskType() ?? "D11_V1";
      const direction = client.getModelMetadata()?.printDirection ?? D11_DEFAULTS.printDirection;
      const encoded = ImageEncoder.encodeCanvas(canvas, PageColorType.SingleColor, direction);
      const task = client.protocol.newPrintTask(taskName, {
        totalPages: copies,
        density,
        labelType: LabelType.WithGaps,
        pageColor: PageColorType.SingleColor,
        statusPollIntervalMs: 100,
        statusTimeoutMs: 8_000,
      });

      try {
        await task.printInit();
        await task.printPage(encoded, copies);
        await task.waitForFinished();
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      } finally {
        await task.printEnd().catch(() => undefined);
        setProgress(null);
        if (clientRef.current === client) setStatus(client.isConnected() ? "connected" : "disconnected");
      }
    },
    [],
  );

  const battery = heartbeat?.batteryPercents ?? details.battery;

  return { status, details, heartbeat, battery, progress, error, setError, connect, disconnect, print };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
