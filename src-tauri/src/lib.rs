use std::sync::Arc;

use printer::ble::{Bluetooth, FoundPrinter};
use printer::{Bitmap, Client, ClientEvent, PrintOptions, PrinterInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
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

/// Print 1-bit labels, `copies` of each page. Each page is the canvas packed
/// MSB-first, row-major, 1 = black. Numbered labels send one page per number.
#[tauri::command]
async fn printer_print(printer: State<'_, Printer>, width: u32, height: u32, pages: Vec<Vec<u8>>, density: u8, copies: u16) -> Result<(), String> {
    if pages.is_empty() || pages.iter().any(|bits| bits.len() < (width as usize * height as usize).div_ceil(8)) {
        return Err("Label image is incomplete".into());
    }
    let client = printer.client().await?;
    let bitmaps: Vec<Bitmap> = pages.iter().map(|bits| Bitmap::from_packed(width, height, bits)).collect();
    // Use the roll's own label type (gaps, black marks, continuous...) when its tag says.
    let label_type = client.info().rfid.filter(|r| r.tag_present && (1..=11).contains(&r.consumables_type)).map_or(1, |r| r.consumables_type);
    client
        .print_pages(&bitmaps, PrintOptions { density, copies: copies.max(1), label_type, ..Default::default() })
        .await
        .map_err(|e| e.to_string())
}

/// Label files are small JSON documents; the UI picks the path with a native dialog.
#[tauri::command]
async fn label_read(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path).await.map_err(|e| format!("Couldn't open {path}: {e}"))
}

#[tauri::command]
async fn label_write(path: String, contents: String) -> Result<(), String> {
    // Write beside the target, then rename, so a failed save never truncates the old file.
    let tmp = format!("{path}.tmp");
    tokio::fs::write(&tmp, contents).await.map_err(|e| format!("Couldn't save {path}: {e}"))?;
    tokio::fs::rename(&tmp, &path).await.map_err(|e| format!("Couldn't save {path}: {e}"))
}

/// An installed font family and its style, for the font picker.
#[derive(Serialize)]
struct FontFamily {
    family: String,
    /// "sans", "serif", "mono", "script", "display", "symbol" or "other".
    category: &'static str,
}

/// Font families installed on this computer, sorted, for the font picker.
#[tauri::command]
async fn system_fonts() -> Vec<FontFamily> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        // One face per family, preferring the regular one, which says the most about its style.
        let mut faces: std::collections::BTreeMap<String, &fontdb::FaceInfo> = std::collections::BTreeMap::new();
        for face in db.faces() {
            let Some((name, _)) = face.families.first() else { continue };
            // Names starting with "." are hidden system fonts on macOS.
            if name.starts_with('.') {
                continue;
            }
            let regular = |f: &fontdb::FaceInfo| f.weight == fontdb::Weight::NORMAL && f.style == fontdb::Style::Normal;
            let entry = faces.entry(name.clone()).or_insert(face);
            if !regular(entry) && regular(face) {
                *entry = face;
            }
        }
        let mut fonts: Vec<FontFamily> = faces
            .into_iter()
            .map(|(family, face)| {
                let category = db
                    .with_face_data(face.id, |data, index| font_category(&family, face.monospaced, data, index))
                    .unwrap_or("other");
                FontFamily { family, category }
            })
            .collect();
        fonts.sort_by_key(|f| f.family.to_lowercase());
        fonts
    })
    .await
    .unwrap_or_default()
}

/// Classify a font from its OS/2 table (PANOSE, then IBM family class), falling back to its name.
fn font_category(family: &str, monospaced: bool, data: &[u8], index: u32) -> &'static str {
    let name = family.to_lowercase();
    if name.contains("emoji") || name.contains("symbol") || name.contains("dings") {
        return "symbol";
    }
    if monospaced || name.contains("mono") {
        return "mono";
    }
    let os2 = ttf_parser::RawFace::parse(data, index)
        .ok()
        .and_then(|f| f.table(ttf_parser::Tag::from_bytes(b"OS/2")))
        .filter(|t| t.len() >= 42);
    if let Some(t) = os2 {
        // PANOSE starts at byte 32: family kind, then serif style.
        match (t[32], t[33]) {
            (3, _) => return "script",
            (4, _) => return "display",
            (5, _) => return "symbol",
            (2, 11..=15) => return "sans",
            (2, 2..=10) => return "serif",
            _ => {}
        }
        // sFamilyClass high byte at byte 30.
        match t[30] {
            1..=5 | 7 => return "serif",
            8 => return "sans",
            9 => return "display",
            10 => return "script",
            12 => return "symbol",
            _ => {}
        }
    }
    if name.contains("code") || name.contains("courier") || name.contains("console") {
        "mono"
    } else if name.contains("sans") || name.contains("gothic") || name.contains("grotesk") {
        "sans"
    } else if name.contains("serif") || name.contains("roman") {
        "serif"
    } else if name.contains("script") || name.contains("hand") {
        "script"
    } else {
        "other"
    }
}

/// A label saved as a template, in the app's data folder.
#[derive(Serialize)]
struct Template {
    id: String,
    contents: String,
}

fn templates_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("templates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the templates folder: {e}"))?;
    Ok(dir)
}

/// Template ids are file names, so keep them to one safe path component.
fn template_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if id.is_empty() || id.contains(['/', '\\', ':']) || id.starts_with('.') {
        return Err("Invalid template name".into());
    }
    Ok(templates_dir(app)?.join(format!("{id}.labelpad")))
}

#[tauri::command]
async fn templates_list(app: AppHandle) -> Result<Vec<Template>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(templates_dir(&app)?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        // .niimbot is what templates were saved as before the rename.
        if path.extension().is_some_and(|e| e == "labelpad" || e == "niimbot") {
            if let (Some(id), Ok(contents)) = (path.file_stem().and_then(|s| s.to_str()), std::fs::read_to_string(&path)) {
                out.push(Template { id: id.to_string(), contents });
            }
        }
    }
    out.sort_by_key(|t| t.id.to_lowercase());
    Ok(out)
}

/// Save a template, returning its id. An existing template with the same id is replaced.
#[tauri::command]
async fn template_save(app: AppHandle, name: String, contents: String) -> Result<String, String> {
    let id: String = name
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || " -_()".contains(c) { c } else { '_' })
        .collect();
    let id = id.trim().to_string();
    std::fs::write(template_path(&app, &id)?, contents).map_err(|e| format!("Couldn't save the template: {e}"))?;
    Ok(id)
}

#[tauri::command]
async fn template_delete(app: AppHandle, id: String) -> Result<(), String> {
    std::fs::remove_file(template_path(&app, &id)?).map_err(|e| format!("Couldn't delete the template: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Printer::default())
        .invoke_handler(tauri::generate_handler![
            scan_start,
            scan_stop,
            printer_connect,
            printer_disconnect,
            printer_print,
            label_read,
            label_write,
            system_fonts,
            templates_list,
            template_save,
            template_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running LabelPad");
}

