import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type BluetoothDeviceOption = { id: string; name: string };

const api = {
  platform: process.platform,
  bluetooth: {
    /** Subscribe to the device list shown while a Bluetooth scan is running. Returns an unsubscribe function. */
    onDevices(listener: (devices: BluetoothDeviceOption[]) => void): () => void {
      const handler = (_e: IpcRendererEvent, devices: BluetoothDeviceOption[]) => listener(devices);
      ipcRenderer.on("bluetooth:devices", handler);
      return () => ipcRenderer.removeListener("bluetooth:devices", handler);
    },
    select(deviceId: string): void {
      ipcRenderer.send("bluetooth:select", deviceId);
    },
    cancel(): void {
      ipcRenderer.send("bluetooth:cancel");
    },
  },
};

export type StudioApi = typeof api;

contextBridge.exposeInMainWorld("studio", api);
