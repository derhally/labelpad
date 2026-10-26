import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { message } from "@tauri-apps/plugin-dialog";
import { AlignCenter, AlignVerticalJustifyCenter, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Check, Copy, LayoutTemplate, Maximize, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { bounds, fill, safeArea, union } from "../editor/arrange";
import { spell } from "../locale";
import { MultiSelection } from "./AlignControls";
import { EditorStage } from "./EditorStage";
import { IconPicker } from "./IconPicker";
import { Inspector } from "./Inspector";
import { LabelSettings } from "./LabelSettings";
import { PrintPanel } from "./PrintPanel";
import { RollPanel } from "./RollPanel";
import { SaveTemplateDialog } from "./SaveTemplateDialog";
import { Toolbar } from "./Toolbar";
import { saveTemplate } from "../editor/templates";
import { makeElement } from "../editor/defaults";
import { importImage, pickImageFile } from "../editor/importImage";
import { renderLabel, type RenderIssues } from "../editor/render";
import { newId, type ElementType, type LabelDoc, type LabelElement } from "../editor/types";
import { useDocument } from "../editor/useDocument";
import { DEFAULT_COUNTER, hasCounter } from "../editor/variables";
import { useLabelFile, type Draft } from "../editor/useLabelFile";
import { startFolder } from "../editor/folders";
import type { Settings } from "../settings/useSettings";
import { canvasSize, convertDoc, printerForModel, PRINTERS, profileFor, type PrinterId } from "../printer/label";
import type { usePrinter } from "../printer/usePrinter";

/** Where the icon picker's choice goes: a new element, or an existing icon. */
type IconTarget = { mode: "add" } | { mode: "replace"; id: string };

/** What the tab strip shows for a label. */
export type TabMeta = { title: string; path: string | null; dirty: boolean };

/** What the window needs from a tab: closing it, handing it dropped content, and the agent tools. */
export type EditorHandle = {
  confirmDiscard: () => Promise<boolean>;
  addContent: (data: DataTransfer) => Promise<void>;
  agent: AgentHandle;
};

/**
 * The label as AI agents drive it (see mcp/). Changes apply at once and are
 * undoable like any other edit; errors are thrown rather than shown in dialogs.
 */
export type AgentHandle = {
  doc: () => LabelDoc;
  change: (edit: (doc: LabelDoc) => LabelDoc) => LabelDoc;
  undo: () => void;
  redo: () => void;
  file: () => TabMeta;
  saveTo: (path: string) => Promise<void>;
  print: (opts: { copies: number; density: number }) => Promise<{ pages: number }>;
};

/** Places outside the tab where the active label puts its controls. */
export type Slots = { actions: HTMLElement | null; toolbar: HTMLElement | null; panel: HTMLElement | null };

type Props = {
  tabId: string;
  initial: Draft;
  active: boolean;
  /** Side by side: every tab's label shows, and clicking one makes it active. */
  split: boolean;
  slots: Slots;
  printer: ReturnType<typeof usePrinter>;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  onActivate: () => void;
  onMeta: (tabId: string, meta: TabMeta) => void;
  onHandle: (tabId: string, handle: EditorHandle | null) => void;
  onConnect: () => void;
};

/**
 * One open label: its document, undo history, selection and file. The label
 * itself always renders here; while the tab is active its tools, panel and
 * file buttons render into the window's slots.
 */
export function LabelEditor({ tabId, initial, active, split, slots, printer, settings, updateSettings, onActivate, onMeta, onHandle, onConnect }: Props) {
  const { status, details } = printer;
  const editor = useDocument(initial.doc);
  const { doc } = editor;
  const file = useLabelFile(editor, {
    tabId,
    initialPath: initial.path,
    initialDirty: initial.dirty,
    folders: { start: () => startFolder(settings), saved: (lastFolder) => updateSettings({ lastFolder }) },
  });
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [issues, setIssues] = useState<RenderIssues>({});
  const [iconTarget, setIconTarget] = useState<IconTarget | null>(null);
  const [menu, setMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const density = settings.density ?? details.densityDefault;
  const copies = settings.copies;

  const profile = profileFor(doc);
  const dots = canvasSize(doc.size, profile);
  const mmStep = Math.round(profile.dotsPerMm);
  /** The label and its safe-margin guide, 1 mm in. */
  const guides = { ...dots, margin: mmStep };
  const selection = doc.elements.filter((e) => selectedIds.includes(e.id));
  const selected = selection.length === 1 ? selection[0] : null;
  const connected = status === "connected" || status === "printing";
  // The connected printer's layout, when it differs from the label's.
  const connectedPrinter = connected ? printerForModel(details.model) : undefined;
  const otherPrinter = connectedPrinter && connectedPrinter !== profile.id ? connectedPrinter : undefined;

  useEffect(() => onMeta(tabId, { title: file.title, path: file.path, dirty: file.dirty }), [onMeta, tabId, file.title, file.path, file.dirty]);

  const setPrinter = useCallback((printer: PrinterId) => editor.replace(convertDoc(doc, printer)), [editor, doc]);

  // An empty label just switches to the printer you connect, at its usual size.
  useEffect(() => {
    if (!active || !otherPrinter || doc.elements.length) return;
    const { widthMm, lengthMm } = PRINTERS[otherPrinter].presets[0];
    editor.replace({ ...doc, printer: otherPrinter, size: { widthMm, lengthMm } });
  }, [active, otherPrinter, doc, editor]);

  // New labels start at the size and printer you used last.
  useEffect(() => {
    if (active) updateSettings({ labelSize: doc.size, printer: profile.id });
  }, [active, doc.size, profile.id, updateSettings]);

  // Forget selected elements that were undone away.
  useEffect(() => {
    if (selection.length !== selectedIds.length) setSelectedIds(selection.map((e) => e.id));
  }, [selection, selectedIds]);

  const onRendered = useCallback((_canvas: HTMLCanvasElement, found: RenderIssues) => setIssues(found), []);

  const numbered = hasCounter(doc);
  const counter = doc.counter ?? DEFAULT_COUNTER;

  // Render again at print time so dates and times are current. Numbered
  // labels render once per number and print as separate pages.
  // A label laid out for another printer is converted for the connected one.
  const printLabel = useCallback(
    async ({ copies, density }: { copies: number; density: number }) => {
      if (status !== "connected") throw new Error(status === "printing" ? "The printer is busy printing." : "No printer is connected.");
      const now = new Date();
      const job = otherPrinter ? convertDoc(doc, otherPrinter) : doc;
      const size = canvasSize(job.size, profileFor(job));
      const render = async (count: number) => {
        const canvas = document.createElement("canvas");
        await renderLabel(canvas, size.width, size.height, job.elements, now, { count });
        return canvas;
      };
      if (numbered) {
        const pages = await Promise.all(Array.from({ length: copies }, (_, i) => render(counter.start + i * counter.step)));
        await printer.print(pages, { density, copies: 1 });
        // The next print carries on from here.
        editor.setCounter({ ...counter, start: counter.start + copies * counter.step });
      } else {
        await printer.print([await render(counter.start)], { density, copies });
      }
      return { pages: copies };
    },
    [printer, editor, status, doc, otherPrinter, numbered, counter],
  );

  // The print panel shows any error.
  const print = useCallback(() => printLabel({ copies, density }).then(() => true, () => false), [printLabel, copies, density]);

  const clock = useMinuteClock(doc.elements.some((e) => e.type === "datetime"));

  const addElement = (el: LabelElement) => {
    editor.add(el);
    setSelectedId(el.id);
  };

  /** Add an image file as a new element, as large as fits the label, or put it into an existing one. */
  const addImageFile = async (file: File, replaceId?: string) => {
    const { src, name, aspect } = await importImage(file);
    if (replaceId) {
      editor.update(replaceId, { src, name } as Partial<LabelElement>);
      return;
    }
    const width = Math.min(dots.width - 8, Math.round((dots.height - 8) * aspect));
    const height = Math.round(width / aspect);
    addElement(
      makeElement("image", dots, { src, name, width, height, x: Math.round((dots.width - width) / 2), y: Math.round((dots.height - height) / 2) } as Partial<LabelElement>),
    );
  };

  const addImage = async (replaceId?: string) => {
    const file = await pickImageFile();
    if (file) await addImageFile(file, replaceId);
  };

  /** Dropped or pasted content: an image becomes an image element, text becomes a text box. */
  const addContent = async (data: DataTransfer) => {
    const files = [...data.files];
    try {
      const image = files.find((f) => f.type.startsWith("image/"));
      if (image) return await addImageFile(image);
      const textFile = files.find((f) => f.type.startsWith("text/") || /\.txt$/i.test(f.name));
      const text = (textFile ? await textFile.text() : data.getData("text/plain")).trim();
      if (text) return addElement(makeElement("text", dots, { text } as Partial<LabelElement>));
      if (files.length) throw new Error(`LabelPad can't add ${files[0].name}. Use an image or a text file.`);
    } catch (e) {
      void message(e instanceof Error ? e.message : String(e), { title: "Couldn't add that", kind: "error" });
    }
  };
  const addContentRef = useRef(addContent);
  addContentRef.current = addContent;

  // The agent's view of this label always reads the latest render.
  const live = useRef({ editor, file, printLabel });
  live.current = { editor, file, printLabel };
  const [agent] = useState<AgentHandle>(() => ({
    doc: () => live.current.editor.doc,
    // flushSync renders the change before returning, so the next call sees it.
    change: (edit) => {
      const next = edit(live.current.editor.doc);
      flushSync(() => live.current.editor.replace(next));
      return next;
    },
    undo: () => flushSync(() => live.current.editor.undo()),
    redo: () => flushSync(() => live.current.editor.redo()),
    file: () => ({ title: live.current.file.title, path: live.current.file.path, dirty: live.current.file.dirty }),
    saveTo: (path) => live.current.file.saveTo(path),
    print: (opts) => live.current.printLabel(opts),
  }));

  useEffect(() => {
    onHandle(tabId, { confirmDiscard: file.confirmDiscard, addContent: (data) => addContentRef.current(data), agent });
    return () => onHandle(tabId, null);
  }, [onHandle, tabId, file.confirmDiscard, agent]);

  // Paste an image or text onto the active label, unless a field has focus.
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (typing || !e.clipboardData) return;
      e.preventDefault();
      void addContentRef.current(e.clipboardData);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [active]);

  const add = (type: ElementType) => {
    if (type === "image") return void addImage();
    if (type === "icon") return setIconTarget({ mode: "add" });
    addElement(makeElement(type, dots));
  };

  const pickIcon = (icon: string) => {
    if (iconTarget?.mode === "replace") editor.update(iconTarget.id, { icon } as Partial<LabelElement>);
    else addElement(makeElement("icon", dots, { icon } as Partial<LabelElement>));
    setIconTarget(null);
  };

  const duplicate = useCallback(() => {
    if (!selection.length) return;
    const copies = selection.map((el) => ({ ...el, id: newId(), x: el.x + mmStep, y: el.y + mmStep }));
    editor.addMany(copies);
    setSelectedIds(copies.map((c) => c.id));
  }, [selection, editor, mmStep]);

  const remove = useCallback(() => {
    if (!selection.length) return;
    editor.removeMany(selection.map((e) => e.id));
    setSelectedIds([]);
  }, [selection, editor]);

  // Keyboard shortcuts for the active label, ignored while typing in a field.
  // New, open, close and switching tabs belong to the window.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (mod && key === "z" && !typing) {
        e.preventDefault();
        e.shiftKey ? editor.redo() : editor.undo();
      } else if (mod && key === "y" && !typing) {
        e.preventDefault();
        editor.redo();
      } else if (mod && key === "p") {
        e.preventDefault();
        print();
      } else if (typing) {
        return;
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod && key === "a") {
        e.preventDefault();
        setSelectedIds(doc.elements.map((el) => el.id));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection.length) {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") {
        setSelectedIds([]);
      } else if (selection.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? mmStep : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        editor.updateMany(Object.fromEntries(selection.map((el) => [el.id, { x: el.x + dx, y: el.y + dy }])));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, editor, file, doc.elements, selection, duplicate, remove, print, mmStep]);

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1400);
    return () => clearTimeout(t);
  }, [justSaved]);
  const save = async (as: boolean) => {
    if (await (as ? file.saveAs() : file.saveFile())) setJustSaved(true);
  };

  /** Right-click menu for some items: copy, delete, stacking, and centering on the label. */
  const menuItems = (ids: string[]): MenuItem[] => {
    const els = doc.elements.filter((e) => ids.includes(e.id));
    // Stacking moves each item in turn; going up, start from the topmost so they keep their order.
    const stack = (to: "up" | "down" | "top" | "bottom") => {
      const ordered = doc.elements.filter((e) => ids.includes(e.id));
      (to === "up" || to === "top" ? [...ordered].reverse() : ordered).forEach((e) => editor.reorder(e.id, to));
    };
    // Center the items as a group, keeping their spacing.
    const centre = (edge: "center" | "middle") => {
      const group = union(els.map(bounds));
      const label = { left: 0, top: 0, right: dots.width, bottom: dots.height };
      const target = edge === "center"
        ? { ...group, left: (label.right - (group.right - group.left)) / 2, right: (label.right + (group.right - group.left)) / 2 }
        : { ...group, top: (label.bottom - (group.bottom - group.top)) / 2, bottom: (label.bottom + (group.bottom - group.top)) / 2 };
      const shift = edge === "center" ? target.left - group.left : target.top - group.top;
      editor.updateMany(Object.fromEntries(els.map((e) => [e.id, edge === "center" ? { x: Math.round(e.x + shift) } : { y: Math.round(e.y + shift) }])));
    };
    return [
      { label: "Duplicate", icon: <Copy size={15} />, shortcut: "Ctrl D", onSelect: duplicate },
      "separator",
      { label: "Bring to front", icon: <ArrowUpToLine size={15} />, onSelect: () => stack("top") },
      { label: "Bring forward", icon: <ArrowUp size={15} />, onSelect: () => stack("up") },
      { label: "Send backward", icon: <ArrowDown size={15} />, onSelect: () => stack("down") },
      { label: "Send to back", icon: <ArrowDownToLine size={15} />, onSelect: () => stack("bottom") },
      "separator",
      { label: spell("Center horizontally"), icon: <AlignCenter size={15} />, onSelect: () => centre("center") },
      { label: spell("Center vertically"), icon: <AlignVerticalJustifyCenter size={15} />, onSelect: () => centre("middle") },
      ...(els.length === 1
        ? [{ label: "Fill to guides", icon: <Maximize size={15} />, onSelect: () => editor.updateMany({ [els[0].id]: fill(els[0], safeArea(dots, mmStep), "both") }) }]
        : []),
      "separator",
      { label: "Delete", icon: <Trash2 size={15} />, shortcut: "Del", danger: true, onSelect: remove },
    ];
  };

  const actions = (
    <>
      <button className={`icon-button${justSaved ? " done" : ""}`} onClick={() => void save(false)} title={justSaved ? "Saved" : "Save (Ctrl+S)"}>
        {justSaved ? <Check size={18} /> : <Save size={18} />}
      </button>
      <button className="icon-button" onClick={() => setSaveTemplateOpen(true)} title="Save as template">
        <LayoutTemplate size={18} />
      </button>
      <span className="divider" />
      <button className="icon-button" onClick={editor.undo} disabled={!editor.canUndo} title="Undo (Ctrl+Z)">
        <Undo2 size={18} />
      </button>
      <button className="icon-button" onClick={editor.redo} disabled={!editor.canRedo} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={18} />
      </button>
    </>
  );

  const panel = (
    <>
      <div className="panel-scroll">
        {selected ? (
          <Inspector
            key={selected.id}
            el={selected}
            issue={issues[selected.id]}
            onChange={(patch, opts) => editor.update(selected.id, patch, opts)}
            onCheckpoint={editor.checkpoint}
            onDuplicate={duplicate}
            onDelete={remove}
            onReorder={(to) => editor.reorder(selected.id, to)}
            onPickIcon={() => setIconTarget({ mode: "replace", id: selected.id })}
            onReplaceImage={() => void addImage(selected.id)}
            label={guides}
            onArrange={editor.updateMany}
          />
        ) : selection.length > 1 ? (
          <MultiSelection els={selection} label={guides} onApply={editor.updateMany} onDuplicate={duplicate} onDelete={remove} />
        ) : (
          <LabelSettings size={doc.size} profile={profile} onChange={editor.setSize} onPrinter={setPrinter} connectedPrinter={connectedPrinter} />
        )}
      </div>
      {printer.roll && connected && (
        <RollPanel
          key={printer.roll.barcode || printer.roll.uuid}
          roll={printer.roll}
          knownSize={settings.rollSizes[printer.roll.barcode || printer.roll.uuid]}
          labelSize={doc.size}
          presets={profile.presets}
          onUseSize={editor.setSize}
          onRemember={(size) => {
            const key = printer.roll!.barcode || printer.roll!.uuid;
            updateSettings({ rollSizes: { ...settings.rollSizes, [key]: size } });
            editor.setSize(size);
          }}
        />
      )}
      <PrintPanel
        mismatch={otherPrinter && { label: profile.name, printer: PRINTERS[otherPrinter].name, onConvert: () => setPrinter(otherPrinter) }}
        numbering={numbered ? { ...counter, onChange: editor.setCounter } : undefined}
        printer={printer}
        density={density}
        copies={copies}
        onDensity={(d) => updateSettings({ density: d })}
        onCopies={(c) => updateSettings({ copies: c })}
        onPrint={print}
        onConnect={onConnect}
      />
    </>
  );

  return (
    <div
      className={`tab-stage${active ? " active" : ""}`}
      data-tab={tabId}
      hidden={!active && !split}
      // Clicking a label in the side-by-side view makes it the one you're editing.
      onPointerDownCapture={active ? undefined : onActivate}
    >
      {split && (
        <div className="tab-stage-title">
          {file.title}
          {file.dirty && <span className="dirty" aria-label="Unsaved changes" />}
        </div>
      )}
      <EditorStage
        elements={doc.elements}
        width={dots.width}
        height={dots.height}
        margin={mmStep}
        selectedIds={active ? selectedIds : []}
        onSelect={setSelectedIds}
        onChangeMany={editor.updateMany}
        onChange={editor.update}
        onGestureStart={editor.checkpoint}
        onEditText={() => document.getElementById("inspector-text")?.focus()}
        onContextMenu={(ids, x, y) => setMenu({ ids, x, y })}
        onRendered={onRendered}
        clock={clock}
        count={counter.start}
        dotsPerMm={profile.dotsPerMm}
        zoomLevel={settings.zoom}
        onZoom={(zoom) => updateSettings({ zoom })}
      />
      {active && slots.actions && createPortal(actions, slots.actions)}
      {active && slots.toolbar && createPortal(<Toolbar onAdd={add} />, slots.toolbar)}
      {active && slots.panel && createPortal(panel, slots.panel)}
      {active && menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ids)} onClose={closeMenu} />}
      {active && (
        <>
          <SaveTemplateDialog
            open={saveTemplateOpen}
            defaultName={file.path ? file.title : ""}
            onSave={async (name) => void (await saveTemplate(name, doc))}
            onClose={() => setSaveTemplateOpen(false)}
          />
          <IconPicker open={iconTarget !== null} onPick={pickIcon} onClose={() => setIconTarget(null)} />
        </>
      )}
    </div>
  );
}

/** A number that changes at the start of every minute while `enabled`. */
function useMinuteClock(enabled: boolean): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setMinute(Math.floor(Date.now() / 60000));
      timer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [enabled]);
  return enabled ? minute : 0;
}
