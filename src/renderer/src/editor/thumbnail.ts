import { useEffect, useState } from "react";
import { renderLabel } from "./render";
import type { LabelDoc } from "./types";
import { canvasSize, profileFor } from "../printer/label";

/** The label rendered as it would print, for a preview card. Null while it renders, or with no label. */
export function useThumbnail(doc: LabelDoc | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!doc) return;
    let live = true;
    const { width, height } = canvasSize(doc.size, profileFor(doc));
    const canvas = document.createElement("canvas");
    renderLabel(canvas, width, height, doc.elements).then(() => live && setUrl(canvas.toDataURL()));
    return () => {
      live = false;
    };
  }, [doc]);
  return url;
}
