import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { Settings } from "../settings/useSettings";

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** How often to see whether a week has passed, for an app left open for days. */
const TICK = 6 * 60 * 60 * 1000;

export const RELEASES_URL = "https://github.com/derhally/labelpad/releases/latest";

export type UpdateState =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "current"; version: string }
  | { step: "available"; update: Update; current: string; canInstall: boolean }
  | { step: "downloading"; update: Update; percent: number | null }
  | { step: "restarting" }
  | { step: "error"; message: string };

/**
 * Checks GitHub releases for a newer LabelPad at most once a week (when
 * enabled), or whenever asked. Nothing downloads until the user confirms.
 */
export function useUpdater(settings: Settings, updateSettings: (patch: Partial<Settings>) => void) {
  const [state, setState] = useState<UpdateState>({ step: "idle" });
  const busy = useRef(false);

  const checkNow = useCallback(
    async (manual: boolean) => {
      if (busy.current) return;
      busy.current = true;
      if (manual) setState({ step: "checking" });
      try {
        const [update, current, canInstall] = await Promise.all([check(), getVersion(), invoke<boolean>("update_supported")]);
        updateSettings({ lastUpdateCheck: Date.now() });
        if (update) setState({ step: "available", update, current, canInstall });
        else setState(manual ? { step: "current", version: current } : { step: "idle" });
      } catch (e) {
        // A background check that fails (offline, say) just tries again next time.
        setState(manual ? { step: "error", message: `Couldn't check for updates: ${String(e)}` } : { step: "idle" });
      } finally {
        busy.current = false;
      }
    },
    [updateSettings],
  );

  useEffect(() => {
    if (!settings.autoUpdate) return;
    const due = () => Date.now() - (settings.lastUpdateCheck ?? 0) >= WEEK;
    if (due()) void checkNow(false);
    const timer = setInterval(() => due() && void checkNow(false), TICK);
    return () => clearInterval(timer);
  }, [settings.autoUpdate, settings.lastUpdateCheck, checkNow]);

  const install = useCallback(async () => {
    if (state.step !== "available") return;
    const { update } = state;
    let total = 0;
    let done = 0;
    setState({ step: "downloading", update, percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          setState({ step: "downloading", update, percent: total ? Math.min(100, (done / total) * 100) : null });
        }
      });
      setState({ step: "restarting" });
      await relaunch();
    } catch (e) {
      setState({ step: "error", message: `The update didn't install: ${String(e)}` });
    }
  }, [state]);

  const dismiss = useCallback(() => setState({ step: "idle" }), []);

  return { state, checkNow, install, dismiss };
}
