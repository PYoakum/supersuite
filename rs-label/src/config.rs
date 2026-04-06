use serde::Deserialize;

use crate::error::{LabelError, Result};

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub printer: PrinterConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PrinterConfig {
    /// USB vendor ID (Brother = 0x04F9)
    #[serde(default = "default_vendor_id")]
    pub vendor_id: u16,

    /// USB product ID (PT-D600 = 0x209B)
    #[serde(default = "default_product_id")]
    pub product_id: u16,

    /// USB communication timeout in milliseconds
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,

    /// Default directory for image files
    #[serde(default = "default_image_dir")]
    pub image_dir: String,

    /// Black/white threshold (0-255)
    #[serde(default = "default_threshold")]
    pub threshold: u8,

    /// Tape width in mm
    #[serde(default = "default_tape_width")]
    pub tape_width_mm: u8,
}

impl Default for PrinterConfig {
    fn default() -> Self {
        Self {
            vendor_id: default_vendor_id(),
            product_id: default_product_id(),
            timeout_ms: default_timeout_ms(),
            image_dir: default_image_dir(),
            threshold: default_threshold(),
            tape_width_mm: default_tape_width(),
        }
    }
}

fn default_vendor_id() -> u16 {
    0x04F9
}
fn default_product_id() -> u16 {
    0x2074
}
fn default_timeout_ms() -> u64 {
    5000
}
fn default_image_dir() -> String {
    "./labels".to_string()
}
fn default_threshold() -> u8 {
    128
}
fn default_tape_width() -> u8 {
    24
}

/// Pixel width for a given tape width in mm at 180 DPI
pub fn tape_pixels(tape_width_mm: u8) -> u16 {
    match tape_width_mm {
        6 => 32,
        9 => 52,
        12 => 70,
        18 => 104,
        24 => 128,
        _ => 128,
    }
}

/// Number of bytes per raster line for a given tape width
pub fn tape_bytes_per_line(tape_width_mm: u8) -> u8 {
    ((tape_pixels(tape_width_mm) + 7) / 8) as u8
}

pub fn load_config(path: &str) -> Result<Config> {
    let contents = std::fs::read_to_string(path)
        .map_err(|e| LabelError::Config(format!("Failed to read config file '{}': {}", path, e)))?;

    let config: Config = toml::from_str(&contents)
        .map_err(|e| LabelError::Config(format!("Failed to parse config: {}", e)))?;

    Ok(config)
}
