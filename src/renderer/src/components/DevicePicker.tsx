import { useEffect, useState } from "react";
import { Bluetooth, Printer, X } from "lucide-react";
import type { BluetoothDeviceOption } from "../../../preload";

type Props = { open: boolean; onClose: () => void };

/** Electron has no Bluetooth chooser of its own, so this lists what the scan finds. */
export function DevicePicker({ open, onClose }: Props) {
  const [devices, setDevices] = useState<BluetoothDeviceOption[]>([]);

  useEffect(() => {
    if (!open) {
      setDevices([]);
      return;
    }
    return window.studio.bluetooth.onDevices(setDevices);
  }, [open]);

  if (!open) return null;

  const cancel = () => {
    window.studio.bluetooth.cancel();
    onClose();
  };

  const choose = (id: string) => {
    window.studio.bluetooth.select(id);
    onClose();
  };

  return (
    <div className="backdrop" onClick={cancel}>
      <div className="dialog" role="dialog" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <div>
            <h2 id="picker-title">Connect a printer</h2>
            <p className="muted">Turn on your D11 and keep it close to this computer.</p>
          </div>
          <button className="icon-button" onClick={cancel} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>

        <div className="device-list">
          {devices.length === 0 ? (
            <div className="scanning">
              <span className="pulse">
                <Bluetooth size={22} />
              </span>
              Searching for printers…
            </div>
          ) : (
            devices.map((d) => (
              <button key={d.id} className="device" onClick={() => choose(d.id)}>
                <Printer size={18} />
                <span>{d.name}</span>
                <span className="device-action">Connect</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
