/** The D11 prints at 203 dpi, which is 8 dots per millimetre. */
export const DOTS_PER_MM = 8;

export type LabelSize = { id: string; name: string; widthMm: number; lengthMm: number };

/** Common Niimbot D11 label rolls. Width runs across the printhead, length along the feed. */
export const LABEL_SIZES: LabelSize[] = [
  { id: "12x40", name: "12 × 40 mm", widthMm: 12, lengthMm: 40 },
  { id: "12x30", name: "12 × 30 mm", widthMm: 12, lengthMm: 30 },
  { id: "12x22", name: "12 × 22 mm", widthMm: 12, lengthMm: 22 },
  { id: "15x30", name: "15 × 30 mm", widthMm: 15, lengthMm: 30 },
  { id: "14x50", name: "14 × 50 mm", widthMm: 14, lengthMm: 50 },
];

export type TestLabel = { text: string; border: boolean };

/**
 * Size of the printable canvas in dots. The canvas is landscape (length along x)
 * and its height is capped at the printhead width, since wider rolls only print
 * the middle strip.
 */
export function canvasSize(size: LabelSize, printheadPixels: number): { width: number; height: number } {
  return {
    width: Math.round(size.lengthMm * DOTS_PER_MM),
    height: Math.min(Math.round(size.widthMm * DOTS_PER_MM), printheadPixels),
  };
}

/** Draw the step-one test label and snap it to pure black and white, exactly as it will print. */
export function drawTestLabel(canvas: HTMLCanvasElement, label: TestLabel): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";

  const pad = label.border ? 8 : 4;
  if (label.border) {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, width - 3, height - 3, 8);
    ctx.stroke();
  }

  const text = label.text.trim() || " ";
  const lines = text.split("\n");
  const maxWidth = width - pad * 2;
  const maxHeight = height - pad * 2;

  // Largest font that fits every line inside the label.
  let fontSize = Math.floor(maxHeight / lines.length);
  const font = (s: number) => `600 ${s}px "Inter", "Segoe UI", system-ui, sans-serif`;
  for (; fontSize > 6; fontSize--) {
    ctx.font = font(fontSize);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= maxWidth && fontSize * 1.1 * lines.length <= maxHeight) break;
  }
  ctx.font = font(fontSize);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineHeight = fontSize * 1.1;
  const top = height / 2 - (lineHeight * (lines.length - 1)) / 2;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, top + i * lineHeight));

  threshold(ctx, width, height);
}

/** The printer has no grey; anything darker than mid-grey becomes a printed dot. */
function threshold(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = d[i + 3] > 0 && lum < 160 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
