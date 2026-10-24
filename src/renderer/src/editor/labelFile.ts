import { makeElement } from "./defaults";
import { newId, type ElementType, type LabelDoc, type LabelElement } from "./types";

/** Label files are JSON with this marker, so other JSON files are refused clearly. */
const FORMAT = "niimbot-studio-label";
export const FILE_EXTENSION = "niimbot";
export const FILE_FILTERS = [{ name: "Niimbot label", extensions: [FILE_EXTENSION] }];

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
    throw new Error("This file isn't a Niimbot Studio label.");
  }
  if (!isObject(data) || data.format !== FORMAT) throw new Error("This file isn't a Niimbot Studio label.");
  if (typeof data.version !== "number" || data.version > 1) throw new Error("This label was saved by a newer version of Niimbot Studio.");

  const size = isObject(data.size) ? data.size : {};
  const widthMm = positive(size.widthMm, 12);
  const lengthMm = positive(size.lengthMm, 40);
  const dots = { width: lengthMm * 8, height: Math.min(widthMm * 8, 96) };

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

  return { version: 1, size: { widthMm, lengthMm }, elements, ...(counter && { counter }) };
}

/** "C:\labels\Shelf.niimbot" → "Shelf". */
export function fileTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(new RegExp(`\\.${FILE_EXTENSION}$`, "i"), "");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positive(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}
