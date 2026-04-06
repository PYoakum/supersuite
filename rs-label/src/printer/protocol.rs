use std::time::Duration;

use crate::error::{LabelError, Result};

use super::commands::Command;
use super::status::PrinterStatus;
use super::usb::UsbPrinter;

/// High-level printer protocol operations
pub struct PrinterProtocol {
    printer: UsbPrinter,
}

impl PrinterProtocol {
    pub fn new(printer: UsbPrinter) -> Self {
        Self { printer }
    }

    /// Send invalidate + initialize sequence
    pub fn initialize(&self) -> Result<()> {
        self.send_command(&Command::Invalidate)?;
        std::thread::sleep(Duration::from_millis(100));
        self.send_command(&Command::Initialize)?;
        std::thread::sleep(Duration::from_millis(100));
        Ok(())
    }

    /// Request and parse printer status
    pub fn get_status(&self) -> Result<PrinterStatus> {
        self.send_command(&Command::StatusRequest)?;
        std::thread::sleep(Duration::from_millis(100));
        self.read_status()
    }

    /// Print a pre-encoded raster job (full byte stream including init/info/lines/print)
    pub fn print_raster(&self, raster_data: &[u8]) -> Result<PrinterStatus> {
        self.printer.write(raster_data)?;

        // Poll for completion — printer sends status asynchronously after printing
        // Allow generous time for physical printing + cutting
        for attempt in 0..60 {
            std::thread::sleep(Duration::from_millis(500));

            match self.read_status_tolerant() {
                Ok(status) => match status.status_type {
                    super::status::StatusType::PrintingCompleted => return Ok(status),
                    super::status::StatusType::ErrorOccurred => {
                        let errors = status.error_messages().join(", ");
                        return Err(LabelError::Printer(format!("Print error: {}", errors)));
                    }
                    _ => {
                        log::debug!("Print poll {}: {:?}", attempt, status.status_type);
                    }
                },
                Err(_) => {
                    // No data yet — printer still busy, keep polling
                    continue;
                }
            }
        }

        Err(LabelError::Protocol(
            "Timeout waiting for print completion (30s)".to_string(),
        ))
    }

    /// Send arbitrary raw bytes to the printer
    pub fn send_raw(&self, data: &[u8]) -> Result<usize> {
        self.printer.write(data)
    }

    /// Read raw response bytes from the printer
    pub fn read_raw(&self) -> Result<Vec<u8>> {
        let mut buf = [0u8; 256];
        match self.printer.read_timeout(&mut buf, Duration::from_millis(500)) {
            Ok(n) => Ok(buf[..n].to_vec()),
            Err(LabelError::Usb(rusb::Error::Timeout)) => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    /// Send a single command
    fn send_command(&self, cmd: &Command) -> Result<usize> {
        let data = cmd.encode();
        self.printer.write(&data)
    }

    /// Try to read a 32-byte status, returning Err on timeout/short read (non-fatal)
    fn read_status_tolerant(&self) -> Result<PrinterStatus> {
        let mut buf = [0u8; 32];
        let mut total = 0;

        for _ in 0..3 {
            match self.printer.read_timeout(&mut buf[total..], Duration::from_millis(500)) {
                Ok(n) => {
                    total += n;
                    if total >= 32 {
                        break;
                    }
                }
                Err(LabelError::Usb(rusb::Error::Timeout)) => {
                    if total > 0 {
                        break;
                    }
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        if total != 32 {
            return Err(LabelError::Protocol(format!(
                "Short read: {} bytes",
                total
            )));
        }
        Ok(PrinterStatus::parse(&buf))
    }

    /// Read and parse a 32-byte status response, retrying on short/empty reads
    fn read_status(&self) -> Result<PrinterStatus> {
        let mut buf = [0u8; 32];
        let mut total = 0;

        for _ in 0..10 {
            match self.printer.read_timeout(&mut buf[total..], Duration::from_millis(500)) {
                Ok(n) => {
                    total += n;
                    if total >= 32 {
                        break;
                    }
                }
                Err(LabelError::Usb(rusb::Error::Timeout)) => {
                    if total > 0 {
                        break;
                    }
                    // Keep waiting if nothing received yet
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        if total != 32 {
            return Err(LabelError::Protocol(format!(
                "Expected 32-byte status, got {} bytes",
                total
            )));
        }
        Ok(PrinterStatus::parse(&buf))
    }
}
