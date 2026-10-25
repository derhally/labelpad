import { Download, ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RELEASES_URL, type UpdateState } from "../updates/useUpdater";

type Props = {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
};

/** Asks before updating: "Update now" downloads and restarts, "Later" waits for next week's check. */
export function UpdateDialog({ state, onInstall, onDismiss }: Props) {
  if (state.step !== "available" && state.step !== "downloading" && state.step !== "restarting") return null;
  const working = state.step !== "available";
  const update = state.step === "restarting" ? null : state.update;

  return (
    <div className="backdrop" onClick={working ? undefined : onDismiss}>
      <div className="dialog" role="dialog" aria-labelledby="update-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <h2 id="update-title">{update ? `LabelPad ${update.version} is available` : "Restarting…"}</h2>
            {state.step === "available" && <p className="muted">You have version {state.current}.</p>}
          </div>
          {!working && (
            <button className="icon-button" onClick={onDismiss} aria-label="Later">
              <X size={18} />
            </button>
          )}
        </header>

        <div className="settings">
          {update?.body && <div className="release-notes">{plainNotes(update.body)}</div>}

          {state.step === "available" && !state.canInstall && (
            <p className="muted hint">This copy was installed from a .deb or .rpm package, so download the new package to update.</p>
          )}

          {state.step === "downloading" ? (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${state.percent ?? 100}%` }} />
              <span>{state.percent === null ? "Downloading…" : `Downloading… ${Math.round(state.percent)}%`}</span>
            </div>
          ) : state.step === "available" ? (
            <div className="dialog-actions">
              <button className="button ghost" onClick={onDismiss}>
                Later
              </button>
              {state.canInstall ? (
                <button className="button primary" onClick={onInstall}>
                  <Download size={16} /> Update now
                </button>
              ) : (
                <button className="button primary" onClick={() => void openUrl(RELEASES_URL)}>
                  <ExternalLink size={16} /> Open download page
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Release notes are Markdown from the changelog; show them as plain text without commit links. */
function plainNotes(md: string): string {
  return md
    .replace(/\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
