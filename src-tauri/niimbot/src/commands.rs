//! Command ids. Requests go to the printer, responses come back.

pub mod req {
    pub const CONNECT: u8 = 0xc1;
    pub const HEARTBEAT: u8 = 0xdc;
    pub const PAGE_END: u8 = 0xe3;
    pub const PAGE_START: u8 = 0x03;
    pub const PRINT_BITMAP_ROW: u8 = 0x85;
    pub const PRINT_BITMAP_ROW_INDEXED: u8 = 0x83;
    pub const PRINT_CLEAR: u8 = 0x20;
    pub const PRINT_EMPTY_ROW: u8 = 0x84;
    pub const PRINT_END: u8 = 0xf3;
    pub const PRINTER_INFO: u8 = 0x40;
    pub const PRINTER_STATUS_DATA: u8 = 0xa5;
    pub const PRINT_QUANTITY: u8 = 0x15;
    pub const PRINT_START: u8 = 0x01;
    pub const PRINT_STATUS: u8 = 0xa3;
    pub const RFID_INFO: u8 = 0x1a;
    pub const SET_DENSITY: u8 = 0x21;
    pub const SET_LABEL_TYPE: u8 = 0x23;
    pub const SET_PAGE_SIZE: u8 = 0x13;
}

pub mod resp {
    pub const NOT_SUPPORTED: u8 = 0x00;
    pub const CONNECT: u8 = 0xc2;
    pub const HEARTBEAT_ADVANCED1: u8 = 0xdd;
    pub const HEARTBEAT_BASIC: u8 = 0xde;
    pub const HEARTBEAT_PRINTER_INFO: u8 = 0xdf;
    pub const HEARTBEAT_ADVANCED2: u8 = 0xd9;
    pub const PAGE_START: u8 = 0x04;
    pub const PRINT_CLEAR: u8 = 0x30;
    pub const PRINT_END: u8 = 0xf4;
    pub const PRINTER_STATUS_DATA: u8 = 0xb5;
    pub const PRINT_STATUS: u8 = 0xb3;
    pub const RFID_INFO: u8 = 0x1b;
    pub const PRINT_ERROR: u8 = 0xdb;
    pub const PRINT_QUANTITY: u8 = 0x16;
    pub const PRINT_START: u8 = 0x02;
    pub const SET_DENSITY: u8 = 0x31;
    pub const SET_LABEL_TYPE: u8 = 0x33;
    pub const SET_PAGE_SIZE: u8 = 0x14;
    pub const PAGE_END: u8 = 0xe4;
    pub const PRINTER_PAGE_INDEX: u8 = 0xe0;
    /// Every `PrinterInfo` sub-type answers with its own id; 0x41..=0x4f covers them.
    pub const PRINTER_INFO_RANGE: std::ops::RangeInclusive<u8> = 0x41..=0x4f;
}

/// `PrinterInfo` request sub-types.
pub mod info {
    pub const SOFTWARE_VERSION: u8 = 9;
    pub const PRINTER_MODEL_ID: u8 = 8;
    pub const BATTERY_CHARGE_LEVEL: u8 = 10;
    pub const HARDWARE_VERSION: u8 = 12;
}

pub mod heartbeat {
    pub const ADVANCED1: u8 = 1;
    pub const PRINTER_INFO: u8 = 3;
    pub const ADVANCED2: u8 = 4;
}

pub mod connect_result {
    pub const CONNECTED_NEW: u8 = 2;
    pub const CONNECTED_V3: u8 = 3;
}

/// Responses a request expects. `None` means the request gets no reply.
pub fn responses_for(cmd: u8) -> Option<Vec<u8>> {
    use req::*;
    let ids: Vec<u8> = match cmd {
        PRINT_BITMAP_ROW | PRINT_BITMAP_ROW_INDEXED | PRINT_EMPTY_ROW => return None,
        CONNECT => vec![resp::CONNECT],
        HEARTBEAT => vec![resp::HEARTBEAT_BASIC, resp::HEARTBEAT_PRINTER_INFO, resp::HEARTBEAT_ADVANCED1, resp::HEARTBEAT_ADVANCED2],
        PAGE_END => vec![resp::PAGE_END],
        PAGE_START => vec![resp::PAGE_START],
        PRINT_CLEAR => vec![resp::PRINT_CLEAR],
        PRINT_END => vec![resp::PRINT_END],
        PRINTER_INFO => resp::PRINTER_INFO_RANGE.collect(),
        PRINTER_STATUS_DATA => vec![resp::PRINTER_STATUS_DATA],
        PRINT_QUANTITY => vec![resp::PRINT_QUANTITY],
        RFID_INFO => vec![resp::RFID_INFO],
        PRINT_START => vec![resp::PRINT_START],
        PRINT_STATUS => vec![resp::PRINT_STATUS],
        SET_DENSITY => vec![resp::SET_DENSITY],
        SET_LABEL_TYPE => vec![resp::SET_LABEL_TYPE],
        SET_PAGE_SIZE => vec![resp::SET_PAGE_SIZE],
        _ => vec![],
    };
    Some(ids)
}

/// Human-readable names for `PrintError` codes.
pub fn print_error_name(code: u8) -> &'static str {
    match code {
        1 => "Lid is open",
        2 => "Out of labels",
        3 => "Battery is low",
        4 => "Battery problem",
        5 => "Cancelled on the printer",
        6 => "Data error",
        7 => "Printer is overheated",
        8 => "Label feed problem",
        9 => "Printer is busy",
        10 => "No printhead",
        11 => "Too cold to print",
        12 => "Printhead is loose",
        16 => "Wrong labels for this printer",
        17 => "Couldn't set label type",
        19 => "Couldn't set darkness",
        22 => "Communication problem",
        24 => "Label size is wrong",
        50 => "Label is too long",
        52 => "Timed out receiving data",
        _ => "Unknown error",
    }
}
