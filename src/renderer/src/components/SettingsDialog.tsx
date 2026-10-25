import { Monitor, Moon, RefreshCw, Sun, X } from "lucide-react";
import type { Settings, Theme } from "../settings/useSettings";
import type { UpdateState } from "../updates/useUpdater";
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
  if (!open) return null;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="settings">
          <div className="field">
            <span>Appearance</span>
            <Segmented value={settings.theme} onChange={(theme) => onChange({ theme })} options={THEMES} />
          </div>

          <div className="field">
            <span>Startup</span>
            <Toggle checked={settings.restoreLast} onChange={(restoreLast) => onChange({ restoreLast })}>
              Reopen the label I was working on
            </Toggle>
          </div>

          <div className="field">
            <span>Printer</span>
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
          </div>

          <div className="field">
            <span>Updates</span>
            <Toggle checked={settings.autoUpdate} onChange={(autoUpdate) => onChange({ autoUpdate })}>
              Check for new versions once a week
            </Toggle>
            <div className="settings-row">
              <span className="muted hint">{updateStatus(update, settings.lastUpdateCheck)}</span>
              <button className="button ghost" onClick={onCheckForUpdates} disabled={update.step === "checking" || update.step === "downloading"}>
                <RefreshCw size={14} /> Check now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
