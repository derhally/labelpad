import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, message, save } from "@tauri-apps/plugin-dialog";
import { FILE_EXTENSION, FILE_FILTERS, fileTitle, parseLabel, serializeLabel } from "./labelFile";
import type { LabelDoc } from "./types";

/** Before tabs there was one draft, kept under this key. */
const OLD_DRAFT_KEY = "labelpad.draft";
const draftKey = (tabId: string) => `labelpad.draft.${tabId}`;

export type Draft = { doc: LabelDoc; path: string | null; dirty: boolean };

/** A label kept from last time, if there is one. Without a tab id, the draft from before tabs. */
export function loadDraft(tabId?: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(tabId ? draftKey(tabId) : OLD_DRAFT_KEY) ?? "null");
    return d && d.doc ? { doc: parseLabel(serializeLabel(d.doc)), path: d.path ?? null, dirty: !!d.dirty } : null;
  } catch {
    return null;
  }
}

export function forgetDraft(tabId?: string) {
  try {
    localStorage.removeItem(tabId ? draftKey(tabId) : OLD_DRAFT_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Read a label file from disk. */
export async function readLabel(path: string): Promise<LabelDoc> {
  return parseLabel(await invoke<string>("label_read", { path }));
}

type Editor = { doc: LabelDoc };

/**
 * Save and save-as for one tab's label, the unsaved changes prompt, and a
 * draft so the next start can pick up where you left off.
 */
export function useLabelFile(editor: Editor, opts: { tabId: string; initialPath: string | null; initialDirty: boolean }) {
  const { doc } = editor;
  const { tabId } = opts;
  const [path, setPath] = useState<string | null>(opts.initialPath);
  // The document as last saved or opened. Undo returns the same object, so
  // undoing back to it clears the unsaved mark.
  const [saved, setSaved] = useState<LabelDoc | null>(opts.initialDirty ? null : doc);
  const dirty = doc !== saved;
  const title = path ? fileTitle(path) : "Untitled";

  const state = useRef({ doc, path, dirty });
  state.current = { doc, path, dirty };

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(tabId), JSON.stringify({ doc, path, dirty } satisfies Draft));
      } catch {
        // Large images can exceed storage; the draft just isn't kept.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [doc, path, dirty, tabId]);

  /** True when it's fine to throw this label's changes away. */
  const confirmDiscard = useCallback(async () => {
    if (!state.current.dirty) return true;
    const name = state.current.path ? fileTitle(state.current.path) : "this label";
    return ask(`Your changes to ${name} haven't been saved. Discard them?`, {
      title: "Unsaved changes",
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Keep editing",
    });
  }, []);

  const write = useCallback(async (target: string) => {
    const current = state.current.doc;
    try {
      await invoke("label_write", { path: target, contents: serializeLabel(current) });
      setPath(target);
      setSaved(current);
      return true;
    } catch (e) {
      await message(String(e), { title: "Couldn't save", kind: "error" });
      return false;
    }
  }, []);

  const saveAs = useCallback(async () => {
    const chosen = await save({ filters: FILE_FILTERS, defaultPath: `${state.current.path ? fileTitle(state.current.path) : "Label"}.${FILE_EXTENSION}` });
    if (!chosen) return false;
    return write(chosen.toLowerCase().endsWith(`.${FILE_EXTENSION}`) ? chosen : `${chosen}.${FILE_EXTENSION}`);
  }, [write]);

  const saveFile = useCallback(() => (state.current.path ? write(state.current.path) : saveAs()), [write, saveAs]);

  return { path, title, dirty, saveFile, saveAs, confirmDiscard };
}
