import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open } from "@tauri-apps/plugin-dialog";
import { Columns2, FilePlus2, FolderOpen, Plus, Printer, Settings as SettingsIcon, Square, X } from "lucide-react";
import { ConnectButton, shortName } from "./components/ConnectButton";
import { RenamePrinterDialog } from "./components/RenamePrinterDialog";
import { DevicePicker } from "./components/DevicePicker";
import { LabelEditor, type EditorHandle, type Slots, type TabMeta } from "./components/LabelEditor";
import { PrinterBadge } from "./components/PrinterBadge";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { TemplateGallery } from "./components/TemplateGallery";
import { fromTemplate } from "./editor/templates";
import { starterDoc } from "./editor/defaults";
import { FILE_FILTERS } from "./editor/labelFile";
import { newId } from "./editor/types";
import { forgetDraft, loadDraft, readLabel, type Draft } from "./editor/useLabelFile";
import { loadSettings, useSettings } from "./settings/useSettings";
import { useUpdater } from "./updates/useUpdater";
import type { LabelDoc } from "./editor/types";
import { usePrinter } from "./printer/usePrinter";

/**
 * An open label. `fresh` marks the starter label the app opens with; it's
 * replaced by the next label you open or start, as long as you haven't changed it.
 */
type Tab = { id: string; initial: Draft; fresh?: boolean };

/** Which labels were open, kept so the next start reopens them. Each one's content is its own draft. */
type Session = { ids: string[]; active: string; split: boolean };
const SESSION_KEY = "labelpad.tabs";

function freshTab(): Tab {
  return { id: newId(), initial: { doc: starterDoc(), path: null, dirty: false }, fresh: true };
}

/** The labels the window opens with: the ones open last time if they were kept, otherwise the starter label. */
function initialSession(): { tabs: Tab[]; active: string; split: boolean } {
  if (loadSettings().restoreLast) {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
      const tabs = (s?.ids ?? []).flatMap((id): Tab[] => {
        const initial = loadDraft(id);
        return initial ? [{ id, initial }] : [];
      });
      if (tabs.length) return { tabs, active: tabs.some((t) => t.id === s!.active) ? s!.active : tabs[0].id, split: !!s?.split };
    } catch {
      // Fall through to a single label.
    }
    // The one label kept before tabs.
    const old = loadDraft();
    if (old) {
      forgetDraft();
      const tab = { id: newId(), initial: old };
      return { tabs: [tab], active: tab.id, split: false };
    }
  }
  const tab = freshTab();
  return { tabs: [tab], active: tab.id, split: false };
}

export function App() {
  const printer = usePrinter();
  const { status, details } = printer;
  const { settings, update: updateSettings } = useSettings();
  const updater = useUpdater(settings, updateSettings);
  const [session] = useState(initialSession);
  const [tabs, setTabs] = useState<Tab[]>(session.tabs);
  const [activeId, setActiveId] = useState(session.active);
  const [split, setSplit] = useState(session.split);
  const [metas, setMetas] = useState<Record<string, TabMeta>>({});
  const handles = useRef(new Map<string, EditorHandle>());
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slots, setSlots] = useState<Slots>({ actions: null, toolbar: null, panel: null });
  const slotRef = (key: keyof Slots) => (node: HTMLElement | null) => setSlots((s) => (s[key] === node ? s : { ...s, [key]: node }));
  const [slotRefs] = useState(() => ({ actions: slotRef("actions"), toolbar: slotRef("toolbar"), panel: slotRef("panel") }));

  const blankDoc: LabelDoc = { version: 1, printer: settings.printer, size: settings.labelSize, elements: [] };
  const connected = status === "connected" || status === "printing";
  const activeMeta = metas[activeId];

  const state = useRef({ tabs, activeId, metas });
  state.current = { tabs, activeId, metas };

  const onMeta = useCallback((id: string, meta: TabMeta) => setMetas((m) => ({ ...m, [id]: meta })), []);
  const onHandle = useCallback((id: string, handle: EditorHandle | null) => {
    if (handle) handles.current.set(id, handle);
    else handles.current.delete(id);
  }, []);

  // Remember which labels are open; each label keeps its own draft.
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ids: tabs.map((t) => t.id), active: activeId, split } satisfies Session));
    } catch {
      // Storage unavailable; the labels just won't reopen.
    }
  }, [tabs, activeId, split]);

  useEffect(() => {
    const text = `${activeMeta?.dirty ? "• " : ""}${activeMeta?.title ?? "Untitled"} — LabelPad`;
    document.title = text;
    getCurrentWindow().setTitle(text).catch(() => undefined);
  }, [activeMeta?.title, activeMeta?.dirty]);

  // Keep the saved darkness within what this printer supports.
  useEffect(() => {
    if (settings.density !== null && (settings.density < details.densityMin || settings.density > details.densityMax)) {
      updateSettings({ density: Math.min(Math.max(settings.density, details.densityMin), details.densityMax) });
    }
  }, [settings.density, details.densityMin, details.densityMax, updateSettings]);

  /** Open a label in a new tab, or in place of the untouched starter label. */
  const addTab = useCallback((initial: Draft) => {
    const tab: Tab = { id: newId(), initial };
    const { tabs, activeId, metas } = state.current;
    const current = tabs.find((t) => t.id === activeId);
    const replace = current?.fresh && !metas[current.id]?.dirty && !metas[current.id]?.path;
    if (replace) forgetDraft(current.id);
    setTabs(replace ? tabs.map((t) => (t.id === current.id ? tab : t)) : [...tabs, tab]);
    setActiveId(tab.id);
  }, []);

  /** Open label files, switching to any that are already open. */
  const openPaths = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        const open = state.current.tabs.find((t) => state.current.metas[t.id]?.path === path);
        if (open) {
          setActiveId(open.id);
          continue;
        }
        try {
          addTab({ doc: await readLabel(path), path, dirty: false });
        } catch (e) {
          await message(e instanceof Error ? e.message : String(e), { title: "Couldn't open label", kind: "error" });
        }
      }
    },
    [addTab],
  );

  const openFile = useCallback(async () => {
    const chosen = await open({ filters: FILE_FILTERS, multiple: true, directory: false });
    if (chosen) await openPaths(Array.isArray(chosen) ? chosen : [chosen]);
  }, [openPaths]);

  // Labels opened from the file manager: at startup, and (on macOS) while running.
  useEffect(() => {
    const take = () =>
      invoke<string[]>("opened_files_take")
        .then((paths) => openPaths(paths))
        .catch(() => undefined);
    void take();
    const off = listen("open-files", take);
    return () => void off.then((f) => f());
  }, [openPaths]);

  /** Close a tab, asking first if it has unsaved changes. The last tab is replaced by a blank label. */
  const closeTab = useCallback(async (id: string) => {
    setActiveId(id);
    if (!(await handles.current.get(id)?.confirmDiscard())) return;
    forgetDraft(id);
    const { tabs } = state.current;
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    if (!rest.length) rest.push(freshTab());
    setTabs(rest);
    setActiveId(rest[Math.min(i, rest.length - 1)].id);
  }, []);

  // Ask about each label with unsaved changes before the window closes.
  useEffect(() => {
    const off = getCurrentWindow().onCloseRequested(async (e) => {
      for (const t of state.current.tabs) {
        if (!state.current.metas[t.id]?.dirty) continue;
        setActiveId(t.id);
        if (!(await handles.current.get(t.id)?.confirmDiscard())) {
          e.preventDefault();
          return;
        }
      }
    });
    return () => void off.then((f) => f());
  }, []);

  // Window shortcuts: new, open, close and switching labels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const { tabs, activeId } = state.current;
      if (mod && key === "n") {
        e.preventDefault();
        setGalleryOpen(true);
      } else if (mod && key === "o") {
        e.preventDefault();
        void openFile();
      } else if (mod && key === "w") {
        e.preventDefault();
        void closeTab(activeId);
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === activeId);
        setActiveId(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, closeTab]);

  const startFrom = (template: LabelDoc) => {
    setGalleryOpen(false);
    addTab({ doc: fromTemplate(template), path: null, dirty: false });
  };

  /** Pick a printer from the ones the scan finds. */
  const choosePrinter = () => {
    setFinding(false);
    setPickerOpen(true);
    printer.startScan().catch(() => setPickerOpen(false));
  };

  // Quick connect: scan for the last printer and connect as soon as it shows up.
  // If it doesn't, or there isn't one yet, the picker opens instead.
  const [finding, setFinding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // While connected, the printer is the last one used, so your name for it applies.
  const connectedName = (connected && settings.lastPrinter && settings.printerNames[settings.lastPrinter.id]) || details.deviceName || details.model;
  const connect = () => {
    if (!settings.lastPrinter) return choosePrinter();
    setFinding(true);
    printer.startScan().catch(() => setFinding(false));
  };
  useEffect(() => {
    if (!finding) return;
    const last = printer.found.find((p) => p.id === settings.lastPrinter?.id);
    if (last) {
      setFinding(false);
      void printer.connect(last).then((ok) => !ok && choosePrinter());
    }
  });
  useEffect(() => {
    if (!finding) return;
    // Keep scanning; the picker shows the last printer pinned while it's looked for.
    const timer = setTimeout(() => {
      setFinding(false);
      setPickerOpen(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, [finding]);

  const closePicker = () => {
    setPickerOpen(false);
    printer.stopScan();
  };

  const [dropping, setDropping] = useState(false);
  const canDrop = (e: DragEvent) => e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/plain");

  // Content dropped on a label goes to that label; anywhere else, to the active one.
  const drop = (e: DragEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab ?? activeId;
    setActiveId(target);
    void handles.current.get(target)?.addContent(e.dataTransfer);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <Printer size={18} />
          </span>
          LabelPad
          <span className="doc-title" title={activeMeta?.path ?? undefined}>
            {activeMeta?.title ?? "Untitled"}
            {activeMeta?.dirty && <span className="dirty" aria-label="Unsaved changes" />}
          </span>
        </div>
        <div className="topbar-center">
          <button className="icon-button" onClick={() => setGalleryOpen(true)} title="New label (Ctrl+N)">
            <FilePlus2 size={18} />
          </button>
          <button className="icon-button" onClick={() => void openFile()} title="Open (Ctrl+O)">
            <FolderOpen size={18} />
          </button>
          <span className="slot" ref={slotRefs.actions} />
        </div>
        <div className="topbar-actions">
          <PrinterBadge status={status} name={connectedName} battery={printer.battery} />
          <ConnectButton
            status={status}
            finding={finding}
            lastPrinter={settings.lastPrinter ?? undefined}
            onConnect={connect}
            onDisconnect={printer.disconnect}
            onSwitch={choosePrinter}
            lastLabel={settings.lastPrinter ? (settings.printerNames[settings.lastPrinter.id] ?? shortName(settings.lastPrinter.name)) : undefined}
            onRename={() => setRenaming(settings.lastPrinter)}
          />
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings">
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      <nav className="tabbar" aria-label="Open labels">
        <div className="tabs" role="tablist">
          {tabs.map((t) => {
            const meta = metas[t.id];
            return (
              <div key={t.id} className={`tab${t.id === activeId ? " active" : ""}`} role="tab" aria-selected={t.id === activeId} title={meta?.path ?? undefined}>
                <button className="tab-name" onClick={() => setActiveId(t.id)} onAuxClick={(e) => e.button === 1 && void closeTab(t.id)}>
                  {meta?.title ?? "Untitled"}
                </button>
                {meta?.dirty && <span className="dirty" aria-label="Unsaved changes" />}
                <button className="icon-button tab-close" onClick={() => void closeTab(t.id)} title="Close (Ctrl+W)">
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <button className="icon-button" onClick={() => setGalleryOpen(true)} title="New label (Ctrl+N)">
            <Plus size={16} />
          </button>
        </div>
        <div className="view-toggle" role="radiogroup" aria-label="Show labels">
          <button className={`icon-button${split ? "" : " on"}`} role="radio" aria-checked={!split} onClick={() => setSplit(false)} title="One label at a time">
            <Square size={15} />
          </button>
          <button className={`icon-button${split ? " on" : ""}`} role="radio" aria-checked={split} onClick={() => setSplit(true)} title="Labels side by side">
            <Columns2 size={15} />
          </button>
        </div>
      </nav>

      <main
        className={`workspace${dropping ? " dropping" : ""}`}
        onDragOver={(e) => {
          if (!canDrop(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(e) => {
          setDropping(false);
          if (!canDrop(e)) return;
          e.preventDefault();
          drop(e);
        }}
      >
        <div className="slot" ref={slotRefs.toolbar} />
        <div className={`stages${split && tabs.length > 1 ? " split" : ""}`}>
          {tabs.map((t) => (
            <LabelEditor
              key={t.id}
              tabId={t.id}
              initial={t.initial}
              active={t.id === activeId}
              split={split && tabs.length > 1}
              slots={slots}
              printer={printer}
              settings={settings}
              updateSettings={updateSettings}
              onActivate={() => setActiveId(t.id)}
              onMeta={onMeta}
              onHandle={onHandle}
              onConnect={connect}
            />
          ))}
        </div>
        <aside className="panel" ref={slotRefs.panel} />
      </main>

      <DevicePicker
        open={pickerOpen}
        printers={printer.found}
        lastPrinter={settings.lastPrinter ?? undefined}
        names={settings.printerNames}
        onClose={closePicker}
        onPick={async (p) => {
          setPickerOpen(false);
          if (await printer.connect(p)) updateSettings({ lastPrinter: { id: p.id, name: p.name } });
        }}
      />
      <RenamePrinterDialog
        printer={renaming}
        current={renaming ? (settings.printerNames[renaming.id] ?? "") : ""}
        onSave={(name) => {
          if (!renaming) return;
          const rest = { ...settings.printerNames };
          delete rest[renaming.id];
          updateSettings({ printerNames: name ? { ...rest, [renaming.id]: name } : rest });
        }}
        onClose={() => setRenaming(null)}
      />
      <TemplateGallery
        open={galleryOpen}
        blank={blankDoc}
        onPick={startFrom}
        onOpen={() => {
          setGalleryOpen(false);
          void openFile();
        }}
        onClose={() => setGalleryOpen(false)}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
        update={updater.state}
        onCheckForUpdates={() => void updater.checkNow(true)}
      />
      <UpdateDialog state={updater.state} onInstall={() => void updater.install()} onDismiss={updater.dismiss} />
    </div>
  );
}
