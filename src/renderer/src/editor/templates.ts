import { invoke } from "@tauri-apps/api/core";
import { makeElement, starterDoc } from "./defaults";
import { parseLabel, serializeLabel } from "./labelFile";
import { newId, type ElementType, type LabelDoc, type LabelElement } from "./types";

export type Template = { id: string; name: string; doc: LabelDoc; builtIn: boolean };

/** An element placed at an exact box on a label of `label` dots. */
function at(type: ElementType, label: { width: number; height: number }, box: [number, number, number, number], extra?: Record<string, unknown>): LabelElement {
  const [x, y, width, height] = box;
  return { ...makeElement(type, label, extra as Partial<LabelElement>), x, y, width, height };
}

/** Templates that come with the app. Built lazily because text sizing needs a canvas. */
export function builtInTemplates(): Template[] {
  const l40 = { width: 320, height: 96 };
  const l30 = { width: 240, height: 96 };
  const doc = (size: LabelDoc["size"], elements: LabelElement[]): LabelDoc => ({ version: 1, size, elements });
  return [
    { id: "name-tag", name: "Storage box", builtIn: true, doc: starterDoc() },
    {
      id: "food",
      name: "Food container",
      builtIn: true,
      doc: doc({ widthMm: 12, lengthMm: 40 }, [
        at("text", l40, [8, 4, 304, 44], { text: "Leftovers", bold: true }),
        at("datetime", l40, [8, 50, 148, 40], { prefix: "Made ", dateFormat: "D MMM" }),
        at("datetime", l40, [164, 50, 148, 40], { prefix: "Use by ", dateFormat: "D MMM", offsetDays: 3, bold: true }),
      ]),
    },
    {
      id: "asset",
      name: "Asset tag",
      builtIn: true,
      doc: doc({ widthMm: 12, lengthMm: 40 }, [
        at("qr", l40, [6, 6, 84, 84], { value: "https://example.com/asset/0001" }),
        at("text", l40, [100, 8, 212, 40], { text: "Property of", bold: false, align: "left" }),
        at("text", l40, [100, 48, 212, 40], { text: "#0001", align: "left" }),
      ]),
    },
    {
      id: "barcode",
      name: "Product barcode",
      builtIn: true,
      doc: doc({ widthMm: 12, lengthMm: 40 }, [
        at("text", l40, [8, 2, 304, 28], { text: "Product name", bold: true }),
        at("barcode", l40, [8, 32, 304, 62], { value: "12345678" }),
      ]),
    },
    {
      id: "cable",
      name: "Cable flag",
      builtIn: true,
      doc: doc({ widthMm: 12, lengthMm: 30 }, [at("text", l30, [4, 8, 232, 80], { text: "ROUTER", invert: true })]),
    },
    {
      id: "timestamp",
      name: "Date and time",
      builtIn: true,
      doc: doc({ widthMm: 12, lengthMm: 40 }, [
        at("icon", l40, [10, 20, 56, 56], { icon: "calendar" }),
        at("datetime", l40, [76, 8, 236, 80], { show: "datetime", dateFormat: "ddd D MMM YYYY", align: "left" }),
      ]),
    },
  ];
}

/** Templates you saved, from the app's data folder. */
export async function userTemplates(): Promise<Template[]> {
  const saved = await invoke<{ id: string; contents: string }[]>("templates_list");
  return saved.flatMap((t) => {
    try {
      return [{ id: t.id, name: t.id, doc: parseLabel(t.contents), builtIn: false }];
    } catch {
      return [];
    }
  });
}

export function saveTemplate(name: string, doc: LabelDoc): Promise<string> {
  return invoke<string>("template_save", { name, contents: serializeLabel(doc) });
}

export function deleteTemplate(id: string): Promise<void> {
  return invoke("template_delete", { id });
}

/** A copy of a template's label to edit, with fresh element ids. */
export function fromTemplate(doc: LabelDoc): LabelDoc {
  return { ...doc, elements: doc.elements.map((e) => ({ ...e, id: newId() })) };
}
