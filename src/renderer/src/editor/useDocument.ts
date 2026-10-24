import { useCallback, useMemo, useState } from "react";
import type { LabelDoc, LabelElement } from "./types";

type History = { past: LabelDoc[]; present: LabelDoc; future: LabelDoc[] };

const HISTORY_LIMIT = 100;

/**
 * Label document state with undo and redo. Pass `{ transient: true }` for
 * updates in the middle of a drag so the whole gesture undoes as one step;
 * call `checkpoint()` when the gesture starts.
 */
export function useDocument(initial: LabelDoc) {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });

  const apply = useCallback((change: (doc: LabelDoc) => LabelDoc, opts?: { transient?: boolean }) => {
    setHistory((h) => {
      const next = change(h.present);
      if (next === h.present) return h;
      if (opts?.transient) return { ...h, present: next };
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
    });
  }, []);

  const checkpoint = useCallback(() => {
    setHistory((h) => ({ past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: h.present, future: [] }));
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const prev = h.past[h.past.length - 1];
      if (!prev) return h;
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      const [next, ...rest] = h.future;
      if (!next) return h;
      return { past: [...h.past, h.present], present: next, future: rest };
    });
  }, []);

  const actions = useMemo(
    () => ({
      setSize: (size: LabelDoc["size"]) => apply((d) => ({ ...d, size })),
      add: (el: LabelElement) => apply((d) => ({ ...d, elements: [...d.elements, el] })),
      update: (id: string, patch: Partial<LabelElement>, opts?: { transient?: boolean }) =>
        apply(
          (d) => ({
            ...d,
            elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)),
          }),
          opts,
        ),
      remove: (id: string) => apply((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) })),
      /** Move an element up (+1) or down (-1) the stack, or to the very top/bottom. */
      reorder: (id: string, to: "up" | "down" | "top" | "bottom") =>
        apply((d) => {
          const i = d.elements.findIndex((e) => e.id === id);
          if (i < 0) return d;
          const els = [...d.elements];
          const [el] = els.splice(i, 1);
          const j = to === "top" ? els.length : to === "bottom" ? 0 : Math.max(0, Math.min(els.length, i + (to === "up" ? 1 : -1)));
          els.splice(j, 0, el);
          return { ...d, elements: els };
        }),
      replace: (doc: LabelDoc) => apply(() => doc),
    }),
    [apply],
  );

  return {
    doc: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    checkpoint,
    ...actions,
  };
}
