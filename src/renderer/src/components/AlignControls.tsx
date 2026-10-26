import { useState } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, Copy, Maximize, MoveHorizontal, MoveVertical, Trash2,
} from "lucide-react";
import { align, bounds, distribute, fill, safeArea, union, type AlignEdge, type Box } from "../editor/arrange";
import type { LabelElement } from "../editor/types";
import { spell } from "../locale";
import { Segmented } from "./fields";

type Patches = Record<string, Partial<LabelElement>>;

type Props = {
  els: LabelElement[];
  /** The label in dots, and the safe-margin guide's inset. */
  label: { width: number; height: number; margin: number };
  onApply: (patches: Patches) => void;
};

/** Tooltips: [aligning to each other, aligning to the label]. */
const EDGES: { edge: AlignEdge; icon: typeof AlignStartVertical; titles: [string, string] }[] = [
  { edge: "left", icon: AlignStartVertical, titles: ["Align left edges", "Move to the left guide"] },
  { edge: "center", icon: AlignCenterVertical, titles: [spell("Align centers horizontally"), spell("Center horizontally on the label")] },
  { edge: "right", icon: AlignEndVertical, titles: ["Align right edges", "Move to the right guide"] },
  { edge: "top", icon: AlignStartHorizontal, titles: ["Align top edges", "Move to the top guide"] },
  { edge: "middle", icon: AlignCenterHorizontal, titles: [spell("Align centers vertically"), spell("Center vertically on the label")] },
  { edge: "bottom", icon: AlignEndHorizontal, titles: ["Align bottom edges", "Move to the bottom guide"] },
];

/**
 * Align and distribute. With one element it lines up with the label; with
 * several, with each other (the selection's bounds) or with the label. On the
 * label, edges line up with the safe-margin guide, where snapping puts them.
 * One element can also be stretched to fill the guides.
 */
export function AlignControls({ els, label, onApply }: Props) {
  const [relativeTo, setRelativeTo] = useState<"selection" | "label">("selection");
  const toLabel = els.length === 1 || relativeTo === "label";
  const labelBox: Box = safeArea(label, label.margin);
  const target = toLabel ? labelBox : union(els.map(bounds));
  // Spreading needs two fixed ends: the label's edges, or the outer two of three or more.
  const canDistribute = toLabel ? els.length >= 2 : els.length >= 3;

  return (
    <div className="align-controls">
      {els.length > 1 && (
        <Segmented
          value={relativeTo}
          onChange={setRelativeTo}
          options={[
            { value: "selection", label: "To each other" },
            { value: "label", label: "To the label" },
          ]}
        />
      )}
      <div className="align-row">
        {EDGES.map(({ edge, icon: Icon, titles }) => (
          <button key={edge} className="icon-button" title={titles[toLabel ? 1 : 0]} onClick={() => onApply(align(els, edge, target))}>
            <Icon size={17} />
          </button>
        ))}
      </div>
      {els.length === 1 && (
        <div className="fill-row">
          <button className="button ghost" title="Grow to fill the label up to the guides" onClick={() => onApply({ [els[0].id]: fill(els[0], labelBox, "both") })}>
            <Maximize size={15} /> Fill
          </button>
          <button className="button ghost" title="Stretch across the label, guide to guide" onClick={() => onApply({ [els[0].id]: fill(els[0], labelBox, "width") })}>
            <MoveHorizontal size={15} /> Width
          </button>
          <button className="button ghost" title="Stretch down the label, guide to guide" onClick={() => onApply({ [els[0].id]: fill(els[0], labelBox, "height") })}>
            <MoveVertical size={15} /> Height
          </button>
        </div>
      )}
      {els.length > 1 && (
        <div className="distribute">
          <button
            className="button ghost"
            disabled={!canDistribute}
            title={canDistribute ? "Equal gaps from left to right" : "Select three or more to distribute"}
            onClick={() => onApply(distribute(els, "horizontal", toLabel ? labelBox : undefined))}
          >
            <AlignHorizontalSpaceBetween size={16} /> Distribute horizontally
          </button>
          <button
            className="button ghost"
            disabled={!canDistribute}
            title={canDistribute ? "Equal gaps from top to bottom" : "Select three or more to distribute"}
            onClick={() => onApply(distribute(els, "vertical", toLabel ? labelBox : undefined))}
          >
            <AlignVerticalSpaceBetween size={16} /> Distribute vertically
          </button>
        </div>
      )}
    </div>
  );
}

/** Panel shown when several elements are selected. */
export function MultiSelection({ els, label, onApply, onDuplicate, onDelete }: Props & { onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div className="inspector">
      <div className="inspector-head">
        <h2>{els.length} selected</h2>
        <div className="row-actions">
          <button className="icon-button" title="Duplicate (Ctrl+D)" onClick={onDuplicate}>
            <Copy size={16} />
          </button>
          <button className="icon-button danger" title="Delete (Del)" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="field">
        <span>Align</span>
        <AlignControls els={els} label={label} onApply={onApply} />
      </div>
      <p className="muted hint">
        Shift-click to add or remove items, or drag a box around them from an empty part of the label. Drag any selected item to move them
        together.
      </p>
    </div>
  );
}
