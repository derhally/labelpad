/** The D11 prints at 203 dpi, which is 8 dots per millimetre. */
export const DOTS_PER_MM = 8;

export type LabelSize = { widthMm: number; lengthMm: number };
export type LabelPreset = LabelSize & { name: string };

/** Common Niimbot D11 label rolls. Width runs across the printhead, length along the feed. */
export const LABEL_PRESETS: LabelPreset[] = [
  { name: "12 × 40 mm", widthMm: 12, lengthMm: 40 },
  { name: "12 × 30 mm", widthMm: 12, lengthMm: 30 },
  { name: "12 × 22 mm", widthMm: 12, lengthMm: 22 },
  { name: "15 × 30 mm", widthMm: 15, lengthMm: 30 },
  { name: "14 × 50 mm", widthMm: 14, lengthMm: 50 },
];

/**
 * Size of the printable canvas in dots. The canvas is landscape (length along x)
 * and its height is capped at the printhead width, since wider rolls only print
 * the middle strip.
 */
export function canvasSize(size: LabelSize, printheadPixels: number): { width: number; height: number } {
  return {
    width: Math.max(8, Math.round(size.lengthMm * DOTS_PER_MM)),
    height: Math.max(8, Math.min(Math.round(size.widthMm * DOTS_PER_MM), printheadPixels)),
  };
}
