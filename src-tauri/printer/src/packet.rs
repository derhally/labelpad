use crate::{commands::req, Error, Result};

const HEAD: [u8; 2] = [0x55, 0x55];
const TAIL: [u8; 2] = [0xaa, 0xaa];

/// `[0x55, 0x55, CMD, LEN, DATA…, XOR CHECKSUM, 0xAA, 0xAA]`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packet {
    pub command: u8,
    pub data: Vec<u8>,
}

impl Packet {
    pub fn new(command: u8, data: impl Into<Vec<u8>>) -> Self {
        Self { command, data: data.into() }
    }

    pub fn checksum(&self) -> u8 {
        self.data.iter().fold(self.command ^ self.data.len() as u8, |acc, b| acc ^ b)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.data.len() + 8);
        // The connect packet carries an extra leading 0x03.
        if self.command == req::CONNECT {
            out.push(3);
        }
        out.extend_from_slice(&HEAD);
        out.push(self.command);
        out.push(self.data.len() as u8);
        out.extend_from_slice(&self.data);
        out.push(self.checksum());
        out.extend_from_slice(&TAIL);
        out
    }

    pub fn from_bytes(buf: &[u8]) -> Result<Self> {
        if buf.len() < 7 {
            return Err(Error::InvalidPacket(format!("too short ({} bytes)", buf.len())));
        }
        if buf[..2] != HEAD || buf[buf.len() - 2..] != TAIL {
            return Err(Error::InvalidPacket("bad head or tail".into()));
        }
        let len = buf[3] as usize;
        if buf.len() != 7 + len {
            return Err(Error::InvalidPacket(format!("length {} doesn't match {}", buf.len(), 7 + len)));
        }
        let packet = Packet::new(buf[2], &buf[4..4 + len]);
        if packet.checksum() != buf[4 + len] {
            return Err(Error::InvalidPacket("bad checksum".into()));
        }
        Ok(packet)
    }
}

/// Reassembles packets from Bluetooth notifications, which may split or join them.
#[derive(Default)]
pub struct PacketReader {
    buf: Vec<u8>,
}

impl PacketReader {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Packet> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        loop {
            if self.buf.len() >= 2 && self.buf[..2] != HEAD {
                log::warn!("dropping invalid buffer {:02x?}", self.buf);
                self.buf.clear();
                break;
            }
            if self.buf.len() < 4 {
                break;
            }
            let total = 7 + self.buf[3] as usize;
            if self.buf.len() < total {
                break;
            }
            let raw: Vec<u8> = self.buf.drain(..total).collect();
            match Packet::from_bytes(&raw) {
                Ok(p) => out.push(p),
                Err(e) => {
                    log::warn!("dropping packet {:02x?}: {e}", raw);
                    self.buf.clear();
                    break;
                }
            }
        }
        out
    }
}
