import { Monitor, Moon, Sun, X } from "lucide-react";
import type { Settings, Theme } from "../settings/useSettings";
import { Segmented, Toggle } from "./fields";

type Props = {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
};

const THEMES: { value: Theme; label: React.ReactNode }[] = [
  { value: "system", label: <><Monitor size={14} /> System</> },
  { value: "light", label: <><Sun size={14} /> Light</> },
  { value: "dark", label: <><Moon size={14} /> Dark</> },
];

export function SettingsDialog({ open, settings, onChange, onClose }: Props) {
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
        </div>
      </div>
    </div>
  );
}
