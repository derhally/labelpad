use std::sync::Arc;

use niimbot::ble::{Bluetooth, FoundPrinter};
use niimbot::{Bitmap, Client, ClientEvent, PrintOptions, PrinterInfo};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

/// Bluetooth adapter and the connected printer, shared by every command.
#[derive(Default)]
struct Printer {
    bluetooth: Mutex<Option<Arc<Bluetooth>>>,
    client: Mutex<Option<Client>>,
}

impl Printer {
    async fn bluetooth(&self) -> Result<Arc<Bluetooth>, String> {
        let mut bt = self.bluetooth.lock().await;
        if bt.is_none() {
            *bt = Some(Bluetooth::new().await.map_err(|e| e.to_string())?);
        }
        Ok(bt.clone().unwrap())
    }

    async fn client(&self) -> Result<Client, String> {
        match self.client.lock().await.clone() {
            Some(c) if c.is_connected() => Ok(c),
            _ => Err("Printer is not connected".into()),
        }
    }
}

/// Start looking for printers. Results arrive as `printers-found` events.
#[tauri::command]
async fn scan_start(app: AppHandle, printer: State<'_, Printer>) -> Result<(), String> {
    let bt = printer.bluetooth().await?;
    bt.start_scan(move |found: Vec<FoundPrinter>| {
        let _ = app.emit("printers-found", found);
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_stop(printer: State<'_, Printer>) -> Result<(), String> {
    if let Some(bt) = printer.bluetooth.lock().await.clone() {
        bt.stop_scan().await;
    }
    Ok(())
}

/// Connect to a printer from the scan and read its details. Status updates
/// (heartbeat, print progress, disconnect) arrive as `printer-event` events.
#[tauri::command]
async fn printer_connect(app: AppHandle, printer: State<'_, Printer>, id: String) -> Result<PrinterInfo, String> {
    if let Some(old) = printer.client.lock().await.take() {
        old.disconnect().await;
    }
    let bt = printer.bluetooth().await?;
    let (transport, incoming) = bt.connect(&id).await.map_err(|e| e.to_string())?;
    let client = Client::new(transport, incoming);

    let mut events = client.events();
    tauri::async_runtime::spawn(async move {
        while let Ok(e) = events.recv().await {
            let done = matches!(e, ClientEvent::Disconnected);
            let _ = app.emit("printer-event", e);
            if done {
                break;
            }
        }
    });

    match client.handshake().await {
        Ok(info) => {
            *printer.client.lock().await = Some(client);
            Ok(info)
        }
        Err(e) => {
            client.disconnect().await;
            Err(format!("Couldn't talk to the printer: {e}"))
        }
    }
}

#[tauri::command]
async fn printer_disconnect(printer: State<'_, Printer>) -> Result<(), String> {
    if let Some(c) = printer.client.lock().await.take() {
        c.disconnect().await;
    }
    Ok(())
}

/// Print a 1-bit label. `bits` is the canvas packed MSB-first, row-major, 1 = black.
#[tauri::command]
async fn printer_print(printer: State<'_, Printer>, width: u32, height: u32, bits: Vec<u8>, density: u8, copies: u16) -> Result<(), String> {
    if bits.len() < (width as usize * height as usize).div_ceil(8) {
        return Err("Label image is incomplete".into());
    }
    let client = printer.client().await?;
    let bitmap = Bitmap::from_packed(width, height, &bits);
    client
        .print(&bitmap, PrintOptions { density, copies: copies.max(1), ..Default::default() })
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Printer::default())
        .invoke_handler(tauri::generate_handler![scan_start, scan_stop, printer_connect, printer_disconnect, printer_print])
        .run(tauri::generate_context!())
        .expect("error while running Niimbot Studio");
}
