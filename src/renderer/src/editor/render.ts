import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { ICONS } from "./icons";
import type {
  BarcodeElement,
  IconElement,
  ImageElement,
  LabelElement,
  QrElement,
  ShapeElement,
  TextStyle,
} from "./types";
import { dateTimeText } from "./dateFormat";

/** Problems found while rendering, keyed by element id (e.g. an invalid EAN-13 value). */
export type RenderIssues = Record<string, string>;

type Layer = HTMLCanvasElement;

/**
 * Render a label into `target` at print resolution, snapped to pure black and
 * white so the preview is exactly what the printer receives.
 */
export async function renderLabel(
  target: HTMLCanvasElement,
  width: number,
  height: number,
  elements: LabelElement[],
  /** The time date/time elements show. */
  now: Date = new Date(),
): Promise<RenderIssues> {
  const issues: RenderIssues = {};
  // Render each element first; images and icons load asynchronously.
  const layers = await Promise.all(
    elements.map(async (el) => {
      try {
        return await renderElement(el, now, (msg) => (issues[el.id] = msg));
      } catch (e) {
        issues[el.id] = e instanceof Error ? e.message : String(e);
        return placeholder(el);
      }
    }),
  );

  const out = makeCanvas(width, height);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  elements.forEach((el, i) => {
    const layer = layers[i];
    if (!layer) return;
    ctx.save();
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
    ctx.restore();
  });

  snapToBlackAndWhite(ctx, width, height);

  target.width = width;
  target.height = height;
  target.getContext("2d")!.drawImage(out, 0, 0);
  return issues;
}

async function renderElement(el: LabelElement, now: Date, warn: (message: string) => void): Promise<Layer | null> {
  const w = Math.max(1, Math.round(el.width));
  const h = Math.max(1, Math.round(el.height));
  switch (el.type) {
    case "text":
      return renderText(el, el.text, w, h);
    case "datetime":
      return renderText(el, dateTimeText(el, now), w, h);
    case "image":
      return renderImage(el, w, h);
    case "barcode":
      return renderBarcode(el, w, h, warn);
    case "qr":
      return renderQr(el, w, h);
    case "icon":
      return renderIcon(el, w, h);
    case "shape":
      return renderShape(el, w, h);
  }
}

// ---------------------------------------------------------------------------
// Text

function fontString(el: TextStyle, size: number): string {
  return `${el.italic ? "italic " : ""}${el.bold ? "700" : "400"} ${size}px "${el.fontFamily}", sans-serif`;
}

/** Largest font size at which every line fits the box. */
export function fitFontSize(el: TextStyle, text: string, w: number, h: number): number {
  const ctx = makeCanvas(1, 1).getContext("2d")!;
  const lines = text.split("\n");
  const pad = el.invert ? 4 : 0;
  let size = Math.max(6, Math.floor((h - pad * 2) / (lines.length * 1.15)));
  for (; size > 6; size--) {
    ctx.font = fontString(el, size);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= w - pad * 2) break;
  }
  return size;
}

function renderText(el: TextStyle, text: string, w: number, h: number): Layer {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const size = el.autoFit ? fitFontSize(el, text, w, h) : el.fontSize;
  const lines = text.split("\n");
  const lineHeight = size * 1.15;
  const pad = el.invert ? 4 : 0;

  if (el.invert) {
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.min(8, h / 4));
    ctx.fill();
  }

  ctx.font = fontString(el, size);
  ctx.fillStyle = el.invert ? "#fff" : "#000";
  ctx.textBaseline = "middle";
  ctx.textAlign = el.align;
  const x = el.align === "left" ? pad : el.align === "right" ? w - pad : w / 2;
  // Centre of the first line, for the block of lines placed top, middle or bottom.
  const block = lineHeight * lines.length;
  const top =
    el.valign === "top" ? pad + lineHeight / 2 : el.valign === "bottom" ? h - pad - block + lineHeight / 2 : h / 2 - (lineHeight * (lines.length - 1)) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight));

  toOneBit(ctx, w, h);
  return canvas;
}

// ---------------------------------------------------------------------------
// Images

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  let cached = imageCache.get(src);
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = src;
    });
    imageCache.set(src, cached);
  }
  return cached;
}

/** Images only add ink: their white areas stay see-through so they never erase what's underneath. */
async function renderImage(el: ImageElement, w: number, h: number): Promise<Layer> {
  const img = await loadImage(el.src);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

  const data = ctx.getImageData(0, 0, w, h);
  if (el.mode === "dither") floydSteinberg(data, el.threshold, el.invert);
  else thresholdImage(data, el.threshold, el.invert);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Grey level of a pixel, treating transparency as white paper. */
function grey(d: Uint8ClampedArray, i: number): number {
  const a = d[i + 3] / 255;
  const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return lum * a + 255 * (1 - a);
}

function thresholdImage(image: ImageData, threshold: number, invert: boolean): void {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = grey(d, i);
    if (invert) g = 255 - g;
    const black = g < threshold;
    setPixel(d, i, black, !black);
  }
}

function floydSteinberg(image: ImageData, threshold: number, invert: boolean): void {
  const { width, height, data: d } = image;
  const levels = new Float32Array(width * height);
  // Shift the midpoint so the slider still controls overall darkness.
  const bias = threshold - 128;
  for (let p = 0; p < levels.length; p++) {
    const g = grey(d, p * 4);
    levels[p] = (invert ? 255 - g : g) - bias;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const old = levels[p];
      const black = old < 128;
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) levels[p + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) levels[p + width - 1] += (err * 3) / 16;
        levels[p + width] += (err * 5) / 16;
        if (x + 1 < width) levels[p + width + 1] += err / 16;
      }
      setPixel(d, p * 4, black, !black);
    }
  }
}

// ---------------------------------------------------------------------------
// Barcodes and QR codes

function renderBarcode(el: BarcodeElement, w: number, h: number, warn: (message: string) => void): Layer {
  const textSize = el.showText ? Math.max(10, Math.round(h * 0.2)) : 0;
  const natural = document.createElement("canvas");
  let valid = true;
  JsBarcode(natural, el.value, {
    format: el.format,
    width: 1,
    height: Math.max(8, h - (el.showText ? textSize + 2 : 0)),
    displayValue: el.showText,
    fontSize: textSize,
    textMargin: 1,
    margin: 0,
    background: "rgba(0,0,0,0)",
    font: "Arial",
    valid: (ok: boolean) => (valid = ok),
  });
  if (!valid || natural.width === 0) throw new Error(`"${el.value}" isn't a valid ${el.format} value`);

  // Scale bars by a whole number so every bar stays the same width.
  const factor = Math.max(1, Math.floor(w / natural.width));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const dw = natural.width * factor > w ? w : natural.width * factor;
  ctx.drawImage(natural, Math.round((w - dw) / 2), 0, dw, h);
  toOneBit(ctx, w, h);
  if (natural.width > w) warn("Squeezed to fit, so it may not scan. Make it wider or shorten the value.");
  return canvas;
}

function renderQr(el: QrElement, w: number, h: number): Layer {
  if (!el.value) throw new Error("Enter some text or a link");
  const qr = QRCode.create(el.value, { errorCorrectionLevel: el.errorCorrection });
  const n = qr.modules.size;
  const side = Math.min(w, h);
  const scale = Math.floor(side / n);
  if (scale < 1) throw new Error("Too much data for this size. Make it bigger or shorten the text.");
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const ox = Math.floor((w - n * scale) / 2);
  const oy = Math.floor((h - n * scale) / 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(ox, oy, n * scale, n * scale);
  ctx.fillStyle = "#000";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(y, x)) ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Icons and shapes

async function renderIcon(el: IconElement, w: number, h: number): Promise<Layer> {
  const Icon = ICONS[el.icon];
  if (!Icon) throw new Error(`Unknown icon "${el.icon}"`);
  const side = Math.min(w, h);
  const svg = renderToStaticMarkup(
    createElement(Icon, { size: side, color: "#000", strokeWidth: el.strokeWidth, absoluteStrokeWidth: false }),
  );
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side);
  toOneBit(ctx, w, h);
  return canvas;
}

function renderShape(el: ShapeElement, w: number, h: number): Layer {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const s = el.strokeWidth;
  ctx.fillStyle = ctx.strokeStyle = "#000";
  ctx.lineWidth = s;
  ctx.beginPath();
  if (el.shape === "line") {
    ctx.fillRect(0, Math.round((h - s) / 2), w, s);
  } else if (el.shape === "ellipse") {
    ctx.ellipse(w / 2, h / 2, Math.max(0, w / 2 - (el.filled ? 0 : s / 2)), Math.max(0, h / 2 - (el.filled ? 0 : s / 2)), 0, 0, Math.PI * 2);
    el.filled ? ctx.fill() : ctx.stroke();
  } else if (el.filled) {
    ctx.roundRect(0, 0, w, h, el.cornerRadius);
    ctx.fill();
  } else {
    ctx.roundRect(s / 2, s / 2, w - s, h - s, Math.max(0, el.cornerRadius - s / 2));
    ctx.stroke();
  }
  toOneBit(ctx, w, h);
  return canvas;
}

// ---------------------------------------------------------------------------
// Pixel helpers

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function setPixel(d: Uint8ClampedArray, i: number, black: boolean, transparent: boolean): void {
  d[i] = d[i + 1] = d[i + 2] = black ? 0 : 255;
  d[i + 3] = transparent ? 0 : 255;
}

/**
 * Snap anti-aliased drawing to 1-bit while keeping the background transparent,
 * so overlapping elements don't blank each other out.
 */
function toOneBit(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const transparent = d[i + 3] < 128;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    setPixel(d, i, !transparent && lum < 128, transparent);
  }
  ctx.putImageData(image, 0, 0);
}

function snapToBlackAndWhite(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    setPixel(d, i, lum < 128, false);
  }
  ctx.putImageData(image, 0, 0);
}

/** Hatched box for an element that failed to render, so it stays visible and selectable. */
function placeholder(el: LabelElement): Layer {
  const w = Math.max(1, Math.round(el.width));
  const h = Math.max(1, Math.round(el.height));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  for (let x = -h; x < w; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
    ctx.lineTo(x + h + 1, 0);
    ctx.lineTo(x + 1, h);
    ctx.fill();
  }
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  toOneBit(ctx, w, h);
  return canvas;
}
