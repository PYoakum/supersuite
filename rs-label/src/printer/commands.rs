/// Brother P-touch printer commands
///
/// Reference: Brother Raster Command Reference for PT series printers
#[derive(Debug, Clone)]
pub enum Command {
    /// Send 100 bytes of 0x00 to clear any pending state
    Invalidate,

    /// ESC @ -- Initialize printer
    Initialize,

    /// ESC i S -- Request status
    StatusRequest,

    /// ESC i a <mode> -- Switch dynamic command mode
    /// 0x00 = ESC/P, 0x01 = Raster mode, 0x03 = P-touch Template
    SwitchMode(u8),

    /// ESC i z <flags> <media_type> <media_width> <media_length> <num_lines_lo> <num_lines_hi> <page> <zero>
    /// Set print information (media type, width, raster lines count)
    SetPrintInfo {
        media_type: u8,
        media_width: u8,
        media_length: u8,
        raster_lines: u32,
    },

    /// ESC i M <flag> -- Various mode settings
    /// Bit 6: auto-cut
    SetVariousMode(u8),

    /// ESC i A <flag> -- Advanced mode settings
    /// Bit 0: no chain, Bit 2: no buffer clearing
    SetAdvancedMode(u8),

    /// ESC i K <flag> -- Compression mode
    /// 0x00 = none, 0x02 = TIFF
    SetCompression(u8),

    /// ESC i d <margin_lo> <margin_hi> -- Set margin (feed) amount
    SetMargin(u16),

    /// G <len_lo> <len_hi> <data...> -- Transfer raster line
    RasterTransfer(Vec<u8>),

    /// Z -- Transfer zero/blank raster line
    ZeroRaster,

    /// 0x1A -- Print with feeding
    PrintAndFeed,

    /// 0xFF -- Print without feeding (for chained prints)
    PrintWithoutFeed,
}

impl Command {
    /// Serialize command to bytes for transmission
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Command::Invalidate => vec![0x00; 100],

            Command::Initialize => vec![0x1B, 0x40], // ESC @

            Command::StatusRequest => vec![0x1B, 0x69, 0x53], // ESC i S

            Command::SwitchMode(mode) => vec![0x1B, 0x69, 0x61, *mode], // ESC i a

            Command::SetPrintInfo {
                media_type,
                media_width,
                media_length,
                raster_lines,
            } => {
                let mut cmd = vec![
                    0x1B,
                    0x69,
                    0x7A, // ESC i z
                    0x8E, // flags: PI_KIND | PI_WIDTH | PI_LENGTH | PI_RECOVER
                    *media_type,
                    *media_width,
                    *media_length,
                ];
                // Raster lines as 4 bytes LE
                cmd.push((*raster_lines & 0xFF) as u8);
                cmd.push(((*raster_lines >> 8) & 0xFF) as u8);
                cmd.push(((*raster_lines >> 16) & 0xFF) as u8);
                cmd.push(((*raster_lines >> 24) & 0xFF) as u8);
                cmd.push(0x00); // page = 0 (starting page)
                cmd.push(0x00); // padding
                cmd
            }

            Command::SetVariousMode(flag) => vec![0x1B, 0x69, 0x4D, *flag], // ESC i M

            Command::SetAdvancedMode(flag) => vec![0x1B, 0x69, 0x4B, *flag], // ESC i K

            Command::SetCompression(mode) => vec![0x4D, *mode], // M <mode>

            Command::SetMargin(margin) => {
                vec![
                    0x1B,
                    0x69,
                    0x64, // ESC i d
                    (*margin & 0xFF) as u8,
                    ((*margin >> 8) & 0xFF) as u8,
                ]
            }

            Command::RasterTransfer(data) => {
                let len = data.len() as u16;
                let mut cmd = vec![0x47, (len & 0xFF) as u8, ((len >> 8) & 0xFF) as u8]; // G <len_lo> <len_hi>
                cmd.extend_from_slice(data);
                cmd
            }

            Command::ZeroRaster => vec![0x5A], // Z

            Command::PrintAndFeed => vec![0x1A],

            Command::PrintWithoutFeed => vec![0xFF],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalidate_length() {
        assert_eq!(Command::Invalidate.encode().len(), 100);
        assert!(Command::Invalidate.encode().iter().all(|&b| b == 0));
    }

    #[test]
    fn test_initialize() {
        assert_eq!(Command::Initialize.encode(), vec![0x1B, 0x40]);
    }

    #[test]
    fn test_status_request() {
        assert_eq!(
            Command::StatusRequest.encode(),
            vec![0x1B, 0x69, 0x53]
        );
    }

    #[test]
    fn test_raster_transfer() {
        let data = vec![0xFF; 16];
        let encoded = Command::RasterTransfer(data).encode();
        assert_eq!(encoded[0], 0x47);
        assert_eq!(encoded[1], 16); // len_lo
        assert_eq!(encoded[2], 0);  // len_hi
        assert_eq!(encoded.len(), 19);
    }

    #[test]
    fn test_set_margin() {
        let encoded = Command::SetMargin(14).encode();
        assert_eq!(encoded, vec![0x1B, 0x69, 0x64, 14, 0]);
    }
}
