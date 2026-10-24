//! Niimbot label printer protocol, ported from [niimbluelib](https://github.com/MultiMote/niimbluelib).
//!
//! The pure protocol pieces (packets, image encoding, response parsing, model
//! table) are checked byte for byte against niimbluelib in `tests/reference.rs`.
//! [`Client`] drives a printer over any [`Transport`]; the `ble` feature
//! provides one for Bluetooth LE via btleplug.

#[cfg(feature = "ble")]
pub mod ble;
pub mod client;
pub mod commands;
pub mod encoder;
pub mod generator;
pub mod models;
mod models_gen;
pub mod packet;
pub mod parser;
pub mod transport;

pub use client::{Client, ClientEvent, PrintOptions, PrinterInfo};
pub use encoder::{encode_image, Bitmap, EncodedImage};
pub use models::{ModelMeta, PrintDirection, PrintTaskName};
pub use packet::Packet;
pub use parser::{HeartbeatData, RfidInfo};
pub use transport::Transport;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Timed out waiting for the printer to respond")]
    Timeout,
    #[error("Printer error {code}: {name}")]
    Print { code: u8, name: &'static str },
    #[error("The printer doesn't support this command")]
    NotSupported,
    #[error("Invalid packet: {0}")]
    InvalidPacket(String),
    #[error("Not connected to a printer")]
    NotConnected,
    #[error("{0}")]
    Unsupported(String),
    #[error("Bluetooth: {0}")]
    Transport(String),
}

pub type Result<T> = std::result::Result<T, Error>;
