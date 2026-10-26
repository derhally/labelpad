import { describe, expect, it, vi } from "vitest";
import { makeElement } from "./defaults";
import { parseLabel, serializeLabel } from "./labelFile";
import type { ElementType, LabelDoc } from "./types";

// Text sizing measures with a canvas, which tests don't have; it doesn't affect what is saved.
vi.mock("./render", () => ({ fitFontSize: (el: { fontSize: number }) => el.fontSize }));

const ALL_TYPES: ElementType[] = ["text", "datetime", "image", "barcode", "qr", "icon", "shape"];
const dots = { width: 320, height: 96 };

function label(elements: LabelDoc["elements"]): LabelDoc {
  return { version: 1, printer: "d11", size: { widthMm: 12, lengthMm: 40 }, elements };
}

describe("label files", () => {
  it("keep every element type when saved and opened again", () => {
    const doc = label(ALL_TYPES.map((type) => makeElement(type, dots)));
    const reopened = parseLabel(serializeLabel(doc));
    expect(reopened.elements.map((el) => el.type)).toEqual(ALL_TYPES);
    expect(reopened).toEqual(doc);
  });

  it("keep a date element's settings", () => {
    const date = makeElement("datetime", dots, { show: "datetime", dateFormat: "DD/MM/YYYY", prefix: "Packed ", offsetDays: 3 });
    expect(parseLabel(serializeLabel(label([date]))).elements).toEqual([date]);
  });
});
