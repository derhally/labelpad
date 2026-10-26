import { keepsAspect, type LabelElement } from "./types";

export type Box = { left: number; top: number; right: number; bottom: number };
export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type FillAxis = "both" | "width" | "height";
type Patches = Record<string, Partial<LabelElement>>;

/** Inside the safe-margin guide, `margin` dots in from each edge of the label. */
export function safeArea(label: { width: number; height: number }, margin: number): Box {
  return { left: margin, top: margin, right: label.width - margin, bottom: label.height - margin };
}

/**
 * Resize an element so its footprint fills `area` across, down, or both, and
 * centre it there. Elements that keep their aspect (QR codes, icons, images)
 * grow as large as fits instead. Rotation snaps to the nearest quarter turn,
 * since a tilted box can't fill a rectangle.
 */
export function fill(el: LabelElement, area: Box, axis: FillAxis): Partial<LabelElement> {
  const rotation = (((Math.round(el.rotation / 90) * 90) % 360) + 360) % 360;
  const sideways = rotation % 180 === 90;
  // Current footprint, and the space to fill.
  const [cw, ch] = sideways ? [el.height, el.width] : [el.width, el.height];
  const [aw, ah] = [area.right - area.left, area.bottom - area.top];
  let [tw, th] = [axis === "height" ? cw : aw, axis === "width" ? ch : ah];
  if (keepsAspect(el)) {
    const s = Math.min(aw / cw, ah / ch);
    [tw, th] = [cw * s, ch * s];
  }
  // Centre on the filled axes; keep the item where it is on the other one.
  const b = bounds(el);
  const cx = axis === "height" && !keepsAspect(el) ? (b.left + b.right) / 2 : (area.left + area.right) / 2;
  const cy = axis === "width" && !keepsAspect(el) ? (b.top + b.bottom) / 2 : (area.top + area.bottom) / 2;
  const [w, h] = sideways ? [th, tw] : [tw, th];
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));
  return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width, height, rotation };
}

/** The element's footprint on the label, including rotation. */
export function bounds(el: LabelElement): Box {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const r = (el.rotation * Math.PI) / 180;
  const hw = (Math.abs(el.width * Math.cos(r)) + Math.abs(el.height * Math.sin(r))) / 2;
  const hh = (Math.abs(el.width * Math.sin(r)) + Math.abs(el.height * Math.cos(r))) / 2;
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

export function union(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** Line elements up on one edge or centre line of `target` (the selection's or the label's bounds). */
export function align(els: LabelElement[], edge: AlignEdge, target: Box): Patches {
  const patches: Patches = {};
  for (const el of els) {
    const b = bounds(el);
    let dx = 0;
    let dy = 0;
    if (edge === "left") dx = target.left - b.left;
    else if (edge === "right") dx = target.right - b.right;
    else if (edge === "center") dx = (target.left + target.right) / 2 - (b.left + b.right) / 2;
    else if (edge === "top") dy = target.top - b.top;
    else if (edge === "bottom") dy = target.bottom - b.bottom;
    else dy = (target.top + target.bottom) / 2 - (b.top + b.bottom) / 2;
    patches[el.id] = { x: Math.round(el.x + dx), y: Math.round(el.y + dy) };
  }
  return patches;
}

/**
 * Space elements so the gaps between them are equal, keeping the first and
 * last in place. With `within`, the outer elements move to its edges first.
 */
export function distribute(els: LabelElement[], axis: "horizontal" | "vertical", within?: Box): Patches {
  const h = axis === "horizontal";
  const items = els
    .map((el) => ({ el, b: bounds(el) }))
    .sort((a, b) => (h ? a.b.left + a.b.right - b.b.left - b.b.right : a.b.top + a.b.bottom - b.b.top - b.b.bottom));
  const size = (b: Box) => (h ? b.right - b.left : b.bottom - b.top);
  const start = within ? (h ? within.left : within.top) : h ? items[0].b.left : items[0].b.top;
  const end = within ? (h ? within.right : within.bottom) : h ? items[items.length - 1].b.right : items[items.length - 1].b.bottom;
  const total = items.reduce((sum, i) => sum + size(i.b), 0);
  const gap = items.length > 1 ? (end - start - total) / (items.length - 1) : 0;

  const patches: Patches = {};
  let pos = start;
  for (const { el, b } of items) {
    const shift = pos - (h ? b.left : b.top);
    patches[el.id] = h ? { x: Math.round(el.x + shift) } : { y: Math.round(el.y + shift) };
    pos += size(b) + gap;
  }
  return patches;
}
