import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { FILE_EXTENSION, FILE_FILTERS, fileTitle, parseLabel, serializeLabel } from "./labelFile";
import type { LabelDoc } from "./types";

const DRAFT_KEY = "niimbot-studio.draft";

type Draft = { doc: LabelDoc; path: string | null; dirty: boolean };

/** The label you were working on last time, if it was kept. */
export function loadDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    return d && d.doc ? { doc: parseLabel(serializeLabel(d.doc)), path: d.path ?? null, dirty: !!d.dirty } : null;
  } catch {
    return null;
  }
}

type Editor = { doc: LabelDoc; reset: (doc: LabelDoc) => void };

/**
 * New, open, save and save-as for the editor's document, with an unsaved
 * changes prompt and the file name in the window title.
 */
export function useLabelFile(editor: Editor, opts: { initialPath: string | null; initialDirty: boolean; newDoc: () => LabelDoc }) {
  const { doc } = editor;
  const [path, setPath] = useState<string | null>(opts.initialPath);
  // The document as last saved or opened. Undo returns the same object, so
  // undoing back to it clears the unsaved mark.
  const [saved, setSaved] = useState<LabelDoc | null>(opts.initialDirty ? null : doc);
  const dirty = doc !== saved;
  const title = path ? fileTitle(path) : "Untitled";

  const state = useRef({ doc, path, dirty });
  state.current = { doc, path, dirty };

  useEffect(() => {
    const text = `${dirty ? "• " : ""}${title} — Niimbot Studio`;
    document.title = text;
    getCurrentWindow().setTitle(text).catch(() => undefined);
  }, [title, dirty]);

  // Keep the current label so the next start can pick up where you left off.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc, path, dirty } satisfies Draft));
      } catch {
        // Large images can exceed storage; the draft just isn't kept.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [doc, path, dirty]);

  /** True when it's fine to replace the current label. */
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

  const newFile = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const fresh = opts.newDoc();
    editor.reset(fresh);
    setPath(null);
    setSaved(fresh);
  }, [confirmDiscard, editor, opts]);

  const openFile = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const chosen = await open({ filters: FILE_FILTERS, multiple: false, directory: false });
    if (typeof chosen !== "string") return;
    try {
      const loaded = parseLabel(await invoke<string>("label_read", { path: chosen }));
      editor.reset(loaded);
      setPath(chosen);
      setSaved(loaded);
    } catch (e) {
      await message(e instanceof Error ? e.message : String(e), { title: "Couldn't open label", kind: "error" });
    }
  }, [confirmDiscard, editor]);

  // Ask before closing the window with unsaved changes.
  useEffect(() => {
    const win = getCurrentWindow();
    const off = win.onCloseRequested(async (e) => {
      if (!(await confirmDiscard())) e.preventDefault();
    });
    return () => void off.then((f) => f());
  }, [confirmDiscard]);

  return { path, title, dirty, newFile, openFile, saveFile, saveAs };
}
