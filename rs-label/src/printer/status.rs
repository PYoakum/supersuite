use std::fmt;

/// Error flags from status byte 8
#[derive(Debug, Clone, Copy, Default)]
pub struct ErrorFlags1 {
    pub no_media: bool,
    pub cutter_jam: bool,
    pub weak_battery: bool,
    pub high_voltage_adapter: bool,
}

impl ErrorFlags1 {
    pub fn from_byte(b: u8) -> Self {
        Self {
            no_media: b & 0x01 != 0,
            cutter_jam: b & 0x04 != 0,
            weak_battery: b & 0x08 != 0,
            high_voltage_adapter: b & 0x40 != 0,
        }
    }

    pub fn has_error(&self) -> bool {
        self.no_media || self.cutter_jam || self.weak_battery || self.high_voltage_adapter
    }
}

/// Error flags from status byte 9
#[derive(Debug, Clone, Copy, Default)]
pub struct ErrorFlags2 {
    pub replace_media: bool,
    pub cover_open: bool,
    pub overheating: bool,
}

impl ErrorFlags2 {
    pub fn from_byte(b: u8) -> Self {
        Self {
            replace_media: b & 0x01 != 0,
            cover_open: b & 0x10 != 0,
            overheating: b & 0x20 != 0,
        }
    }

    pub fn has_error(&self) -> bool {
        self.replace_media || self.cover_open || self.overheating
    }
}

/// Media type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaType {
    None,
    LaminatedTape,
    NonLaminatedTape,
    HeatShrinkTube,
    IncompatibleTape,
    Unknown(u8),
}

impl MediaType {
    pub fn from_byte(b: u8) -> Self {
        match b {
            0x00 => MediaType::None,
            0x01 => MediaType::LaminatedTape,
            0x03 => MediaType::NonLaminatedTape,
            0x11 => MediaType::HeatShrinkTube,
            0xFF => MediaType::IncompatibleTape,
            other => MediaType::Unknown(other),
        }
    }
}

impl fmt::Display for MediaType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MediaType::None => write!(f, "No media"),
            MediaType::LaminatedTape => write!(f, "Laminated tape"),
            MediaType::NonLaminatedTape => write!(f, "Non-laminated tape"),
            MediaType::HeatShrinkTube => write!(f, "Heat shrink tube"),
            MediaType::IncompatibleTape => write!(f, "Incompatible tape"),
            MediaType::Unknown(v) => write!(f, "Unknown (0x{:02X})", v),
        }
    }
}

/// Status type (what triggered this status)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusType {
    ReplyToRequest,
    PrintingCompleted,
    ErrorOccurred,
    Notification,
    PhaseChange,
    Unknown(u8),
}

impl StatusType {
    pub fn from_byte(b: u8) -> Self {
        match b {
            0x00 => StatusType::ReplyToRequest,
            0x01 => StatusType::PrintingCompleted,
            0x02 => StatusType::ErrorOccurred,
            0x05 => StatusType::Notification,
            0x06 => StatusType::PhaseChange,
            other => StatusType::Unknown(other),
        }
    }
}

impl fmt::Display for StatusType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StatusType::ReplyToRequest => write!(f, "Reply to request"),
            StatusType::PrintingCompleted => write!(f, "Printing completed"),
            StatusType::ErrorOccurred => write!(f, "Error occurred"),
            StatusType::Notification => write!(f, "Notification"),
            StatusType::PhaseChange => write!(f, "Phase change"),
            StatusType::Unknown(v) => write!(f, "Unknown (0x{:02X})", v),
        }
    }
}

/// Parsed 32-byte printer status response
#[derive(Debug, Clone)]
pub struct PrinterStatus {
    pub raw: [u8; 32],
    pub error_flags_1: ErrorFlags1,
    pub error_flags_2: ErrorFlags2,
    pub media_width_mm: u8,
    pub media_type: MediaType,
    pub status_type: StatusType,
    pub phase_type: u8,
    pub phase_number: u16,
    pub notification_number: u8,
}

impl PrinterStatus {
    /// Parse a 32-byte status response from the printer
    pub fn parse(data: &[u8; 32]) -> Self {
        Self {
            raw: *data,
            error_flags_1: ErrorFlags1::from_byte(data[8]),
            error_flags_2: ErrorFlags2::from_byte(data[9]),
            media_width_mm: data[10],
            media_type: MediaType::from_byte(data[11]),
            status_type: StatusType::from_byte(data[18]),
            phase_type: data[19],
            phase_number: u16::from_le_bytes([data[20], data[21]]),
            notification_number: data[22],
        }
    }

    pub fn has_error(&self) -> bool {
        self.error_flags_1.has_error() || self.error_flags_2.has_error()
    }

    pub fn error_messages(&self) -> Vec<&'static str> {
        let mut msgs = Vec::new();
        let e1 = &self.error_flags_1;
        let e2 = &self.error_flags_2;
        if e1.no_media {
            msgs.push("No media");
        }
        if e1.cutter_jam {
            msgs.push("Cutter jam");
        }
        if e1.weak_battery {
            msgs.push("Weak battery");
        }
        if e1.high_voltage_adapter {
            msgs.push("High voltage adapter");
        }
        if e2.replace_media {
            msgs.push("Replace media");
        }
        if e2.cover_open {
            msgs.push("Cover open");
        }
        if e2.overheating {
            msgs.push("Overheating");
        }
        msgs
    }
}

impl fmt::Display for PrinterStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Status:     {}", self.status_type)?;
        writeln!(f, "Media:      {} ({}mm)", self.media_type, self.media_width_mm)?;
        if self.has_error() {
            writeln!(f, "Errors:     {}", self.error_messages().join(", "))?;
        } else {
            writeln!(f, "Errors:     None")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_status() {
        let mut data = [0u8; 32];
        data[0] = 0x80; // header
        data[10] = 24;  // 24mm tape
        data[11] = 0x01; // laminated
        data[18] = 0x00; // reply to request

        let status = PrinterStatus::parse(&data);
        assert_eq!(status.media_width_mm, 24);
        assert_eq!(status.media_type, MediaType::LaminatedTape);
        assert_eq!(status.status_type, StatusType::ReplyToRequest);
        assert!(!status.has_error());
    }

    #[test]
    fn test_error_flags() {
        let mut data = [0u8; 32];
        data[8] = 0x01; // no media
        data[9] = 0x10; // cover open

        let status = PrinterStatus::parse(&data);
        assert!(status.has_error());
        assert!(status.error_flags_1.no_media);
        assert!(status.error_flags_2.cover_open);
        assert_eq!(status.error_messages().len(), 2);
    }
}
