import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";

// Web Bluetooth on Linux is still behind Chromium's experimental flag.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-experimental-web-platform-features");
}

type BluetoothCallback = (deviceId: string) => void;

let pendingBluetoothSelection: BluetoothCallback | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 860,
    minHeight: 580,
    show: false,
    title: "Niimbot Studio",
    backgroundColor: "#0e1014",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // navigator.bluetooth.requestDevice() has no built-in chooser in Electron.
  // Chromium fires this event repeatedly as devices are discovered, so we
  // forward the list to the renderer and let it render its own picker.
  win.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    pendingBluetoothSelection = callback;
    win.webContents.send(
      "bluetooth:devices",
      devices.map((d) => ({ id: d.deviceId, name: d.deviceName || "Unknown device" })),
    );
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

ipcMain.on("bluetooth:select", (_event, deviceId: string) => {
  pendingBluetoothSelection?.(deviceId);
  pendingBluetoothSelection = null;
});

ipcMain.on("bluetooth:cancel", () => {
  // An empty id rejects the pending requestDevice() call.
  pendingBluetoothSelection?.("");
  pendingBluetoothSelection = null;
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
