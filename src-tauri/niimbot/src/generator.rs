//! Builders for the request packets this app sends, mirroring niimbluelib's `PacketGenerator`.

use crate::commands::req;
use crate::encoder::{EncodedImage, RowData};
use crate::packet::Packet;

fn u16_be(n: u16) -> [u8; 2] {
    n.to_be_bytes()
}

pub fn connect() -> Packet {
    Packet::new(req::CONNECT, [1])
}
pub fn printer_status_data() -> Packet {
    Packet::new(req::PRINTER_STATUS_DATA, [1])
}
pub fn printer_info(kind: u8) -> Packet {
    Packet::new(req::PRINTER_INFO, [kind])
}
pub fn heartbeat(kind: u8) -> Packet {
    Packet::new(req::HEARTBEAT, [kind])
}
pub fn set_density(value: u8) -> Packet {
    Packet::new(req::SET_DENSITY, [value])
}
pub fn set_label_type(value: u8) -> Packet {
    Packet::new(req::SET_LABEL_TYPE, [value])
}
pub fn print_start_1b() -> Packet {
    Packet::new(req::PRINT_START, [1])
}
pub fn print_clear() -> Packet {
    Packet::new(req::PRINT_CLEAR, [1])
}
pub fn page_start() -> Packet {
    Packet::new(req::PAGE_START, [1])
}
pub fn page_end() -> Packet {
    Packet::new(req::PAGE_END, [1])
}
pub fn print_status() -> Packet {
    Packet::new(req::PRINT_STATUS, [1])
}
pub fn print_end() -> Packet {
    Packet::new(req::PRINT_END, [1])
}
pub fn set_page_size_2b(rows: u16) -> Packet {
    Packet::new(req::SET_PAGE_SIZE, u16_be(rows))
}
pub fn set_page_size_4b(rows: u16, cols: u16) -> Packet {
    let mut d = u16_be(rows).to_vec();
    d.extend(u16_be(cols));
    Packet::new(req::SET_PAGE_SIZE, d)
}
pub fn set_print_quantity(quantity: u16) -> Packet {
    Packet::new(req::PRINT_QUANTITY, u16_be(quantity))
}
pub fn print_empty_space(pos: u16, repeats: u8) -> Packet {
    let mut d = u16_be(pos).to_vec();
    d.push(repeats);
    Packet::new(req::PRINT_EMPTY_ROW, d)
}

/// Black pixel counts sent with each bitmap row: per third of the printhead
/// when the row fits in three chunks, otherwise a big-endian total.
pub fn count_pixels(row: &[u8], printhead_pixels: u16) -> (u32, [u8; 3]) {
    let chunk = (printhead_pixels as usize / 8 / 3).max(1);
    let split = row.len() <= chunk * 3;
    let mut total = 0u32;
    let mut parts = [0u32; 3];
    for (i, byte) in row.iter().enumerate() {
        let ones = byte.count_ones();
        total += ones;
        if split && i / chunk <= 2 {
            parts[i / chunk] += ones;
        }
    }
    if split {
        (total, parts.map(|p| p as u8))
    } else {
        let [c, b] = (total as u16).to_be_bytes();
        (total, [0, b, c])
    }
}

pub fn print_bitmap_row(pos: u16, repeats: u8, row: &[u8], printhead_pixels: u16) -> Packet {
    let (_, counts) = count_pixels(row, printhead_pixels);
    let mut d = u16_be(pos).to_vec();
    d.extend(counts);
    d.push(repeats);
    d.extend_from_slice(row);
    Packet::new(req::PRINT_BITMAP_ROW, d)
}

/// For sparse rows (≤ 6 black pixels) the printer takes pixel positions instead of a bitmap.
pub fn print_bitmap_row_indexed(pos: u16, repeats: u8, row: &[u8], printhead_pixels: u16) -> Packet {
    let (_, counts) = count_pixels(row, printhead_pixels);
    let mut d = u16_be(pos).to_vec();
    d.extend(counts);
    d.push(repeats);
    for (byte_pos, b) in row.iter().enumerate() {
        for bit in 0..8 {
            if b & (0x80 >> bit) != 0 {
                d.extend(u16_be((byte_pos * 8 + bit) as u16));
            }
        }
    }
    Packet::new(req::PRINT_BITMAP_ROW_INDEXED, d)
}

/// The bitmap packets for one page.
pub fn write_image_data(image: &EncodedImage, printhead_pixels: u16) -> Vec<Packet> {
    image
        .rows_data
        .iter()
        .map(|r| match &r.data {
            RowData::Void => print_empty_space(r.row_number, r.repeat),
            RowData::Pixels { black, black_count } if *black_count <= 6 => {
                print_bitmap_row_indexed(r.row_number, r.repeat, black, printhead_pixels)
            }
            RowData::Pixels { black, .. } => print_bitmap_row(r.row_number, r.repeat, black, printhead_pixels),
        })
        .collect()
}
