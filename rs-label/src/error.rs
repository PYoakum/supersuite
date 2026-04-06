use thiserror::Error;

#[derive(Error, Debug)]
pub enum LabelError {
    #[error("USB error: {0}")]
    Usb(#[from] rusb::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Printer error: {0}")]
    Printer(String),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Configuration error: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, LabelError>;
