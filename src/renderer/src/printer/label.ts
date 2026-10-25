import type { LabelDoc, LabelElement } from "../editor/types";

export type LabelSize = { widthMm: number; lengthMm: number };
export type LabelPreset = LabelSize & { name: string };

export type PrinterId = "d11" | "m3";

/** What the editor needs to know about a printer to lay out labels for it. */
export type PrinterProfile = {
  id: PrinterId;
  name: string;
  /** 8 at 203 dpi, about 11.8 at 300 dpi. Label geometry is stored in these dots. */
  dotsPerMm: number;
  /**
   * "left": narrow tape printers; the canvas is landscape with the label's
   * length along x and the printhead along y. "top": the canvas has the
   * printhead along x and the label comes out along y.
   */
  direction: "left" | "top";
  printheadPixels: number;
  maxWidthMm: number;
  /** Common label rolls. Width runs across the printhead, length along the feed. */
  presets: LabelPreset[];
};

const preset = (widthMm: number, lengthMm: number): LabelPreset => ({ name: `${widthMm} × ${lengthMm} mm`, widthMm, lengthMm });

export const PRINTERS: Record<PrinterId, PrinterProfile> = {
  d11: {
    id: "d11",
    name: "D11",
    dotsPerMm: 8,
    direction: "left",
    printheadPixels: 96,
    maxWidthMm: 30,
    presets: [preset(12, 40), preset(12, 30), preset(12, 22), preset(15, 30), preset(14, 50)],
  },
  m3: {
    id: "m3",
    name: "M3",
    dotsPerMm: 300 / 25.4,
    direction: "top",
    printheadPixels: 851,
    maxWidthMm: 80,
    presets: [preset(50, 30), preset(40, 30), preset(50, 50), preset(60, 40), preset(70, 50), preset(30, 20)],
  },
};

export const DEFAULT_PRINTER: PrinterId = "d11";

/** The printer a label is laid out for; labels from before the M3 are D11 labels. */
export function profileFor(doc: Pick<LabelDoc, "printer">): PrinterProfile {
  return PRINTERS[doc.printer ?? DEFAULT_PRINTER];
}

/** The editor profile for a connected printer model, if LabelPad knows how to lay out labels for it. */
export function printerForModel(model?: string): PrinterId | undefined {
  if (model === "M3") return "m3";
  if (model && ["D11", "D11S", "D110"].includes(model)) return "d11";
  return undefined;
}

/**
 * Size of the printable canvas in dots. Across the printhead it's capped at
 * the printhead width, since wider rolls only print the middle strip.
 */
export function canvasSize(size: LabelSize, profile: PrinterProfile): { width: number; height: number; dotsPerMm: number } {
  const across = Math.max(8, Math.min(Math.round(size.widthMm * profile.dotsPerMm), profile.printheadPixels));
  const along = Math.max(8, Math.round(size.lengthMm * profile.dotsPerMm));
  return profile.direction === "left"
    ? { width: along, height: across, dotsPerMm: profile.dotsPerMm }
    : { width: across, height: along, dotsPerMm: profile.dotsPerMm };
}

/**
 * The same label laid out for another printer. It keeps its look on screen:
 * everything is rescaled to the new resolution, and when the printers feed
 * the other way round the label's width and length swap.
 */
export function convertDoc(doc: LabelDoc, to: PrinterId): LabelDoc {
  const from = profileFor(doc);
  const target = PRINTERS[to];
  if (from.id === to) return doc;
  const k = target.dotsPerMm / from.dotsPerMm;
  const size = from.direction === target.direction ? doc.size : { widthMm: doc.size.lengthMm, lengthMm: doc.size.widthMm };
  const elements = doc.elements.map((el): LabelElement => {
    const out = { ...el, x: Math.round(el.x * k), y: Math.round(el.y * k), width: Math.round(el.width * k), height: Math.round(el.height * k) };
    if ("fontSize" in out) out.fontSize = Math.round(out.fontSize * k);
    // Icon line weight is relative to the icon, so only shapes scale theirs.
    if (out.type === "shape") {
      out.strokeWidth = Math.max(1, Math.round(out.strokeWidth * k));
      out.cornerRadius = Math.round(out.cornerRadius * k);
    }
    return out;
  });
  return { ...doc, printer: to, size, elements };
}
