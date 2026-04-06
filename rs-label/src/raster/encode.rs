use crate::printer::commands::Command;

use super::convert::RasterBitmap;

/// Assemble a complete print job byte stream from a raster bitmap.
///
/// Sequence: invalidate -> init -> switch to raster mode -> set print info ->
/// set various mode -> set advanced mode -> set margin -> raster lines -> print+feed
pub fn encode_print_job(
    bitmap: &RasterBitmap,
    media_type: u8,
    media_width_mm: u8,
    auto_cut: bool,
) -> Vec<u8> {
    let mut data = Vec::new();

    // 1. Invalidate - clear any pending state
    data.extend_from_slice(&Command::Invalidate.encode());

    // 2. Initialize
    data.extend_from_slice(&Command::Initialize.encode());

    // 3. Switch to raster mode
    data.extend_from_slice(&Command::SwitchMode(0x01).encode());

    // 4. Set print information
    let raster_lines = bitmap.lines.len() as u32;
    data.extend_from_slice(
        &Command::SetPrintInfo {
            media_type,
            media_width: media_width_mm,
            media_length: 0, // continuous tape
            raster_lines,
        }
        .encode(),
    );

    // 5. Set various mode (auto-cut)
    let various_flag = if auto_cut { 0x40 } else { 0x00 };
    data.extend_from_slice(&Command::SetVariousMode(various_flag).encode());

    // 6. Set advanced mode (no chain printing)
    data.extend_from_slice(&Command::SetAdvancedMode(0x01).encode());

    // 7. No compression
    data.extend_from_slice(&Command::SetCompression(0x00).encode());

    // 8. Set margin (feed amount before print)
    data.extend_from_slice(&Command::SetMargin(14).encode());

    // 9. Raster data lines
    for line in &bitmap.lines {
        if line.iter().all(|&b| b == 0) {
            data.extend_from_slice(&Command::ZeroRaster.encode());
        } else {
            data.extend_from_slice(&Command::RasterTransfer(line.clone()).encode());
        }
    }

    // 10. Print and feed
    data.extend_from_slice(&Command::PrintAndFeed.encode());

    data
}
