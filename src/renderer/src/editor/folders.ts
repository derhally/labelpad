import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../settings/useSettings";

/** Documents\LabelPad, made if it's missing. */
export const defaultLabelsFolder = () => invoke<string>("labels_folder");

/** Where Save and Open start: the folder last saved to, else the save folder. */
export async function startFolder(s: Settings): Promise<string | undefined> {
  if (s.rememberLastFolder && s.lastFolder) return s.lastFolder;
  return s.saveFolder ?? (await defaultLabelsFolder().catch(() => undefined));
}
