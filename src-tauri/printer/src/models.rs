use serde::Serialize;

pub use crate::models_gen::MODELS;
use crate::models_gen::{MODEL_TASKS, MODEL_VERSION_TASKS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PrintDirection {
    Left,
    Top,
}

/// Print algorithms; different models need different command sequences.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PrintTaskName {
    D11V1,
    D110,
    B1,
    B21V1,
    B21L2B,
    D110MV4,
    H1S,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMeta {
    pub model: &'static str,
    pub ids: &'static [u16],
    pub dpi: u16,
    pub print_direction: PrintDirection,
    pub printhead_pixels: u16,
    pub density_min: u8,
    pub density_max: u8,
    pub density_default: u8,
}

pub fn find_model(model_id: u16) -> Option<&'static ModelMeta> {
    MODELS.iter().find(|m| m.ids.contains(&model_id))
}

/// Same lookup as niimbluelib's `findPrintTask`.
pub fn find_print_task(model: &str, protocol_version: Option<u8>) -> Option<PrintTaskName> {
    if let Some(v) = protocol_version {
        if let Some((_, _, t)) = MODEL_VERSION_TASKS.iter().find(|(m, pv, _)| *m == model && *pv == v) {
            return Some(*t);
        }
    }
    if let Some((_, t)) = MODEL_TASKS.iter().find(|(m, _)| *m == model) {
        return Some(*t);
    }
    match protocol_version {
        Some(v) if v >= 4 => Some(PrintTaskName::D110MV4),
        _ => None,
    }
}

/// First letters of every model name; Niimbot printers advertise names like "D11-…".
pub fn name_prefixes() -> Vec<char> {
    let mut out: Vec<char> = Vec::new();
    for m in MODELS {
        if let Some(c) = m.model.chars().next() {
            if !out.contains(&c) {
                out.push(c);
            }
        }
    }
    out
}
