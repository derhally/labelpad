import { invoke } from "@tauri-apps/api/core";
import type { EditorHandle, TabMeta } from "../components/LabelEditor";
import { align, bounds, type AlignEdge, type Box } from "../editor/arrange";
import { makeElement } from "../editor/defaults";
import { ICON_IDS } from "../editor/icons";
import { importImage } from "../editor/importImage";
import { renderLabel } from "../editor/render";
import { builtInTemplates, fromTemplate, userTemplates } from "../editor/templates";
import { BARCODE_FORMATS, keepsAspect, type ElementType, type LabelDoc, type LabelElement } from "../editor/types";
import { DEFAULT_COUNTER } from "../editor/variables";
import { canvasSize, convertDoc, printerForModel, PRINTERS, profileFor, type PrinterId } from "../printer/label";
import type { usePrinter } from "../printer/usePrinter";
import type { Settings } from "../settings/useSettings";

/** What the tools can reach in the app. Read through a getter, so it's never stale after an await. */
export type McpHost = {
  printer: ReturnType<typeof usePrinter>;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  tabs: (TabMeta & { id: string; active: boolean })[];
  activeId: string;
  handle: (tabId: string) => EditorHandle | undefined;
  /** Open a label in a new tab and make it active. Returns the tab's id. */
  newTab: (doc: LabelDoc) => string;
  openFile: (path: string) => Promise<string>;
  selectTab: (tabId: string) => void;
  /** Close a tab without asking about unsaved changes. */
  closeTab: (tabId: string) => void;
};

type Host = () => McpHost;
type Args = Record<string, unknown>;

export type ToolResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
};

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Args, host: Host) => Promise<ToolResult>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number) => Math.round(n * 100) / 100;
const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** Wait until `get` returns something, as the UI catches up with a change. */
async function until<T>(get: () => T | undefined, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(what);
    await sleep(50);
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// ---- Labels and elements --------------------------------------------------

/** The tab a tool works on: the one named, or the active one. */
function target(host: Host, args: Args) {
  const h = host();
  const id = str(args.tab) ?? h.activeId;
  const tab = h.tabs.find((t) => t.id === id);
  const handle = h.handle(id);
  if (!tab || !handle) throw new Error(`There's no open label with tab id "${id}". get_status lists the open labels.`);
  return { id, agent: handle.agent };
}

/** The area inside the editor's safe-margin guide: printers can't print reliably within 1 mm of the edge. */
function safeArea(dots: { width: number; height: number; dotsPerMm: number }): Box {
  const m = Math.round(dots.dotsPerMm);
  return { left: m, top: m, right: dots.width - m, bottom: dots.height - m };
}

/** Which sides of the safe-margin guide an element crosses, if any. */
function marginNote(el: LabelElement, dots: { width: number; height: number; dotsPerMm: number }) {
  const b = bounds(el);
  const safe = safeArea(dots);
  const sides = [b.left < safe.left && "left", b.top < safe.top && "top", b.right > safe.right && "right", b.bottom > safe.bottom && "bottom"].filter(Boolean);
  return sides.length ? { warning: `Crosses the 1 mm safe margin on the ${sides.join(", ")}, so it may be cut off when printed.` } : {};
}

/** Element fields measured in dots in the document, and in millimeters in the tools. */
function lengthKeys(type: ElementType): string[] {
  const keys = ["x", "y", "width", "height"];
  if (type === "text" || type === "datetime") keys.push("fontSize");
  if (type === "shape") keys.push("strokeWidth", "cornerRadius");
  return keys;
}

function elementOut(el: LabelElement, dotsPerMm: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...el };
  for (const k of lengthKeys(el.type)) out[k] = round((el as unknown as Record<string, number>)[k] / dotsPerMm);
  // Image data is large and of no use to an agent.
  if (el.type === "image") out.src = el.src ? `(embedded image, ${Math.round(el.src.length / 1365)} KB)` : "(none)";
  return out;
}

function labelOut(tabId: string, meta: TabMeta, doc: LabelDoc) {
  const profile = profileFor(doc);
  const dots = canvasSize(doc.size, profile);
  return {
    tab: tabId,
    title: meta.title,
    path: meta.path,
    unsavedChanges: meta.dirty,
    printer: profile.id,
    size: doc.size,
    canvas: {
      widthMm: round(dots.width / dots.dotsPerMm),
      heightMm: round(dots.height / dots.dotsPerMm),
      safeMarginMm: 1,
      layout:
        profile.direction === "left"
          ? "The label lies on its side: x runs along the label's length, y across its width."
          : "x runs across the label's width, y along its length.",
    },
    ...(doc.counter && { counter: doc.counter }),
    elements: doc.elements.map((el) => elementOut(el, dots.dotsPerMm)),
  };
}

const ENUMS: Record<string, readonly string[]> = {
  align: ["left", "center", "right"],
  valign: ["top", "middle", "bottom"],
  show: ["datetime", "date", "time"],
  mode: ["dither", "threshold"],
  format: BARCODE_FORMATS,
  errorCorrection: ["L", "M", "Q", "H"],
  shape: ["rect", "ellipse", "line"],
  icon: ICON_IDS,
};

/**
 * Apply an agent's properties to an element: lengths from millimeters, only
 * known fields of the right type. Returns the fields it couldn't use and why.
 */
function applyProps(el: LabelElement, args: Args, dotsPerMm: number): { el: LabelElement; ignored: string[] } {
  const out = { ...el } as unknown as Record<string, unknown>;
  const ignored: string[] = [];
  const lengths = lengthKeys(el.type);
  for (const [key, value] of Object.entries(args)) {
    if (["tab", "id", "type", "imagePath", "imageDataUrl"].includes(key)) continue;
    if (!(key in out) || key === "src") {
      ignored.push(`${key} (not a ${el.type} property)`);
    } else if (typeof value !== typeof out[key]) {
      ignored.push(`${key} (should be a ${typeof out[key]})`);
    } else if (ENUMS[key] && !ENUMS[key].includes(value as string)) {
      ignored.push(`${key} (one of ${key === "icon" ? "the ids from list_icons" : ENUMS[key].join(", ")})`);
    } else {
      out[key] = lengths.includes(key) ? Math.round((value as number) * dotsPerMm) : value;
    }
  }
  // A font size means a fixed size, unless the agent also asked for fitting.
  if (typeof args.fontSize === "number" && args.autoFit === undefined && "autoFit" in out) out.autoFit = false;
  return { el: out as unknown as LabelElement, ignored };
}

/** Render the label as it would print, with any problems by element id. */
async function render(doc: LabelDoc, count?: number) {
  const dots = canvasSize(doc.size, profileFor(doc));
  const canvas = document.createElement("canvas");
  const issues = await renderLabel(canvas, dots.width, dots.height, doc.elements, new Date(), { count: count ?? (doc.counter ?? DEFAULT_COUNTER).start });
  return { canvas, issues };
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** An image from a file path or a data URL, prepared the way the editor imports picked files. */
async function loadImage(args: Args): Promise<{ src: string; name: string; aspect: number } | undefined> {
  const path = str(args.imagePath);
  if (path) {
    const name = path.split(/[\\/]/).pop() ?? path;
    const type = IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) throw new Error(`${name} isn't an image LabelPad can use. Use PNG, JPEG, GIF, WebP, BMP or SVG.`);
    const bytes = await invoke<ArrayBuffer>("image_read", { path });
    return importImage(new File([bytes], name, { type }));
  }
  const url = str(args.imageDataUrl);
  if (url) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (!m) throw new Error("imageDataUrl should look like data:image/png;base64,...");
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return importImage(new File([bytes], "Image", { type: m[1] }));
  }
  return undefined;
}

/** Keep an element's proportions when only one side was given. */
function keepProportions(el: LabelElement, args: Args, aspect: number): LabelElement {
  if (!keepsAspect(el)) return el;
  if (args.width !== undefined && args.height === undefined) return { ...el, height: Math.round(el.width / aspect) };
  if (args.height !== undefined && args.width === undefined) return { ...el, width: Math.round(el.height * aspect) };
  return el;
}

const issueNote = (issue: string | undefined) => (issue ? { problem: issue } : {});

// ---- Printer --------------------------------------------------------------

function printerOut(h: McpHost) {
  const { printer, settings } = h;
  const connected = printer.status === "connected" || printer.status === "printing";
  const last = settings.lastPrinter;
  const roll = printer.roll;
  return {
    status: printer.status,
    ...(connected && {
      name: (last && settings.printerNames[last.id]) || printer.details.deviceName,
      model: printer.details.model,
      battery: printer.battery,
      firmware: printer.details.firmware,
      density: { min: printer.details.densityMin, max: printer.details.densityMax, default: printer.details.densityDefault },
      lidClosed: printer.heartbeat?.lidClosed,
      paperInserted: printer.heartbeat?.paperInserted,
      roll: roll
        ? {
            labelsLeft: roll.allPaper - roll.usedPaper,
            labelsTotal: roll.allPaper,
            knownSize: settings.rollSizes[roll.barcode || roll.uuid] ?? null,
          }
        : null,
    }),
    ...(printer.error && { lastError: printer.error }),
    lastPrinter: last ? { id: last.id, name: last.name, nickname: settings.printerNames[last.id] } : null,
  };
}

const TAB = { tab: { type: "string", description: "Tab id from get_status. Defaults to the active label." } };

const ELEMENT_PROPS = {
  x: { type: "number", description: "Left edge, mm from the label's left. Centered if left out when adding." },
  y: { type: "number", description: "Top edge, mm from the label's top. Centered if left out when adding." },
  width: { type: "number", description: "mm. For QR codes, icons and images, giving only one side keeps the proportions." },
  height: { type: "number", description: "mm." },
  rotation: { type: "number", description: "Degrees clockwise around the element's center." },
  text: { type: "string", description: "text: the words. Use {count} or {count:3} for a number that goes up on each label printed." },
  fontFamily: { type: "string", description: "text, datetime: an installed font (see list_fonts)." },
  fontSize: { type: "number", description: "text, datetime: mm. Setting it turns autoFit off unless autoFit is also given." },
  autoFit: { type: "boolean", description: "text, datetime: the largest size that fits the box." },
  bold: { type: "boolean" },
  italic: { type: "boolean" },
  underline: { type: "boolean" },
  align: { type: "string", enum: ENUMS.align },
  valign: { type: "string", enum: ENUMS.valign },
  invert: { type: "boolean", description: "text, datetime: white on a black box. image: swap black and white." },
  show: { type: "string", enum: ENUMS.show, description: "datetime: what to show of the print time." },
  dateFormat: { type: "string", description: 'datetime: tokens such as "DD/MM/YYYY", "D MMM", "ddd D MMM YYYY", "HH:mm", or "locale".' },
  hour12: { type: "boolean", description: "datetime" },
  prefix: { type: "string", description: 'datetime: text before the date, such as "Use by ".' },
  offsetDays: { type: "number", description: "datetime: days added to the print date." },
  imagePath: { type: "string", description: "image: full path of a PNG, JPEG, GIF, WebP, BMP or SVG file." },
  imageDataUrl: { type: "string", description: "image: the image as a data:image/...;base64,... URL instead of a path." },
  mode: { type: "string", enum: ENUMS.mode, description: "image: dither for photos, threshold for logos and line art." },
  threshold: { type: "number", description: "image: 0-255, pixels darker than this print (threshold mode)." },
  value: { type: "string", description: "barcode, qr: the encoded value. {count} works here too." },
  format: { type: "string", enum: ENUMS.format, description: "barcode" },
  showText: { type: "boolean", description: "barcode: print the value under the bars." },
  errorCorrection: { type: "string", enum: ENUMS.errorCorrection, description: "qr" },
  icon: { type: "string", description: "icon: an id from list_icons." },
  strokeWidth: { type: "number", description: "icon: line weight (1-3 looks right). shape: outline in mm." },
  shape: { type: "string", enum: ENUMS.shape, description: "shape" },
  filled: { type: "boolean", description: "shape" },
  cornerRadius: { type: "number", description: "shape (rect): mm." },
};

const TYPES: ElementType[] = ["text", "datetime", "image", "barcode", "qr", "icon", "shape"];

export const TOOLS: Tool[] = [
  {
    name: "get_status",
    title: "Get status",
    description: "The printer connection (model, battery, loaded roll, darkness range) and the open labels. Start here.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_args, host) => {
      const h = host();
      return json({ printer: printerOut(h), openLabels: h.tabs.map(({ id, title, path, dirty, active }) => ({ tab: id, title, path, unsavedChanges: dirty, active })) });
    },
  },
  {
    name: "scan_printers",
    title: "Find printers",
    description: "Look for Niimbot printers over Bluetooth. The printer must be switched on.",
    inputSchema: { type: "object", properties: { seconds: { type: "number", description: "How long to look, 2-30. Default 5." } } },
    annotations: { readOnlyHint: true },
    run: async (args, host) => {
      await host().printer.startScan();
      await sleep(Math.min(30, Math.max(2, num(args.seconds) ?? 5)) * 1000);
      await host().printer.stopScan();
      const { printer, settings } = host();
      return json(
        printer.found.map((p) => ({
          id: p.id,
          name: p.name,
          nickname: settings.printerNames[p.id],
          signal: p.rssi,
          lastUsed: settings.lastPrinter?.id === p.id,
        })),
      );
    },
  },
  {
    name: "connect_printer",
    title: "Connect printer",
    description: "Connect to a printer. With no printer given it reconnects the last one used, like the Connect button.",
    inputSchema: {
      type: "object",
      properties: {
        printer: { type: "string", description: "Id, Bluetooth name or nickname from scan_printers. Leave out for the last printer." },
        timeoutSeconds: { type: "number", description: "How long to look for it, default 15." },
      },
    },
    run: async (args, host) => {
      const wanted = str(args.printer)?.toLowerCase();
      const { settings } = host();
      const last = settings.lastPrinter;
      if (!wanted && !last) throw new Error("No printer has been used yet. Call scan_printers and pass one's id or name.");
      const matches = (p: { id: string; name: string }) =>
        wanted
          ? p.id.toLowerCase() === wanted || p.name.toLowerCase() === wanted || settings.printerNames[p.id]?.toLowerCase() === wanted || p.name.toLowerCase().includes(wanted)
          : p.id === last!.id;
      await host().printer.startScan();
      let found;
      try {
        found = await until(
          () => host().printer.found.find(matches),
          Math.min(60, Math.max(3, num(args.timeoutSeconds) ?? 15)) * 1000,
          `Couldn't find ${wanted ? `"${args.printer}"` : (settings.printerNames[last!.id] ?? last!.name)}. Check it's on and nearby.`,
        );
      } finally {
        await host().printer.stopScan();
      }
      await host().printer.connectTo(found);
      host().updateSettings({ lastPrinter: { id: found.id, name: found.name } });
      await sleep(100);
      return json(printerOut(host()));
    },
  },
  {
    name: "disconnect_printer",
    title: "Disconnect printer",
    description: "Disconnect from the printer.",
    inputSchema: { type: "object", properties: {} },
    run: async (_args, host) => {
      await host().printer.disconnect();
      return json({ status: "disconnected" });
    },
  },
  {
    name: "new_label",
    title: "New label",
    description:
      "Open a new label in its own tab, blank or from a template. It's laid out for the connected printer (or the last one used) at its usual size unless you say otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        printer: { type: "string", enum: Object.keys(PRINTERS), description: "Printer to lay the label out for." },
        widthMm: { type: "number", description: "Label width, across the printhead (12 for a 12 × 40 mm D11 label)." },
        lengthMm: { type: "number", description: "Label length, along the feed (40 for a 12 × 40 mm D11 label)." },
        template: { type: "string", description: "Template id or name from list_templates." },
      },
    },
    run: async (args, host) => {
      const h = host();
      const connected = printerForModel(h.printer.status === "connected" ? h.printer.details.model : undefined);
      const printer = (str(args.printer) as PrinterId | undefined) ?? connected ?? h.settings.printer;
      if (!PRINTERS[printer]) throw new Error(`printer should be one of ${Object.keys(PRINTERS).join(", ")}.`);
      let doc: LabelDoc;
      const name = str(args.template)?.toLowerCase();
      if (name) {
        const all = [...builtInTemplates(), ...(await userTemplates().catch(() => []))];
        const t = all.find((t) => t.id.toLowerCase() === name || t.name.toLowerCase() === name);
        if (!t) throw new Error(`No template called "${args.template}". list_templates shows them.`);
        doc = convertDoc(fromTemplate(t.doc), printer);
      } else {
        const size = printer === h.settings.printer ? h.settings.labelSize : PRINTERS[printer].presets[0];
        doc = { version: 1, printer, size: { widthMm: size.widthMm, lengthMm: size.lengthMm }, elements: [] };
      }
      const widthMm = num(args.widthMm) ?? doc.size.widthMm;
      const lengthMm = num(args.lengthMm) ?? doc.size.lengthMm;
      if (widthMm <= 0 || lengthMm <= 0 || widthMm > PRINTERS[printer].maxWidthMm) throw new Error(`The ${PRINTERS[printer].name} takes labels up to ${PRINTERS[printer].maxWidthMm} mm wide.`);
      doc = { ...doc, printer, size: { widthMm, lengthMm } };
      const id = host().newTab(doc);
      const handle = await until(() => host().handle(id), 3000, "The new label didn't open.");
      return json(labelOut(id, handle.agent.file(), handle.agent.doc()));
    },
  },
  {
    name: "open_label",
    title: "Open label file",
    description: "Open a .labelpad file in a tab (or switch to it if it's open already).",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Full path of the file." } }, required: ["path"] },
    run: async (args, host) => {
      const path = str(args.path);
      if (!path) throw new Error("Give the file's full path.");
      const id = await host().openFile(path);
      const handle = await until(() => host().handle(id), 3000, "The label didn't open.");
      return json(labelOut(id, { ...handle.agent.file(), path }, handle.agent.doc()));
    },
  },
  {
    name: "save_label",
    title: "Save label",
    description: "Save the label to its file, or to a new path (which becomes its file). Paths get the .labelpad extension if missing.",
    inputSchema: { type: "object", properties: { ...TAB, path: { type: "string", description: "Full path to save to. Needed the first time." } } },
    run: async (args, host) => {
      const { agent } = target(host, args);
      let path = str(args.path) ?? agent.file().path;
      if (!path) throw new Error("This label hasn't been saved yet. Give a full path, such as C:\\Labels\\Shelf.labelpad.");
      if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(path)) throw new Error("Give a full path, not a relative one.");
      if (!/\.labelpad$/i.test(path)) path += ".labelpad";
      await agent.saveTo(path);
      return json({ saved: path });
    },
  },
  {
    name: "get_label",
    title: "Get label",
    description: "The label's size, printer and every element with its properties (lengths in mm).",
    inputSchema: { type: "object", properties: TAB },
    annotations: { readOnlyHint: true },
    run: async (args, host) => {
      const { id, agent } = target(host, args);
      return json(labelOut(id, agent.file(), agent.doc()));
    },
  },
  {
    name: "set_label",
    title: "Change label settings",
    description: "Change the label's size, the printer it's laid out for (everything is converted), or the numbering used by {count}.",
    inputSchema: {
      type: "object",
      properties: {
        ...TAB,
        printer: { type: "string", enum: Object.keys(PRINTERS) },
        widthMm: { type: "number", description: "Across the printhead." },
        lengthMm: { type: "number", description: "Along the feed." },
        counterStart: { type: "integer", description: "Number the next printed label gets for {count}." },
        counterStep: { type: "integer", description: "How much {count} goes up per label." },
      },
    },
    run: async (args, host) => {
      const { id, agent } = target(host, args);
      const doc = agent.change((d) => {
        let next = str(args.printer) ? convertDoc(d, args.printer as PrinterId) : d;
        const profile = profileFor(next);
        const widthMm = num(args.widthMm) ?? next.size.widthMm;
        const lengthMm = num(args.lengthMm) ?? next.size.lengthMm;
        if (widthMm <= 0 || lengthMm <= 0 || widthMm > profile.maxWidthMm) throw new Error(`The ${profile.name} takes labels up to ${profile.maxWidthMm} mm wide.`);
        next = { ...next, size: { widthMm, lengthMm } };
        if (num(args.counterStart) !== undefined || num(args.counterStep) !== undefined) {
          const c = next.counter ?? DEFAULT_COUNTER;
          next = { ...next, counter: { start: Math.round(num(args.counterStart) ?? c.start), step: Math.round(num(args.counterStep) ?? c.step) } };
        }
        return next;
      });
      return json(labelOut(id, agent.file(), doc));
    },
  },
  {
    name: "add_element",
    title: "Add to label",
    description:
      "Add text, a date/time, an image, a barcode, a QR code, an icon or a shape. Leave out what you don't need: defaults fit the label. Returns the element (with its id) and any problem, such as an invalid barcode value.",
    inputSchema: { type: "object", properties: { ...TAB, type: { type: "string", enum: TYPES }, ...ELEMENT_PROPS }, required: ["type"] },
    run: async (args, host) => {
      const { agent } = target(host, args);
      const type = args.type as ElementType;
      if (!TYPES.includes(type)) throw new Error(`type should be one of ${TYPES.join(", ")}.`);
      const doc = agent.doc();
      const dots = canvasSize(doc.size, profileFor(doc));
      let base = makeElement(type, dots);
      let aspect = 1;
      if (type === "image") {
        const image = await loadImage(args);
        if (!image) throw new Error("Give imagePath or imageDataUrl for an image.");
        aspect = image.aspect;
        // As large as fits, like a picked image.
        const width = Math.min(dots.width - 8, Math.round((dots.height - 8) * aspect));
        base = { ...base, src: image.src, name: image.name, width, height: Math.round(width / aspect) } as LabelElement;
      }
      const applied = applyProps(base, args, dots.dotsPerMm);
      let el = keepProportions(applied.el, args, aspect);
      if (args.x === undefined) el = { ...el, x: Math.round((dots.width - el.width) / 2) };
      if (args.y === undefined) el = { ...el, y: Math.round((dots.height - el.height) / 2) };
      const next = agent.change((d) => ({ ...d, elements: [...d.elements, el] }));
      const { issues } = await render(next);
      return json({ added: elementOut(el, dots.dotsPerMm), ...issueNote(issues[el.id]), ...marginNote(el, dots), ...(applied.ignored.length && { ignored: applied.ignored }) });
    },
  },
  {
    name: "update_element",
    title: "Change element",
    description: "Change an element's properties (only the ones given). imagePath or imageDataUrl replaces an image's picture.",
    inputSchema: { type: "object", properties: { ...TAB, id: { type: "string", description: "Element id from get_label." }, ...ELEMENT_PROPS }, required: ["id"] },
    run: async (args, host) => {
      const { agent } = target(host, args);
      const doc = agent.doc();
      const old = doc.elements.find((e) => e.id === args.id);
      if (!old) throw new Error(`No element with id "${String(args.id)}". get_label lists them.`);
      const dots = canvasSize(doc.size, profileFor(doc));
      let base = old;
      let aspect = old.width / Math.max(1, old.height);
      if (old.type === "image") {
        const image = await loadImage(args);
        if (image) {
          aspect = image.aspect;
          base = { ...old, src: image.src, name: image.name };
        }
      }
      const applied = applyProps(base, args, dots.dotsPerMm);
      const el = keepProportions(applied.el, args, aspect);
      const next = agent.change((d) => ({ ...d, elements: d.elements.map((e) => (e.id === el.id ? el : e)) }));
      const { issues } = await render(next);
      return json({ updated: elementOut(el, dots.dotsPerMm), ...issueNote(issues[el.id]), ...marginNote(el, dots), ...(applied.ignored.length && { ignored: applied.ignored }) });
    },
  },
  {
    name: "remove_elements",
    title: "Remove elements",
    description: "Delete elements from the label.",
    inputSchema: { type: "object", properties: { ...TAB, ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
    annotations: { destructiveHint: true },
    run: async (args, host) => {
      const { agent } = target(host, args);
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const missing = ids.filter((id) => !agent.doc().elements.some((e) => e.id === id));
      if (missing.length) throw new Error(`No element with id ${missing.map((m) => `"${m}"`).join(", ")}.`);
      agent.change((d) => ({ ...d, elements: d.elements.filter((e) => !ids.includes(e.id)) }));
      return json({ removed: ids });
    },
  },
  {
    name: "arrange_element",
    title: "Arrange element",
    description: "Move an element in front of or behind others, or line it up with the label's center or the edges of its 1 mm safe margin.",
    inputSchema: {
      type: "object",
      properties: {
        ...TAB,
        id: { type: "string" },
        order: { type: "string", enum: ["front", "back", "forward", "backward"] },
        horizontal: { type: "string", enum: ["left", "center", "right"], description: "Line up with the safe margin's left edge, the label's center, or the safe margin's right edge." },
        vertical: { type: "string", enum: ["top", "middle", "bottom"] },
      },
      required: ["id"],
    },
    run: async (args, host) => {
      const { agent } = target(host, args);
      const doc = agent.change((d) => {
        const i = d.elements.findIndex((e) => e.id === args.id);
        if (i < 0) throw new Error(`No element with id "${String(args.id)}".`);
        const dots = canvasSize(d.size, profileFor(d));
        let el = d.elements[i];
        // Edges line up with the safe-margin guide, as snapping in the window does.
        for (const edge of [args.horizontal, args.vertical]) {
          if (typeof edge === "string" && ["left", "center", "right", "top", "middle", "bottom"].includes(edge)) {
            el = { ...el, ...align([el], edge as AlignEdge, safeArea(dots))[el.id] } as LabelElement;
          }
        }
        const els = d.elements.filter((_, j) => j !== i);
        const to = { front: els.length, back: 0, forward: Math.min(els.length, i + 1), backward: Math.max(0, i - 1) }[String(args.order)] ?? i;
        els.splice(to, 0, el);
        return { ...d, elements: els };
      });
      const dots = canvasSize(doc.size, profileFor(doc));
      const el = doc.elements.find((e) => e.id === args.id)!;
      return json({ arranged: elementOut(el, dots.dotsPerMm), ...marginNote(el, dots), order: doc.elements.map((e) => e.id), note: "Later elements draw on top." });
    },
  },
  {
    name: "undo",
    title: "Undo",
    description: "Undo the last change to the label (or redo it), including changes made in the window.",
    inputSchema: { type: "object", properties: { ...TAB, redo: { type: "boolean", description: "Redo instead." } } },
    run: async (args, host) => {
      const { id, agent } = target(host, args);
      if (args.redo === true) agent.redo();
      else agent.undo();
      return json(labelOut(id, agent.file(), agent.doc()));
    },
  },
  {
    name: "preview_label",
    title: "Preview label",
    description:
      "A picture of exactly what will print: the 1-bit image the printer receives, enlarged, with a gray frame marking the label's edge. Use it to check the layout.",
    inputSchema: { type: "object", properties: { ...TAB, count: { type: "integer", description: "Number to show for {count}. Defaults to the next one." } } },
    annotations: { readOnlyHint: true },
    run: async (args, host) => {
      const { agent } = target(host, args);
      const doc = agent.doc();
      const { canvas, issues } = await render(doc, num(args.count));
      const scale = Math.max(1, Math.min(4, Math.ceil(600 / canvas.width)));
      const pad = 2 * scale;
      const out = document.createElement("canvas");
      out.width = canvas.width * scale + pad * 2;
      out.height = canvas.height * scale + pad * 2;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#999";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, pad, pad, canvas.width * scale, canvas.height * scale);
      const problems = Object.entries(issues).map(([id, problem]) => ({ id, problem }));
      return {
        content: [
          { type: "image", data: out.toDataURL("image/png").split(",")[1], mimeType: "image/png" },
          { type: "text", text: problems.length ? JSON.stringify({ problems }, null, 2) : "No problems found." },
        ],
      };
    },
  },
  {
    name: "print_label",
    title: "Print label",
    description:
      "Print the label on the connected printer and wait until it's done. Labels using {count} print one label per number and move the numbering on. Dates print as of now.",
    inputSchema: {
      type: "object",
      properties: {
        ...TAB,
        copies: { type: "integer", description: "How many labels. Defaults to the number set in the window." },
        density: { type: "integer", description: "Darkness, within the range get_status reports. Defaults to the window's setting." },
      },
    },
    run: async (args, host) => {
      const { agent } = target(host, args);
      const { printer, settings } = host();
      const copies = Math.round(num(args.copies) ?? settings.copies);
      if (copies < 1 || copies > 999) throw new Error("copies should be 1 to 999.");
      const density = Math.round(num(args.density) ?? settings.density ?? printer.details.densityDefault);
      if (density < printer.details.densityMin || density > printer.details.densityMax) {
        throw new Error(`density should be ${printer.details.densityMin} to ${printer.details.densityMax} on this printer.`);
      }
      const { issues } = await render(agent.doc());
      const { pages } = await agent.print({ copies, density });
      return json({ printed: pages, density, ...(Object.keys(issues).length && { problems: issues }) });
    },
  },
  {
    name: "select_label",
    title: "Show label",
    description: "Make a tab the active one in the window.",
    inputSchema: { type: "object", properties: TAB, required: ["tab"] },
    run: async (args, host) => {
      const { id } = target(host, args);
      host().selectTab(id);
      return json({ active: id });
    },
  },
  {
    name: "close_label",
    title: "Close label",
    description: "Close a label's tab. A label with unsaved changes stays open unless discard is true.",
    inputSchema: { type: "object", properties: { ...TAB, discard: { type: "boolean", description: "Close even with unsaved changes, losing them." } } },
    annotations: { destructiveHint: true },
    run: async (args, host) => {
      const { id, agent } = target(host, args);
      if (agent.file().dirty && args.discard !== true) throw new Error("This label has unsaved changes. Save it with save_label, or pass discard: true to lose them.");
      host().closeTab(id);
      return json({ closed: id, active: host().activeId });
    },
  },
  {
    name: "list_templates",
    title: "List templates",
    description: "Templates new_label can start from: the built-in ones and the ones saved in LabelPad.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => {
      const all = [...builtInTemplates(), ...(await userTemplates().catch(() => []))];
      return json(all.map((t) => ({ id: t.id, name: t.name, builtIn: t.builtIn, printer: t.doc.printer ?? "d11", size: t.doc.size })));
    },
  },
  {
    name: "list_icons",
    title: "List icons",
    description: "Ids of the icons an icon element can show.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => json(ICON_IDS),
  },
  {
    name: "list_fonts",
    title: "List fonts",
    description: "Fonts installed on this computer, by style.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => {
      const fonts = await invoke<{ family: string; category: string }[]>("system_fonts");
      const byStyle: Record<string, string[]> = {};
      for (const f of fonts) (byStyle[f.category] ??= []).push(f.family);
      return json(byStyle);
    },
  },
];
