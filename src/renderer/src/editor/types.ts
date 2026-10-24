/**
 * A label document. All geometry is in printer dots (8 per mm on the D11),
 * measured on the landscape canvas: x runs along the label, y across it.
 */
export type LabelDoc = {
  version: 1;
  size: { widthMm: number; lengthMm: number };
  elements: LabelElement[];
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

export type TextElement = ElementBase & {
  type: "text";
  text: string;
  fontFamily: string;
  /** In dots. Ignored while autoFit is on. */
  fontSize: number;
  autoFit: boolean;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** White text on a black box. */
  invert: boolean;
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

export type LabelElement = TextElement | ImageElement | BarcodeElement | QrElement | IconElement | ShapeElement;
export type ElementType = LabelElement["type"];

/** Elements whose content would distort if stretched. */
export function keepsAspect(el: LabelElement): boolean {
  return el.type === "qr" || el.type === "icon" || el.type === "image";
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
