//! Drives the client against a fake D11 that answers like the real one, and
//! checks the command sequence of a print job.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use niimbot::commands::{req, resp};
use niimbot::packet::{Packet, PacketReader};
use niimbot::{Bitmap, Client, PrintOptions, Transport};
use tokio::sync::mpsc;

struct FakeD11 {
    to_client: mpsc::UnboundedSender<Vec<u8>>,
    reader: Mutex<PacketReader>,
    sent: Arc<Mutex<Vec<u8>>>,
    copies: Mutex<u16>,
    /// Labels printed so far in this job; page-index packets count across pages.
    printed: Mutex<u16>,
}

impl FakeD11 {
    fn reply(&self, cmd: u8, data: &[u8]) {
        let _ = self.to_client.send(Packet::new(cmd, data).to_bytes());
    }

    fn handle(&self, p: Packet) {
        self.sent.lock().unwrap().push(p.command);
        match p.command {
            req::CONNECT => self.reply(resp::CONNECT, &[1]),
            req::PRINTER_INFO => match p.data[0] {
                8 => self.reply(0x48, &[0x02, 0x00]),
                10 => self.reply(0x4a, &[4]),
                9 => self.reply(0x49, &[1, 5]),
                12 => self.reply(0x4c, &[1, 0]),
                _ => self.reply(resp::NOT_SUPPORTED, &[]),
            },
            // The real D11 doesn't answer this one.
            req::HEARTBEAT if p.data[0] == 3 => self.reply(resp::NOT_SUPPORTED, &[]),
            req::HEARTBEAT => self.reply(resp::HEARTBEAT_ADVANCED1, &[0, 0, 0, 0, 0, 0, 0, 0, 1, 3]),
            req::SET_DENSITY => self.reply(resp::SET_DENSITY, &[1]),
            req::SET_LABEL_TYPE => self.reply(resp::SET_LABEL_TYPE, &[1]),
            req::PRINT_CLEAR => self.reply(resp::PRINT_CLEAR, &[1]),
            req::PAGE_START => self.reply(resp::PAGE_START, &[1]),
            req::SET_PAGE_SIZE => self.reply(resp::SET_PAGE_SIZE, &[1]),
            req::PRINT_QUANTITY => {
                *self.copies.lock().unwrap() = u16::from_be_bytes([p.data[0], p.data[1]]);
                self.reply(resp::PRINT_QUANTITY, &[1]);
            }
            req::PAGE_END => {
                self.reply(resp::PAGE_END, &[1]);
                let mut printed = self.printed.lock().unwrap();
                for _ in 0..*self.copies.lock().unwrap() {
                    *printed += 1;
                    self.reply(resp::PRINTER_PAGE_INDEX, &printed.to_be_bytes());
                }
            }
            req::PRINT_START => {
                *self.printed.lock().unwrap() = 0;
                self.reply(resp::PRINT_START, &[1]);
            }
            req::PRINT_END => self.reply(resp::PRINT_END, &[1]),
            req::RFID_INFO => self.reply(resp::RFID_INFO, &[0]),
            _ => {}
        }
    }
}

struct FakeTransport(Arc<FakeD11>);

impl Transport for FakeTransport {
    fn write<'a>(&'a self, data: &'a [u8]) -> Pin<Box<dyn Future<Output = niimbot::Result<()>> + Send + 'a>> {
        // The connect packet's leading 0x03 isn't part of the frame.
        let frame = if data.first() == Some(&3) { &data[1..] } else { data };
        let packets = self.0.reader.lock().unwrap().push(frame);
        for p in packets {
            self.0.handle(p);
        }
        Box::pin(async { Ok(()) })
    }
    fn close(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }
}

fn fake_d11() -> (Client, Arc<Mutex<Vec<u8>>>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let printer = Arc::new(FakeD11 {
        to_client: tx,
        reader: Mutex::new(PacketReader::default()),
        sent: sent.clone(),
        copies: Mutex::new(1),
        printed: Mutex::new(0),
    });
    (Client::new(FakeTransport(printer), rx), sent)
}

/// A 40 × 12 mm label with a black bar `n` dots wide, so each page differs.
fn bar_label(n: u32) -> Bitmap {
    let (w, h) = (320u32, 96u32);
    let mut bits = vec![0u8; (w * h / 8) as usize];
    for y in 0..h {
        for x in 0..n {
            let i = (y * w + x) as usize;
            bits[i / 8] |= 0x80 >> (i % 8);
        }
    }
    Bitmap::from_packed(w, h, &bits)
}

#[tokio::test]
async fn prints_numbered_labels_as_separate_pages() {
    let (client, sent) = fake_d11();
    client.handshake().await.unwrap();
    let mut events = client.events();
    sent.lock().unwrap().clear();

    let pages = [bar_label(8), bar_label(16), bar_label(24)];
    client.print_pages(&pages, PrintOptions { copies: 1, density: 2, ..Default::default() }).await.unwrap();

    let cmds = sent.lock().unwrap().clone();
    assert_eq!(cmds.iter().filter(|c| **c == req::PRINT_START).count(), 1, "one job");
    assert_eq!(cmds.iter().filter(|c| **c == req::PAGE_START).count(), 3, "one page per label");
    assert_eq!(cmds.iter().filter(|c| **c == req::PRINT_END).count(), 1);

    let mut last_page = 0;
    while let Ok(e) = events.try_recv() {
        if let niimbot::ClientEvent::PrintProgress { page, pages_total, sending: false, .. } = e {
            assert_eq!(pages_total, 3);
            last_page = page;
        }
    }
    assert_eq!(last_page, 3);
}

#[tokio::test]
async fn connects_and_prints_two_copies_on_a_d11() {
    let (client, sent) = fake_d11();

    let info = client.handshake().await.unwrap();
    assert_eq!(info.model.unwrap().model, "D11");
    assert_eq!(info.battery_percents, Some(100));
    assert_eq!(info.software_version.as_deref(), Some("1.05/2.61"));
    assert_eq!(info.print_task, Some(niimbot::PrintTaskName::D11V1));
    assert_eq!(info.rfid.as_ref().map(|r| r.tag_present), Some(false));

    // A 40 × 12 mm label with a black frame.
    let (w, h) = (320u32, 96u32);
    let mut bits = vec![0u8; (w * h / 8) as usize];
    for y in 0..h {
        for x in 0..w {
            if x < 3 || y < 3 || x >= w - 3 || y >= h - 3 {
                let i = (y * w + x) as usize;
                bits[i / 8] |= 0x80 >> (i % 8);
            }
        }
    }
    let mut events = client.events();
    sent.lock().unwrap().clear();
    client.print(&Bitmap::from_packed(w, h, &bits), PrintOptions { copies: 2, density: 3, ..Default::default() }).await.unwrap();

    let cmds = sent.lock().unwrap().clone();
    let control: Vec<u8> = cmds.iter().copied().filter(|c| ![req::PRINT_BITMAP_ROW, req::PRINT_BITMAP_ROW_INDEXED, req::PRINT_EMPTY_ROW].contains(c)).collect();
    assert_eq!(
        control,
        vec![req::SET_DENSITY, req::SET_LABEL_TYPE, req::PRINT_START, req::PRINT_CLEAR, req::PAGE_START, req::SET_PAGE_SIZE, req::PRINT_QUANTITY, req::PAGE_END, req::PRINT_END, req::RFID_INFO]
    );
    assert!(cmds.iter().any(|c| *c == req::PRINT_BITMAP_ROW), "image rows were sent");

    let mut last_page = 0;
    while let Ok(e) = events.try_recv() {
        if let niimbot::ClientEvent::PrintProgress { page, sending: false, .. } = e {
            last_page = page;
        }
    }
    assert_eq!(last_page, 2);
}
