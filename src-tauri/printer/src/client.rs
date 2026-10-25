//! Talks to a printer over a [`Transport`]: request/response matching,
//! connection handshake, heartbeat and print jobs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Instant};

use crate::commands::{self, connect_result, heartbeat, info, resp};
use crate::encoder::{encode_image, Bitmap};
use crate::models::{self, ModelMeta, PrintDirection, PrintTaskName};
use crate::packet::{Packet, PacketReader};
use crate::parser::{self, HeartbeatData, RfidInfo};
use crate::transport::{Incoming, Transport};
use crate::{generator as gen, Error, Result};

const PACKET_INTERVAL: Duration = Duration::from_millis(10);
const DEFAULT_TIMEOUT: Duration = Duration::from_millis(1000);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);
const HEARTBEAT_MAX_FAILS: u32 = 5;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub model_id: Option<u16>,
    pub model: Option<ModelMeta>,
    pub protocol_version: u8,
    pub battery_percents: Option<u8>,
    pub software_version: Option<String>,
    pub hardware_version: Option<String>,
    pub printhead_width: Option<u16>,
    pub print_task: Option<PrintTaskName>,
    /// The loaded label roll, if its tag could be read.
    pub rfid: Option<RfidInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientEvent {
    Heartbeat { data: HeartbeatData },
    #[serde(rename_all = "camelCase")]
    PrintProgress { page: u16, pages_total: u16, percent: u8, sending: bool },
    /// The label roll's tag was read again (after printing, or a roll change).
    Rfid { info: RfidInfo },
    Disconnected,
}

#[derive(Debug, Clone, Copy)]
pub struct PrintOptions {
    pub density: u8,
    pub copies: u16,
    /// 1 = labels with gaps, the D11 default.
    pub label_type: u8,
    pub page_timeout: Duration,
    pub status_timeout: Duration,
    pub status_poll_interval: Duration,
}

impl Default for PrintOptions {
    fn default() -> Self {
        Self {
            density: 2,
            copies: 1,
            label_type: 1,
            page_timeout: Duration::from_secs(10),
            status_timeout: Duration::from_secs(8),
            status_poll_interval: Duration::from_millis(100),
        }
    }
}

struct Inner {
    transport: Box<dyn Transport>,
    /// Held for each request/response exchange so replies can't be mixed up.
    io: Mutex<()>,
    packets: broadcast::Sender<Packet>,
    events: broadcast::Sender<ClientEvent>,
    info: StdMutex<PrinterInfo>,
    connected: AtomicBool,
    tasks: StdMutex<Vec<JoinHandle<()>>>,
}

#[derive(Clone)]
pub struct Client {
    inner: Arc<Inner>,
}

impl Client {
    /// Wrap an open transport and start reading from it. Call [`Client::handshake`] next.
    pub fn new(transport: impl Transport, mut incoming: Incoming) -> Self {
        let (packets, _) = broadcast::channel(256);
        let (events, _) = broadcast::channel(64);
        let inner = Arc::new(Inner {
            transport: Box::new(transport),
            io: Mutex::new(()),
            packets,
            events,
            info: StdMutex::new(PrinterInfo::default()),
            connected: AtomicBool::new(true),
            tasks: StdMutex::new(Vec::new()),
        });

        let weak = Arc::downgrade(&inner);
        let reader = tokio::spawn(async move {
            let mut reader = PacketReader::default();
            while let Some(chunk) = incoming.recv().await {
                let Some(inner) = weak.upgrade() else { return };
                for p in reader.push(&chunk) {
                    log::trace!("<< {:02x?}", p.to_bytes());
                    let _ = inner.packets.send(p);
                }
            }
            if let Some(inner) = weak.upgrade() {
                Client { inner }.mark_disconnected();
            }
        });
        inner.tasks.lock().unwrap().push(reader);
        Self { inner }
    }

    pub fn events(&self) -> broadcast::Receiver<ClientEvent> {
        self.inner.events.subscribe()
    }

    pub fn info(&self) -> PrinterInfo {
        self.inner.info.lock().unwrap().clone()
    }

    pub fn is_connected(&self) -> bool {
        self.inner.connected.load(Ordering::SeqCst)
    }

    fn mark_disconnected(&self) {
        if self.inner.connected.swap(false, Ordering::SeqCst) {
            let _ = self.inner.events.send(ClientEvent::Disconnected);
        }
    }

    pub async fn disconnect(&self) {
        for t in self.inner.tasks.lock().unwrap().drain(..) {
            t.abort();
        }
        self.inner.transport.close().await;
        self.mark_disconnected();
    }

    async fn write(&self, p: &Packet) -> Result<()> {
        if !self.is_connected() {
            return Err(Error::NotConnected);
        }
        sleep(PACKET_INTERVAL).await;
        log::trace!(">> {:02x?}", p.to_bytes());
        self.inner.transport.write(&p.to_bytes()).await
    }

    /// Send a packet and wait for its response (or just send, for packets that get none).
    pub async fn send(&self, p: &Packet, wait: Duration) -> Result<Packet> {
        let _io = self.inner.io.lock().await;
        let mut rx = self.inner.packets.subscribe();
        self.write(p).await?;
        let Some(expected) = commands::responses_for(p.command) else {
            return Ok(Packet::new(resp::NOT_SUPPORTED, []));
        };
        wait_for(&mut rx, &expected, wait).await
    }

    /// Send without waiting for a reply; any reply is ignored.
    async fn send_one_way(&self, p: &Packet) -> Result<()> {
        let _io = self.inner.io.lock().await;
        self.write(p).await
    }

    async fn send_all(&self, packets: &[Packet], wait: Duration, mut progress: impl FnMut(usize, usize)) -> Result<()> {
        for (i, p) in packets.iter().enumerate() {
            progress(i + 1, packets.len());
            self.send(p, wait).await?;
        }
        Ok(())
    }

    /// Negotiate the protocol, read the printer's details and start the heartbeat.
    pub async fn handshake(&self) -> Result<PrinterInfo> {
        let connect = self.send(&gen::connect(), DEFAULT_TIMEOUT).await?;
        let mut protocol_version = 0;
        match connect.data.first() {
            Some(&connect_result::CONNECTED_NEW) => protocol_version = 1,
            Some(&connect_result::CONNECTED_V3) => {
                let p = self.send(&gen::printer_status_data(), DEFAULT_TIMEOUT).await?;
                protocol_version = parser::printer_status_data(&p).0;
            }
            _ => {}
        }

        let model_id = parser::model_id(&self.send(&gen::printer_info(info::PRINTER_MODEL_ID), DEFAULT_TIMEOUT).await?)?;
        let model = models::find_model(model_id).copied();
        let mut info = PrinterInfo {
            model_id: Some(model_id),
            model,
            protocol_version,
            print_task: model.and_then(|m| models::find_print_task(m.model, Some(protocol_version))),
            ..Default::default()
        };

        // Nice to have; older firmware may not answer every query.
        if let Ok(p) = self.send(&gen::printer_info(info::BATTERY_CHARGE_LEVEL), DEFAULT_TIMEOUT).await {
            info.battery_percents = parser::battery_level(&p).ok();
        }
        match self.send(&gen::heartbeat(heartbeat::PRINTER_INFO), DEFAULT_TIMEOUT).await.and_then(|p| parser::heartbeat_printer_info(&p)) {
            Ok(i) => {
                info.software_version = Some(i.software_version);
                info.hardware_version = Some(i.hardware_version);
                info.printhead_width = Some(i.printhead_width);
            }
            Err(_) => {
                if let Ok(p) = self.send(&gen::printer_info(info::SOFTWARE_VERSION), DEFAULT_TIMEOUT).await {
                    info.software_version = parser::version(&p).ok();
                }
                if let Ok(p) = self.send(&gen::printer_info(info::HARDWARE_VERSION), DEFAULT_TIMEOUT).await {
                    info.hardware_version = parser::version(&p).ok();
                }
            }
        }

        info.rfid = self.rfid_info().await.ok();

        *self.inner.info.lock().unwrap() = info.clone();
        self.start_heartbeat();
        Ok(info)
    }

    fn start_heartbeat(&self) {
        let client = self.clone();
        let task = tokio::spawn(async move {
            let mut fails = 0;
            let mut paper_was_in = true;
            loop {
                sleep(HEARTBEAT_INTERVAL).await;
                if !client.is_connected() {
                    return;
                }
                match client.heartbeat().await {
                    Ok(data) => {
                        fails = 0;
                        if let Some(b) = data.battery_percents {
                            client.inner.info.lock().unwrap().battery_percents = Some(b);
                        }
                        // A roll was put in: read its tag.
                        let paper_in = data.paper_inserted.unwrap_or(true);
                        let reload = paper_in && !paper_was_in;
                        paper_was_in = paper_in;
                        let _ = client.inner.events.send(ClientEvent::Heartbeat { data });
                        if reload {
                            client.refresh_rfid().await;
                        }
                    }
                    Err(e) => {
                        fails += 1;
                        log::warn!("heartbeat failed ({fails}): {e}");
                        if fails >= HEARTBEAT_MAX_FAILS {
                            client.inner.transport.close().await;
                            client.mark_disconnected();
                            return;
                        }
                    }
                }
            }
        });
        self.inner.tasks.lock().unwrap().push(task);
    }

    /// Read the label roll's RFID tag.
    pub async fn rfid_info(&self) -> Result<RfidInfo> {
        parser::rfid_info(&self.send(&gen::rfid_info(), DEFAULT_TIMEOUT).await?)
    }

    /// Read the tag again, store it, and tell listeners. Failures are ignored.
    async fn refresh_rfid(&self) {
        if let Ok(rfid) = self.rfid_info().await {
            self.inner.info.lock().unwrap().rfid = Some(rfid.clone());
            let _ = self.inner.events.send(ClientEvent::Rfid { info: rfid });
        }
    }

    pub async fn heartbeat(&self) -> Result<HeartbeatData> {
        let (version, model_id) = {
            let i = self.inner.info.lock().unwrap();
            (i.protocol_version, i.model_id)
        };
        let kind = if version >= 3 { heartbeat::ADVANCED2 } else { heartbeat::ADVANCED1 };
        let p = self.send(&gen::heartbeat(kind), Duration::from_millis(500)).await?;
        match p.command {
            resp::HEARTBEAT_ADVANCED1 => parser::heartbeat_advanced1(&p, model_id),
            resp::HEARTBEAT_ADVANCED2 => parser::heartbeat_advanced2(&p),
            c => Err(Error::InvalidPacket(format!("unexpected heartbeat response 0x{c:02x}"))),
        }
    }

    /// Print `copies` of one label. The bitmap is in canvas orientation; it's rotated here as the model requires.
    pub async fn print(&self, bitmap: &Bitmap, opts: PrintOptions) -> Result<()> {
        self.print_pages(std::slice::from_ref(bitmap), opts).await
    }

    /// Print several different labels in one job (for numbered labels), `copies` of each.
    pub async fn print_pages(&self, bitmaps: &[Bitmap], opts: PrintOptions) -> Result<()> {
        if bitmaps.is_empty() {
            return Ok(());
        }
        let info = self.info();
        let task = info.print_task.ok_or_else(|| Error::Unsupported("This printer model isn't supported yet".into()))?;
        let meta = info.model;
        let direction = meta.map(|m| m.print_direction).unwrap_or(PrintDirection::Left);
        let printhead = meta.map(|m| m.printhead_pixels).or(info.printhead_width).unwrap_or(96);

        if !matches!(task, PrintTaskName::D11V1 | PrintTaskName::D110 | PrintTaskName::D110MV4) {
            return Err(Error::Unsupported(format!("Printing with the {task:?} task isn't supported yet")));
        }

        // Each page: clear, start, size, quantity, image rows, end. Newer
        // printers (D110MV4) take size and quantity in one packet and no clear or start.
        let mut pages = Vec::with_capacity(bitmaps.len());
        for bitmap in bitmaps {
            let image = encode_image(bitmap, direction);
            if image.cols > printhead.div_ceil(8) * 8 {
                return Err(Error::Unsupported(format!("Label is {} dots wide but the printhead has {printhead}", image.cols)));
            }
            let mut packets = match task {
                PrintTaskName::D11V1 => vec![gen::print_clear(), gen::page_start(), gen::set_page_size_2b(image.rows), gen::set_print_quantity(opts.copies)],
                PrintTaskName::D110MV4 => vec![gen::set_page_size_13b(image.rows, image.cols, opts.copies)],
                _ => vec![gen::print_clear(), gen::page_start(), gen::set_page_size_4b(image.rows, image.cols), gen::set_print_quantity(opts.copies)],
            };
            packets.extend(gen::write_image_data(&image, printhead, task == PrintTaskName::D110MV4));
            packets.push(gen::page_end());
            pages.push(packets);
        }

        let total = opts.copies.saturating_mul(bitmaps.len() as u16);
        let events = self.inner.events.clone();
        let progress = |percent: u8, page: u16, sending: bool| {
            let _ = events.send(ClientEvent::PrintProgress { page, pages_total: total, percent, sending });
        };

        let result = async {
            let init = match task {
                PrintTaskName::D110MV4 => [gen::set_label_type(opts.label_type), gen::set_density(opts.density), gen::print_start_9b(total)],
                _ => [gen::set_density(opts.density), gen::set_label_type(opts.label_type), gen::print_start_1b()],
            };
            self.send_all(&init, DEFAULT_TIMEOUT, |_, _| {}).await?;
            // Subscribe before sending so an early page-index packet isn't missed.
            let mut rx = self.inner.packets.subscribe();
            let count = pages.len();
            let mut last = 0;
            for (index, packets) in pages.iter().enumerate() {
                if task == PrintTaskName::D110MV4 {
                    // niimbluelib asks for status before each page without waiting for it.
                    self.send_one_way(&gen::print_status()).await?;
                }
                self.send_all(packets, opts.page_timeout, |i, n| {
                    // Sending fills the bar once across all pages.
                    let pct = ((index * 100 + i * 100 / n) / count) as u8;
                    if pct >= last + 5 || (i == n && index + 1 == count) {
                        last = pct;
                        progress(pct, 1, true);
                    }
                })
                .await?;
            }
            progress(0, 1, false);
            match task {
                PrintTaskName::D11V1 => self.wait_page_index(&mut rx, total, opts.status_timeout).await,
                _ => self.wait_status_poll(total, opts).await,
            }
        }
        .await;

        let _ = self.send(&gen::print_end(), DEFAULT_TIMEOUT).await;
        if task == PrintTaskName::D110MV4 {
            let _ = self.send_one_way(&gen::heartbeat(heartbeat::ADVANCED1)).await;
        }
        // The tag's used-label count changes as labels print.
        self.refresh_rfid().await;
        result
    }

    /// Old D11 firmware reports each finished label with an unsolicited page-index packet.
    async fn wait_page_index(&self, rx: &mut broadcast::Receiver<Packet>, total: u16, wait: Duration) -> Result<()> {
        loop {
            let p = wait_for(rx, &[resp::PRINTER_PAGE_INDEX], wait).await?;
            let page = if p.data.len() == 2 { u16::from_be_bytes([p.data[0], p.data[1]]) } else { 0 };
            let _ = self.inner.events.send(ClientEvent::PrintProgress { page, pages_total: total, percent: 100, sending: false });
            if page >= total {
                return Ok(());
            }
        }
    }

    /// Newer firmware is polled for print status until every page is done.
    async fn wait_status_poll(&self, total: u16, opts: PrintOptions) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(60) + opts.status_timeout * total as u32;
        loop {
            sleep(opts.status_poll_interval).await;
            let mut status = Err(Error::Timeout);
            for _ in 0..2 {
                status = self.send(&gen::print_status(), opts.status_timeout).await.and_then(|p| parser::print_status(&p));
                if status.is_ok() {
                    break;
                }
            }
            let s = status?;
            if s.error != 0 {
                return Err(Error::Print { code: s.error, name: commands::print_error_name(s.error) });
            }
            let _ = self.inner.events.send(ClientEvent::PrintProgress {
                page: s.page,
                pages_total: total,
                percent: s.page_print_progress,
                sending: false,
            });
            if s.page >= total {
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err(Error::Timeout);
            }
        }
    }
}

/// Wait for one of `ids` (any packet if empty), turning error responses into errors.
async fn wait_for(rx: &mut broadcast::Receiver<Packet>, ids: &[u8], wait: Duration) -> Result<Packet> {
    timeout(wait, async {
        loop {
            let p = match rx.recv().await {
                Ok(p) => p,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return Err(Error::NotConnected),
            };
            if p.command == resp::PRINT_ERROR {
                let code = p.data.first().copied().unwrap_or(0);
                return Err(Error::Print { code, name: commands::print_error_name(code) });
            }
            if p.command == resp::NOT_SUPPORTED {
                return Err(Error::NotSupported);
            }
            if ids.is_empty() || ids.contains(&p.command) {
                return Ok(p);
            }
        }
    })
    .await
    .map_err(|_| Error::Timeout)?
}
