//! Response parsers, mirroring niimbluelib's `PacketParser`.

use serde::Serialize;

use crate::{packet::Packet, Error, Result};

fn need(p: &Packet, len: usize) -> Result<()> {
    if p.data.len() < len {
        return Err(Error::InvalidPacket(format!("response 0x{:02x} has {} bytes, expected {len}", p.command, p.data.len())));
    }
    Ok(())
}

fn u16_at(d: &[u8], i: usize) -> u16 {
    u16::from_be_bytes([d[i], d[i + 1]])
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatData {
    pub lid_closed: Option<bool>,
    pub battery_percents: Option<u8>,
    pub paper_inserted: Option<bool>,
    pub paper_rfid_success: Option<bool>,
    pub temp: Option<u8>,
}

/// Models whose lid sensor reads the other way round (the D11 is 512).
const INVERTED_LID_MODELS: &[u16] = &[512, 514, 513, 2304, 1792, 3584, 5120, 2560, 3840, 4352, 272, 273, 274];

/// Older firmware reports battery as 0–4 bars.
fn battery(v: u8) -> u8 {
    if v <= 4 {
        v * 25
    } else {
        v
    }
}

pub fn heartbeat_advanced1(p: &Packet, model_id: Option<u16>) -> Result<HeartbeatData> {
    let d = &p.data;
    let mut h = HeartbeatData::default();
    match d.len() {
        10 => {
            h.lid_closed = Some(d[8] == 0);
            h.battery_percents = Some(d[9]);
        }
        13 => {
            h.lid_closed = Some(d[9] == 0);
            h.battery_percents = Some(d[10]);
            h.paper_inserted = Some(d[11] == 0);
            h.paper_rfid_success = Some(d[12] != 0);
        }
        19 => {
            h.lid_closed = Some(d[15] == 0);
            h.battery_percents = Some(d[16]);
            h.paper_inserted = Some(d[17] == 0);
            h.paper_rfid_success = Some(d[18] != 0);
        }
        20 => {
            h.paper_inserted = Some(d[18] == 0);
            h.paper_rfid_success = Some(d[19] != 0);
        }
        n => return Err(Error::InvalidPacket(format!("heartbeat length {n}"))),
    }
    if model_id.is_some_and(|m| INVERTED_LID_MODELS.contains(&m)) {
        h.lid_closed = h.lid_closed.map(|c| !c);
    }
    h.battery_percents = h.battery_percents.map(battery);
    Ok(h)
}

pub fn heartbeat_advanced2(p: &Packet) -> Result<HeartbeatData> {
    need(p, 9)?;
    let d = &p.data;
    Ok(HeartbeatData {
        battery_percents: Some(battery(d[2])),
        temp: Some(d[3]),
        lid_closed: Some(d[4] == 0),
        paper_inserted: Some(d[5] == 0),
        paper_rfid_success: Some(d[6] != 0),
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct HeartbeatPrinterInfo {
    pub software_version: String,
    pub hardware_version: String,
    pub printhead_width: u16,
}

pub fn heartbeat_printer_info(p: &Packet) -> Result<HeartbeatPrinterInfo> {
    if p.data.len() != 10 {
        return Err(Error::InvalidPacket(format!("printer info length {}", p.data.len())));
    }
    let d = &p.data;
    let version = |h: u8, l: u8| format!("{:.2}", l as f64 / 100.0 + h as f64);
    Ok(HeartbeatPrinterInfo {
        hardware_version: version(d[0], d[1]),
        software_version: version(d[2], d[3]),
        printhead_width: u16_at(d, 4),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrintStatus {
    pub page: u16,
    pub page_print_progress: u8,
    pub page_feed_progress: u8,
    pub error: u8,
}

pub fn print_status(p: &Packet) -> Result<PrintStatus> {
    need(p, 4)?;
    let d = &p.data;
    Ok(PrintStatus {
        page: u16_at(d, 0),
        page_print_progress: d[2],
        page_feed_progress: d[3],
        error: if d.len() == 10 { d[6] } else { 0 },
    })
}

/// Protocol version and colour support from `PrinterStatusData`.
pub fn printer_status_data(p: &Packet) -> (u8, bool) {
    let d = &p.data;
    if d.len() < 13 {
        return (0, false);
    }
    let n = d[11] as u16 * 100 + d[12] as u16;
    let version = match n {
        204..=299 => 3,
        300..=301 => 4,
        302.. => 5,
        _ => 0,
    };
    (version, d[10] > 0)
}

pub fn model_id(p: &Packet) -> Result<u16> {
    need(p, 1)?;
    match p.data.len() {
        1 => Ok((p.data[0] as u16) << 8),
        2 => Ok(u16_at(&p.data, 0)),
        n => Err(Error::InvalidPacket(format!("model id length {n}"))),
    }
}

pub fn battery_level(p: &Packet) -> Result<u8> {
    need(p, 1)?;
    Ok(battery(p.data[0]))
}

pub fn version(p: &Packet) -> Result<String> {
    if p.data.len() != 2 {
        return Err(Error::InvalidPacket(format!("version length {}", p.data.len())));
    }
    let (a, b) = (p.data[0] as f64, p.data[1] as f64);
    Ok(format!("{:.2}/{:.2}", b / 100.0 + a, (a * 256.0 + b) / 100.0))
}

pub fn boolean(p: &Packet) -> Result<bool> {
    need(p, 1)?;
    Ok(p.data[0] == 1)
}
