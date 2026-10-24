//! Turns a 1-bit label image into printer rows, mirroring niimbluelib's `ImageEncoder`.

use crate::models::PrintDirection;

/// A 1-bit image in canvas orientation: row-major, MSB first, rows padded to whole bytes.
#[derive(Debug, Clone)]
pub struct Bitmap {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Bitmap {
    /// Builds a bitmap from tightly packed bits (no per-row padding), as sent by the UI.
    pub fn from_packed(width: u32, height: u32, packed: &[u8]) -> Self {
        Self { width, height, data: packed.to_vec() }
    }

    fn is_black(&self, x: u32, y: u32) -> bool {
        let i = (y * self.width + x) as usize;
        self.data.get(i / 8).is_some_and(|b| b & (0x80 >> (i % 8)) != 0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RowData {
    Void,
    Pixels { black: Vec<u8>, black_count: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageRow {
    pub row_number: u16,
    pub repeat: u8,
    pub data: RowData,
}

#[derive(Debug, Clone)]
pub struct EncodedImage {
    pub cols: u16,
    pub rows: u16,
    pub rows_data: Vec<ImageRow>,
}

/// Encode a bitmap for printing. `Left` rotates the canvas 90° clockwise so
/// the label's length runs along the paper feed.
pub fn encode_image(bitmap: &Bitmap, direction: PrintDirection) -> EncodedImage {
    let (original_cols, rows) = match direction {
        PrintDirection::Left => (bitmap.height, bitmap.width),
        PrintDirection::Top => (bitmap.width, bitmap.height),
    };
    let cols = original_cols.div_ceil(8) * 8;
    let mut rows_data: Vec<ImageRow> = Vec::new();

    for row in 0..rows {
        let mut black = vec![0u8; (cols / 8) as usize];
        let mut count = 0;
        for col in 0..original_cols {
            let (x, y) = match direction {
                PrintDirection::Left => (row, bitmap.height - 1 - col),
                PrintDirection::Top => (col, row),
            };
            if bitmap.is_black(x, y) {
                black[(col / 8) as usize] |= 0x80 >> (col % 8);
                count += 1;
            }
        }
        let data = if count == 0 { RowData::Void } else { RowData::Pixels { black, black_count: count } };

        // Identical consecutive rows are sent once with a repeat count.
        match rows_data.last_mut() {
            Some(last) if last.data == data && last.repeat < u8::MAX => last.repeat += 1,
            _ => rows_data.push(ImageRow { row_number: row as u16, repeat: 1, data }),
        }
    }

    EncodedImage { cols: cols as u16, rows: rows as u16, rows_data }
}
