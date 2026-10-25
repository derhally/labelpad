import { makeElement } from "./defaults";
import { canvasSize, PRINTERS, type PrinterId } from "../printer/label";
import { newId, type ElementType, type LabelDoc, type LabelElement } from "./types";

/** Label files are JSON with this marker, so other JSON files are refused clearly. */
const FORMAT = "labelpad-label";
/** Marker and extension from before the app was renamed; such files still open. */
const OLD_FORMAT = "niimbot-studio-label";
export const FILE_EXTENSION = "labelpad";
export const FILE_FILTERS = [{ name: "LabelPad label", extensions: [FILE_EXTENSION, "niimbot"] }];

const TYPES: ElementType[] = ["text", "image", "barcode", "qr", "icon", "shape"];

export function serializeLabel(doc: LabelDoc): string {
  return JSON.stringify({ format: FORMAT, ...doc }, null, 2);
}

/**
 * Read a label file. Elements of unknown types are dropped, and any missing
 * fields take their defaults, so files from older or newer versions still open.
 */
export function parseLabel(text: string): LabelDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a LabelPad label.");
  }
  if (!isObject(data) || (data.format !== FORMAT && data.format !== OLD_FORMAT)) throw new Error("This file isn't a LabelPad label.");
  if (typeof data.version !== "number" || data.version > 1) throw new Error("This label was saved by a newer version of LabelPad.");

  const size = isObject(data.size) ? data.size : {};
  const widthMm = positive(size.widthMm, 12);
  const lengthMm = positive(size.lengthMm, 40);
  const printer = typeof data.printer === "string" && data.printer in PRINTERS ? (data.printer as PrinterId) : undefined;
  const dots = canvasSize({ widthMm, lengthMm }, PRINTERS[printer ?? "d11"]);

  const elements = (Array.isArray(data.elements) ? data.elements : []).flatMap((raw): LabelElement[] => {
    if (!isObject(raw) || !TYPES.includes(raw.type as ElementType)) return [];
    const base = makeElement(raw.type as ElementType, dots);
    const el = { ...base } as Record<string, unknown>;
    // Keep only known fields whose type matches the default.
    for (const [key, value] of Object.entries(raw)) {
      if (key in base && typeof value === typeof el[key]) el[key] = value;
    }
    return [{ ...el, id: typeof raw.id === "string" && raw.id ? raw.id : newId() } as LabelElement];
  });

  const c = isObject(data.counter) ? data.counter : null;
  const counter =
    c && Number.isInteger(c.start) && Number.isInteger(c.step) ? { start: c.start as number, step: c.step as number } : undefined;

  return { version: 1, ...(printer && { printer }), size: { widthMm, lengthMm }, elements, ...(counter && { counter }) };
}

/** "C:\labels\Shelf.labelpad" → "Shelf". */
export function fileTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.(labelpad|niimbot)$/i, "");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positive(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}
