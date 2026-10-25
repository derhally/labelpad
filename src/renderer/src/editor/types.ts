import type { PrinterId } from "../printer/label";

/**
 * A label document. All geometry is in its printer's dots (8 per mm on the
 * D11, about 11.8 on the M3), measured on the canvas `canvasSize` gives.
 */
export type LabelDoc = {
  version: 1;
  /** The printer it's laid out for. Missing in labels from before the M3, which are D11 labels. */
  printer?: PrinterId;
  size: { widthMm: number; lengthMm: number };
  elements: LabelElement[];
  /** Numbering for {count}: the next label's number and how much it goes up by. */
  counter?: { start: number; step: number };
};

export type ElementBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the element's centre. */
  rotation: number;
};

export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

/** Font and layout shared by text and date/time elements. */
export type TextStyle = {
  fontFamily: string;
  /** In dots. Ignored while autoFit is on. */
  fontSize: number;
  autoFit: boolean;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  valign: VerticalAlign;
  /** White text on a black box. */
  invert: boolean;
};

export type TextElement = ElementBase &
  TextStyle & {
    type: "text";
    text: string;
  };

/** The date (and optionally time) when the label is printed. */
export type DateTimeElement = ElementBase &
  TextStyle & {
    type: "datetime";
    show: "datetime" | "date" | "time";
    /** Token pattern such as "DD/MM/YYYY" (see dateFormat.ts), or "locale" for the system format. */
    dateFormat: string;
    hour12: boolean;
    /** Text before the date, such as "Packed ". */
    prefix: string;
    /** Days added to the print date, for use-by labels. */
    offsetDays: number;
  };

export type ImageElement = ElementBase & {
  type: "image";
  src: string;
  name: string;
  /** Dither keeps shading in photos; threshold gives clean edges for logos. */
  mode: "dither" | "threshold";
  /** 0–255: pixels darker than this print. */
  threshold: number;
  invert: boolean;
};

export const BARCODE_FORMATS = ["CODE128", "CODE39", "EAN13", "EAN8", "UPC", "ITF14"] as const;
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

export type BarcodeElement = ElementBase & {
  type: "barcode";
  value: string;
  format: BarcodeFormat;
  showText: boolean;
};

export type QrElement = ElementBase & {
  type: "qr";
  value: string;
  errorCorrection: "L" | "M" | "Q" | "H";
};

export type IconElement = ElementBase & {
  type: "icon";
  icon: string;
  strokeWidth: number;
};

export type ShapeElement = ElementBase & {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  strokeWidth: number;
  filled: boolean;
  cornerRadius: number;
};

export type LabelElement = TextElement | DateTimeElement | ImageElement | BarcodeElement | QrElement | IconElement | ShapeElement;
export type ElementType = LabelElement["type"];

/** Elements whose content would distort if stretched. */
export function keepsAspect(el: LabelElement): boolean {
  return el.type === "qr" || el.type === "icon" || el.type === "image";
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
