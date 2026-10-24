import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type FontCategory = "sans" | "serif" | "mono" | "script" | "display" | "symbol" | "other";
export type FontInfo = { family: string; category: FontCategory };

export const CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: "Sans serif",
  serif: "Serif",
  mono: "Monospace",
  script: "Handwriting",
  display: "Display",
  symbol: "Symbols",
  other: "Other",
};

/** Shown first in the font picker, and used if the system list can't be read. */
export const COMMON_FONTS: FontInfo[] = [
  { family: "Arial", category: "sans" },
  { family: "Verdana", category: "sans" },
  { family: "Segoe UI", category: "sans" },
  { family: "Helvetica", category: "sans" },
  { family: "Georgia", category: "serif" },
  { family: "Times New Roman", category: "serif" },
  { family: "Courier New", category: "mono" },
  { family: "Impact", category: "display" },
];

let cached: Promise<FontInfo[]> | null = null;

function loadFonts(): Promise<FontInfo[]> {
  cached ??= invoke<FontInfo[]>("system_fonts")
    .then((fonts) => (fonts.length ? fonts : COMMON_FONTS))
    .catch(() => COMMON_FONTS);
  return cached;
}

/** Every font installed on this computer, with its style. */
export function useSystemFonts(): FontInfo[] {
  const [fonts, setFonts] = useState<FontInfo[]>(COMMON_FONTS);
  useEffect(() => {
    let live = true;
    loadFonts().then((f) => live && setFonts(f));
    return () => {
      live = false;
    };
  }, []);
  return fonts;
}
