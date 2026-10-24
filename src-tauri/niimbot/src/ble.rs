//! Bluetooth LE transport via btleplug (WinRT on Windows, CoreBluetooth on
//! macOS, BlueZ on Linux).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use btleplug::api::{Central, CentralEvent, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::models;
use crate::transport::{Incoming, Transport};
use crate::{Error, Result};

/// The service Niimbot printers expose their serial-like characteristic on.
const NIIMBOT_SERVICE: Uuid = Uuid::from_u128(0xe7810a71_73ae_499d_8c15_faa9aef0c3f2);
/// Standard 16-bit Bluetooth UUIDs end with this base; those services aren't ours.
const BLUETOOTH_BASE_SUFFIX: u128 = 0x0000_1000_8000_0080_5f9b_34fb;

fn ble_err(e: btleplug::Error) -> Error {
    Error::Transport(e.to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundPrinter {
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
}

/// Owns the Bluetooth adapter: scans for printers and opens connections.
pub struct Bluetooth {
    adapter: Adapter,
    seen: Mutex<HashMap<String, Peripheral>>,
    scan_task: Mutex<Option<JoinHandle<()>>>,
}

impl Bluetooth {
    pub async fn new() -> Result<Arc<Self>> {
        let manager = Manager::new().await.map_err(ble_err)?;
        let adapter = manager
            .adapters()
            .await
            .map_err(ble_err)?
            .into_iter()
            .next()
            .ok_or_else(|| Error::Transport("No Bluetooth adapter found. Is Bluetooth turned on?".into()))?;
        Ok(Arc::new(Self { adapter, seen: Mutex::new(HashMap::new()), scan_task: Mutex::new(None) }))
    }

    /// Scan for printers, calling `on_found` each time the list changes.
    pub async fn start_scan(self: &Arc<Self>, on_found: impl Fn(Vec<FoundPrinter>) + Send + 'static) -> Result<()> {
        self.stop_scan().await;
        let mut events = self.adapter.events().await.map_err(ble_err)?;
        self.adapter.start_scan(ScanFilter::default()).await.map_err(ble_err)?;
        let prefixes = models::name_prefixes();
        let this = Arc::clone(self);

        let task = tokio::spawn(async move {
            let mut found: Vec<FoundPrinter> = Vec::new();
            while let Some(event) = events.next().await {
                let id = match event {
                    CentralEvent::DeviceDiscovered(id) | CentralEvent::DeviceUpdated(id) => id,
                    _ => continue,
                };
                let Ok(p) = this.adapter.peripheral(&id).await else { continue };
                let Ok(Some(props)) = p.properties().await else { continue };
                let name = props.local_name.or(props.advertisement_name).unwrap_or_default();
                let advertises_service = props.services.contains(&NIIMBOT_SERVICE);
                // Same filter as niimbluelib: a known model's first letter, or the Niimbot service.
                if !advertises_service && !name.chars().next().is_some_and(|c| prefixes.contains(&c)) {
                    continue;
                }
                if name.is_empty() {
                    continue;
                }
                let printer = FoundPrinter { id: id.to_string(), name, rssi: props.rssi };
                this.seen.lock().await.insert(printer.id.clone(), p);
                match found.iter_mut().find(|f| f.id == printer.id) {
                    Some(existing) if *existing == printer => continue,
                    Some(existing) => *existing = printer,
                    None => found.push(printer),
                }
                // Likely printers first, then by signal strength.
                found.sort_by_key(|f| (!f.name.starts_with('D'), std::cmp::Reverse(f.rssi.unwrap_or(i16::MIN))));
                on_found(found.clone());
            }
        });
        *self.scan_task.lock().await = Some(task);
        Ok(())
    }

    pub async fn stop_scan(&self) {
        if let Some(t) = self.scan_task.lock().await.take() {
            t.abort();
            let _ = self.adapter.stop_scan().await;
        }
    }

    /// Connect to a printer found by the last scan.
    pub async fn connect(self: &Arc<Self>, id: &str) -> Result<(BleTransport, Incoming)> {
        self.stop_scan().await;
        let peripheral = self
            .seen
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| Error::Transport("That printer is no longer in range. Scan again.".into()))?;

        tokio::time::timeout(Duration::from_secs(15), peripheral.connect())
            .await
            .map_err(|_| Error::Transport("Timed out connecting. Is the printer on and nearby?".into()))?
            .map_err(ble_err)?;
        peripheral.discover_services().await.map_err(ble_err)?;

        let channel = pick_characteristic(&peripheral)
            .ok_or_else(|| Error::Transport("This device doesn't look like a Niimbot printer".into()))?;
        peripheral.subscribe(&channel).await.map_err(ble_err)?;

        let (tx, rx) = mpsc::unbounded_channel();
        let mut notifications = peripheral.notifications().await.map_err(ble_err)?;
        let uuid = channel.uuid;
        let notify_tx = tx.clone();
        let reader = tokio::spawn(async move {
            while let Some(n) = notifications.next().await {
                if n.uuid == uuid && notify_tx.send(n.value).is_err() {
                    return;
                }
            }
        });

        // Dropping the sender closes `Incoming`, which the client treats as a disconnect.
        let mut events = self.adapter.events().await.map_err(ble_err)?;
        let peripheral_id = peripheral.id();
        let watcher = tokio::spawn(async move {
            while let Some(e) = events.next().await {
                if matches!(e, CentralEvent::DeviceDisconnected(ref id) if *id == peripheral_id) {
                    break;
                }
            }
            reader.abort();
            drop(tx);
        });

        Ok((BleTransport { peripheral, channel, watcher }, rx))
    }
}

/// Prefer the Niimbot service; otherwise any non-standard characteristic
/// that can notify and take writes without response (as niimbluelib does).
fn pick_characteristic(p: &Peripheral) -> Option<Characteristic> {
    let usable = |c: &Characteristic| {
        c.properties.contains(CharPropFlags::NOTIFY) && c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
    };
    let standard = |u: Uuid| u.as_u128() & 0xffff_ffff_ffff_ffff_ffff_ffff == BLUETOOTH_BASE_SUFFIX;
    let chars = p.characteristics();
    chars
        .iter()
        .find(|c| c.service_uuid == NIIMBOT_SERVICE && usable(c))
        .or_else(|| chars.iter().find(|c| !standard(c.service_uuid) && usable(c)))
        .cloned()
}

pub struct BleTransport {
    peripheral: Peripheral,
    channel: Characteristic,
    watcher: JoinHandle<()>,
}

impl Transport for BleTransport {
    fn write<'a>(&'a self, data: &'a [u8]) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move { self.peripheral.write(&self.channel, data, WriteType::WithoutResponse).await.map_err(ble_err) })
    }

    fn close(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let _ = self.peripheral.disconnect().await;
            self.watcher.abort();
        })
    }
}
