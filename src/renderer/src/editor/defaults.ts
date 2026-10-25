import { fitFontSize } from "./render";
import { systemUses12Hour } from "./dateFormat";
import { newId, type DateTimeElement, type ElementType, type LabelDoc, type LabelElement, type TextElement } from "./types";

/**
 * A fresh element of the given type, centred on a label of the given size in
 * dots. Line weights and corners are set for 8 dots per mm and scaled from there.
 */
export function makeElement(
  type: ElementType,
  label: { width: number; height: number; dotsPerMm?: number },
  extra?: Partial<LabelElement>,
): LabelElement {
  const h = label.height;
  const k = (label.dotsPerMm ?? 8) / 8;
  const box = (width: number, height: number) => ({
    id: newId(),
    x: Math.round((label.width - width) / 2),
    y: Math.round((h - height) / 2),
    width,
    height,
    rotation: 0,
  });

  switch (type) {
    case "text": {
      const el: TextElement = {
        ...box(Math.min(label.width - 16, 200), Math.round(h * 0.6)),
        type: "text",
        text: "Label text",
        fontFamily: "Arial",
        fontSize: 32,
        autoFit: true,
        bold: true,
        italic: false,
        underline: false,
        align: "center",
        valign: "middle",
        invert: false,
      };
      el.fontSize = fitFontSize(el, el.text, el.width, el.height);
      return { ...el, ...extra } as LabelElement;
    }
    case "datetime": {
      const el: DateTimeElement = {
        ...box(Math.min(label.width - 16, 200), Math.round(h * 0.5)),
        type: "datetime",
        show: "date",
        dateFormat: "locale",
        hour12: systemUses12Hour(),
        prefix: "",
        offsetDays: 0,
        fontFamily: "Arial",
        fontSize: 24,
        autoFit: true,
        bold: false,
        italic: false,
        underline: false,
        align: "center",
        valign: "middle",
        invert: false,
      };
      return { ...el, ...extra } as LabelElement;
    }
    case "image":
      return { ...box(h - 8, h - 8), type: "image", src: "", name: "Image", mode: "dither", threshold: 128, invert: false, ...extra } as LabelElement;
    case "barcode":
      return { ...box(Math.min(label.width - 16, 180), h - 8), type: "barcode", value: "12345678", format: "CODE128", showText: true, ...extra } as LabelElement;
    case "qr":
      return { ...box(h - 8, h - 8), type: "qr", value: "https://example.com", errorCorrection: "M", ...extra } as LabelElement;
    case "icon":
      return { ...box(h - 16, h - 16), type: "icon", icon: "star", strokeWidth: 2, ...extra } as LabelElement;
    case "shape":
      return { ...box(Math.min(label.width - 8, 120), h - 8), type: "shape", shape: "rect", strokeWidth: Math.round(3 * k), filled: false, cornerRadius: Math.round(8 * k), ...extra } as LabelElement;
  }
}

/** The label a new user sees first: a bordered name tag with an icon. */
export function starterDoc(): LabelDoc {
  const size = { widthMm: 12, lengthMm: 40 };
  const label = { width: 320, height: 96 };
  return {
    version: 1,
    size,
    elements: [
      { ...makeElement("shape", label), x: 2, y: 2, width: 316, height: 92 } as LabelElement,
      { ...makeElement("icon", label, { icon: "box" } as Partial<LabelElement>), x: 14, y: 18, width: 60, height: 60 } as LabelElement,
      {
        ...makeElement("text", label, { text: "Spare cables", autoFit: true } as Partial<LabelElement>),
        x: 84,
        y: 12,
        width: 222,
        height: 72,
      } as LabelElement,
    ],
  };
}
