import { invoke } from "@tauri-apps/api/core";
import { fileTitle } from "./labelFile";

const KEY = "labelpad.recent";
/** Paths kept; more than are shown, so files that have been moved or deleted don't empty the list. */
const KEEP = 30;
/** How many the start screen shows. */
export const RECENT_COUNT = 10;

export type RecentLabel = { path: string; title: string; modified: number };

function load(): string[] {
  try {
    const paths = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function store(paths: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths.slice(0, KEEP)));
  } catch {
    // Storage unavailable; the list just isn't kept.
  }
}

/** Note a label file that was opened or saved. */
export function rememberRecent(path: string) {
  store([path, ...load().filter((p) => p !== path)]);
}

/** Take a label off the start screen's list. The file itself is left alone. */
export function forgetRecent(path: string) {
  store(load().filter((p) => p !== path));
}

/** The labels you've opened or saved that still exist, most recently modified first. */
export async function recentLabels(): Promise<RecentLabel[]> {
  const paths = load();
  if (!paths.length) return [];
  const modified = await invoke<(number | null)[]>("label_modified", { paths });
  return paths
    .flatMap((path, i): RecentLabel[] => (modified[i] == null ? [] : [{ path, title: fileTitle(path), modified: modified[i]! }]))
    .sort((a, b) => b.modified - a.modified)
    .slice(0, RECENT_COUNT);
}
