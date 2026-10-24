import { useCallback, useEffect, useState } from "react";
import { Bluetooth, FilePlus2, FolderOpen, LayoutTemplate, Printer, Redo2, Save, Settings as SettingsIcon, Undo2, Unplug } from "lucide-react";
import { DevicePicker } from "./components/DevicePicker";
import { EditorStage } from "./components/EditorStage";
import { IconPicker } from "./components/IconPicker";
import { Inspector } from "./components/Inspector";
import { LabelSettings } from "./components/LabelSettings";
import { PrinterBadge } from "./components/PrinterBadge";
import { PrintPanel } from "./components/PrintPanel";
import { SaveTemplateDialog } from "./components/SaveTemplateDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { TemplateGallery } from "./components/TemplateGallery";
import { fromTemplate, saveTemplate } from "./editor/templates";
import { Toolbar } from "./components/Toolbar";
import { makeElement, starterDoc } from "./editor/defaults";
import { importImage, pickImageFile } from "./editor/importImage";
import { renderLabel, type RenderIssues } from "./editor/render";
import { newId, type ElementType, type LabelElement } from "./editor/types";
import { useDocument } from "./editor/useDocument";
import { loadDraft, useLabelFile } from "./editor/useLabelFile";
import { loadSettings, useSettings } from "./settings/useSettings";
import type { LabelDoc } from "./editor/types";
import { canvasSize, DOTS_PER_MM } from "./printer/label";
import { usePrinter } from "./printer/usePrinter";

/** Where the icon picker's choice goes: a new element, or an existing icon. */
type IconTarget = { mode: "add" } | { mode: "replace"; id: string };

/** What the editor opens with: the last label if it was kept, otherwise the starter label. */
function initialDocument() {
  const draft = loadSettings().restoreLast ? loadDraft() : null;
  return draft ?? { doc: starterDoc(), path: null, dirty: false };
}

export function App() {
  const printer = usePrinter();
  const { status, details } = printer;
  const { settings, update: updateSettings } = useSettings();
  const [initial] = useState(initialDocument);
  const editor = useDocument(initial.doc);
  const { doc } = editor;
  const file = useLabelFile(editor, {
    initialPath: initial.path,
    initialDirty: initial.dirty,
  });
  const blankDoc: LabelDoc = { version: 1, size: settings.labelSize, elements: [] };
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  const startFrom = async (template: LabelDoc) => {
    setGalleryOpen(false);
    if (await file.newFile(fromTemplate(template))) setSelectedId(null);
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<RenderIssues>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [iconTarget, setIconTarget] = useState<IconTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const density = settings.density ?? details.densityDefault;
  const copies = settings.copies;
  const setDensity = (d: number) => updateSettings({ density: d });
  const setCopies = (c: number) => updateSettings({ copies: c });

  const printhead = details.printheadPixels ?? 96;
  const dots = canvasSize(doc.size, printhead);
  const selected = doc.elements.find((e) => e.id === selectedId) ?? null;
  const connected = status === "connected" || status === "printing";

  // Keep the saved darkness within what this printer supports.
  useEffect(() => {
    if (settings.density !== null && (settings.density < details.densityMin || settings.density > details.densityMax)) {
      updateSettings({ density: Math.min(Math.max(settings.density, details.densityMin), details.densityMax) });
    }
  }, [settings.density, details.densityMin, details.densityMax, updateSettings]);

  // New labels start at the size you used last.
  useEffect(() => {
    updateSettings({ labelSize: doc.size });
  }, [doc.size, updateSettings]);

  // Forget the selection if its element was undone away.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const onRendered = useCallback((_canvas: HTMLCanvasElement, found: RenderIssues) => setIssues(found), []);

  const connect = () => {
    setPickerOpen(true);
    printer.startScan().catch(() => setPickerOpen(false));
  };

  const closePicker = () => {
    setPickerOpen(false);
    printer.stopScan();
  };

  // Render again at print time so dates and times are current.
  const print = useCallback(async () => {
    if (status !== "connected") return;
    const canvas = document.createElement("canvas");
    await renderLabel(canvas, dots.width, dots.height, doc.elements, new Date());
    printer.print(canvas, { density, copies }).catch(() => undefined);
  }, [printer, status, density, copies, dots.width, dots.height, doc.elements]);

  const clock = useMinuteClock(doc.elements.some((e) => e.type === "datetime"));

  const addElement = (el: LabelElement) => {
    editor.add(el);
    setSelectedId(el.id);
  };

  const addImage = async (replaceId?: string) => {
    const file = await pickImageFile();
    if (!file) return;
    const { src, name, aspect } = await importImage(file);
    if (replaceId) {
      editor.update(replaceId, { src, name } as Partial<LabelElement>);
      return;
    }
    const height = dots.height - 8;
    const width = Math.min(dots.width - 8, Math.round(height * aspect));
    addElement(makeElement("image", dots, { src, name, width, height: Math.round(width / aspect), x: 4, y: Math.round((dots.height - width / aspect) / 2) } as Partial<LabelElement>));
  };

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
    if (!selected) return;
    const copy = { ...selected, id: newId(), x: selected.x + DOTS_PER_MM, y: selected.y + DOTS_PER_MM };
    editor.add(copy);
    setSelectedId(copy.id);
  }, [selected, editor]);

  const remove = useCallback(() => {
    if (!selected) return;
    editor.remove(selected.id);
    setSelectedId(null);
  }, [selected, editor]);

  // Keyboard shortcuts, ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        void (e.shiftKey ? file.saveAs() : file.saveFile());
      } else if (mod && key === "o") {
        e.preventDefault();
        void file.openFile();
      } else if (mod && key === "n") {
        e.preventDefault();
        setGalleryOpen(true);
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
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? DOTS_PER_MM : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        editor.update(selected.id, { x: selected.x + dx, y: selected.y + dy });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, file, selected, duplicate, remove, print]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <Printer size={18} />
          </span>
          Niimbot Studio
          <span className="doc-title" title={file.path ?? undefined}>
            {file.title}
            {file.dirty && <span className="dirty" aria-label="Unsaved changes" />}
          </span>
        </div>
        <div className="topbar-center">
          <button className="icon-button" onClick={() => setGalleryOpen(true)} title="New label (Ctrl+N)">
            <FilePlus2 size={18} />
          </button>
          <button className="icon-button" onClick={() => void file.openFile()} title="Open (Ctrl+O)">
            <FolderOpen size={18} />
          </button>
          <button className="icon-button" onClick={() => void file.saveFile()} title="Save (Ctrl+S)">
            <Save size={18} />
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
        </div>
        <div className="topbar-actions">
          <PrinterBadge status={status} name={details.deviceName ?? details.model} battery={printer.battery} />
          {connected ? (
            <button className="button ghost" onClick={printer.disconnect} disabled={status === "printing"}>
              <Unplug size={16} /> Disconnect
            </button>
          ) : (
            <button className="button primary" onClick={connect} disabled={status === "connecting"}>
              <Bluetooth size={16} /> Connect printer
            </button>
          )}
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings">
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <Toolbar onAdd={add} />

        <EditorStage
          elements={doc.elements}
          width={dots.width}
          height={dots.height}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={editor.update}
          onGestureStart={editor.checkpoint}
          onEditText={() => document.getElementById("inspector-text")?.focus()}
          onRendered={onRendered}
          clock={clock}
        />

        <aside className="panel">
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
              />
            ) : (
              <LabelSettings size={doc.size} printableMm={printhead / DOTS_PER_MM} onChange={editor.setSize} />
            )}
          </div>
          <PrintPanel printer={printer} density={density} copies={copies} onDensity={setDensity} onCopies={setCopies} onPrint={print} onConnect={connect} />
        </aside>
      </main>

      <DevicePicker
        open={pickerOpen}
        printers={printer.found}
        lastPrinterId={settings.lastPrinter?.id}
        onClose={closePicker}
        onPick={async (p) => {
          setPickerOpen(false);
          if (await printer.connect(p)) updateSettings({ lastPrinter: { id: p.id, name: p.name } });
        }}
      />
      <TemplateGallery open={galleryOpen} blank={blankDoc} onPick={(d) => void startFrom(d)} onClose={() => setGalleryOpen(false)} />
      <SaveTemplateDialog
        open={saveTemplateOpen}
        defaultName={file.path ? file.title : ""}
        onSave={async (name) => void (await saveTemplate(name, doc))}
        onClose={() => setSaveTemplateOpen(false)}
      />
      <SettingsDialog open={settingsOpen} settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />
      <IconPicker open={iconTarget !== null} onPick={pickIcon} onClose={() => setIconTarget(null)} />
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
