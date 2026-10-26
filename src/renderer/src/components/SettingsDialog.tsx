import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { defaultLabelsFolder } from "../editor/folders";
import { ExternalLink, FolderOpen, Monitor, Moon, Printer, RefreshCw, Sun, X } from "lucide-react";
import type { Settings, Theme } from "../settings/useSettings";
import { RELEASES_URL, type UpdateState } from "../updates/useUpdater";
import { Segmented, Toggle } from "./fields";

type Props = {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  update: UpdateState;
  onCheckForUpdates: () => void;
};

const THEMES: { value: Theme; label: React.ReactNode }[] = [
  { value: "system", label: <><Monitor size={14} /> System</> },
  { value: "light", label: <><Sun size={14} /> Light</> },
  { value: "dark", label: <><Moon size={14} /> Dark</> },
];

export function SettingsDialog({ open, settings, onChange, onClose, update, onCheckForUpdates }: Props) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(null));
  }, []);
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);
  useEffect(() => {
    if (open) defaultLabelsFolder().then(setDefaultFolder, () => setDefaultFolder(null));
  }, [open]);

  /** Pick a new save folder. Saves start there until you save somewhere else. */
  const chooseFolder = async () => {
    const chosen = await pickFolder({ directory: true, defaultPath: settings.saveFolder ?? defaultFolder ?? undefined });
    if (typeof chosen === "string") onChange({ saveFolder: chosen, lastFolder: null });
  };

  if (!open) return null;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog settings-dialog" role="dialog" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="settings">
          <Section title="Appearance" description="Follow your system, or always use light or dark.">
            <Segmented value={settings.theme} onChange={(theme) => onChange({ theme })} options={THEMES} />
          </Section>

          <Section title="Startup" description="What LabelPad shows when it opens.">
            <Toggle checked={settings.restoreLast} onChange={(restoreLast) => onChange({ restoreLast })}>
              Reopen the label I was working on
            </Toggle>
            <Toggle checked={settings.showStart} onChange={(showStart) => onChange({ showStart })}>
              Show the start screen with recent labels
            </Toggle>
          </Section>

          <Section title="Saving" description="Where new labels are saved.">
            <div className="settings-row">
              <span className="settings-path" title={settings.saveFolder ?? defaultFolder ?? undefined}>
                {settings.saveFolder ?? defaultFolder ?? "Documents\\LabelPad"}
              </span>
              <span className="settings-row-buttons">
                {settings.saveFolder && (
                  <button className="button ghost" onClick={() => onChange({ saveFolder: null, lastFolder: null })}>
                    Use default
                  </button>
                )}
                <button className="button ghost" onClick={() => void chooseFolder()}>
                  <FolderOpen size={14} /> Change…
                </button>
              </span>
            </div>
            <Toggle checked={settings.rememberLastFolder} onChange={(rememberLastFolder) => onChange({ rememberLastFolder })}>
              Start in the last folder I saved to
            </Toggle>
          </Section>

          <Section title="Printer"description="Quick connect uses the last printer you printed with.">
            {settings.lastPrinter ? (
              <div className="settings-row">
                <span>
                  Last used: <strong>{settings.lastPrinter.name}</strong>
                </span>
                <button className="button ghost" onClick={() => onChange({ lastPrinter: null })}>
                  Forget
                </button>
              </div>
            ) : (
              <p className="muted hint">No printer connected yet.</p>
            )}
          </Section>

          <Section title="Updates" description="LabelPad always asks before installing anything.">
            <Toggle checked={settings.autoUpdate} onChange={(autoUpdate) => onChange({ autoUpdate })}>
              Check for new versions once a week
            </Toggle>
            <div className="settings-row">
              <span className="muted hint">{updateStatus(update, settings.lastUpdateCheck)}</span>
              <button className="button ghost" onClick={onCheckForUpdates} disabled={update.step === "checking" || update.step === "downloading"}>
                <RefreshCw size={14} /> Check now
              </button>
            </div>
          </Section>
        </div>

        <footer className="settings-about">
          <span className="logo">
            <Printer size={18} />
          </span>
          <div className="settings-about-text">
            <strong>LabelPad</strong>
            <span className="muted">{version ? `Version ${version}` : "Version unknown"}</span>
          </div>
          <button className="button ghost" onClick={() => void openUrl(RELEASES_URL)}>
            Release notes <ExternalLink size={14} />
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-section-label">
        <h3>{title}</h3>
        <p className="muted hint">{description}</p>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function updateStatus(update: UpdateState, lastCheck: number | null): string {
  if (update.step === "checking") return "Checking…";
  if (update.step === "current") return `You have the latest version (${update.version}).`;
  if (update.step === "available") return `Version ${update.update.version} is available.`;
  if (update.step === "error") return update.message;
  if (!lastCheck) return "Not checked yet.";
  return `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(lastCheck)}.`;
}
