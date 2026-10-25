import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";

export type Settings = {
  theme: Theme;
  density: number | null;
  copies: number;
  /** Size for new labels; follows the last size picked. */
  labelSize: { widthMm: number; lengthMm: number };
  /** Reopen the label you were working on when the app starts. */
  restoreLast: boolean;
  lastPrinter: { id: string; name: string } | null;
  /** Label sizes you've confirmed for roll types, keyed by the barcode on the roll's tag. */
  rollSizes: Record<string, { widthMm: number; lengthMm: number }>;
  /** Look for a new LabelPad release once a week. */
  autoUpdate: boolean;
  /** When releases were last checked (ms since epoch). */
  lastUpdateCheck: number | null;
};

const KEY = "labelpad.settings";

const DEFAULTS: Settings = {
  theme: "system",
  density: null,
  copies: 1,
  labelSize: { widthMm: 12, lengthMm: 40 },
  restoreLast: true,
  lastPrinter: null,
  rollSizes: {},
  autoUpdate: true,
  lastUpdateCheck: null,
};

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULTS, ...(typeof saved === "object" && saved ? saved : {}) };
  } catch {
    return DEFAULTS;
  }
}

/** App preferences, kept in the webview's local storage. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Storage full or unavailable; settings just won't persist.
    }
  }, [settings]);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  return { settings, update };
}

/** Colours come from CSS; this picks them and matches the native title bar. */
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => undefined);
}
