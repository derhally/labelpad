import { qrTexts } from "./qr";
import type { LabelDoc, LabelElement } from "./types";

/**
 * Placeholders in text, barcodes and QR codes:
 *   {count}    the label's number in a numbered run (1, 2, 3…)
 *   {count:3}  the same, padded to 3 digits (001, 002…)
 */
const COUNT = /\{count(?::(\d{1,2}))?\}/g;

export type Variables = { count: number };

export function substitute(text: string, vars: Variables): string {
  return text.replace(COUNT, (_, width?: string) => {
    const n = String(Math.abs(vars.count)).padStart(width ? Number(width) : 0, "0");
    return vars.count < 0 ? `-${n}` : n;
  });
}

function usesCounter(el: LabelElement): boolean {
  const texts = el.type === "text" ? [el.text] : el.type === "datetime" ? [el.prefix] : el.type === "barcode" ? [el.value] : el.type === "qr" ? qrTexts(el) : [];
  return texts.some((t) => t.match(COUNT) !== null);
}

/** Whether any element on the label uses {count}. */
export function hasCounter(doc: Pick<LabelDoc, "elements">): boolean {
  return doc.elements.some(usesCounter);
}

export const DEFAULT_COUNTER = { start: 1, step: 1 };
