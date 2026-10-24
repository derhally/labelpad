import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Shown first in the font picker, and used if the system list can't be read. */
export const COMMON_FONTS = ["Arial", "Verdana", "Segoe UI", "Helvetica", "Georgia", "Times New Roman", "Courier New", "Impact"];

let cached: Promise<string[]> | null = null;

function loadFonts(): Promise<string[]> {
  cached ??= invoke<string[]>("system_fonts")
    .then((fonts) => (fonts.length ? fonts : COMMON_FONTS))
    .catch(() => COMMON_FONTS);
  return cached;
}

/** Every font installed on this computer. */
export function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS);
  useEffect(() => {
    let live = true;
    loadFonts().then((f) => live && setFonts(f));
    return () => {
      live = false;
    };
  }, []);
  return fonts;
}
