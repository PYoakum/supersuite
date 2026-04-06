use image::imageops::FilterType;
use image::{DynamicImage, GrayImage};

use crate::config::tape_pixels;
use crate::error::Result;

/// PT-D600 printhead is always 128 pins = 16 bytes per raster line,
/// regardless of actual tape width.
const RASTER_LINE_BYTES: u8 = 16;
const RASTER_LINE_PIXELS: u16 = 128;

/// Raster bitmap ready for the printer: each line is one column of the label
/// (the printhead is perpendicular to the feed direction)
pub struct RasterBitmap {
    /// Packed 1-bit lines, MSB-first. Always 16 bytes per line (128 pins).
    pub lines: Vec<Vec<u8>>,
    /// Number of bytes per raster line (always 16 for PT-D600)
    pub bytes_per_line: u8,
}

/// Load an image file and convert to a 1-bit raster bitmap suitable for the printer.
///
/// The image is:
/// 1. Loaded and converted to grayscale
/// 2. Resized so its height matches the tape pixel width (printhead is perpendicular)
/// 3. Thresholded to 1-bit
/// 4. Transposed: image columns become raster lines
/// 5. Packed into bytes (MSB-first)
pub fn image_to_raster(
    path: &str,
    tape_width_mm: u8,
    threshold: u8,
    invert: bool,
) -> Result<RasterBitmap> {
    let img = image::open(path)?;
    let pixels = tape_pixels(tape_width_mm);
    Ok(convert_image(&img, pixels, threshold, invert))
}

/// Convert a DynamicImage to RasterBitmap
///
/// The PT-D600 printhead has 128 pins, so every raster line is always 16 bytes.
/// For narrower tape, the image pixels are placed at an offset within the 128-bit
/// line so they align with the physical tape position on the printhead.
pub fn convert_image(
    img: &DynamicImage,
    tape_px: u16,
    threshold: u8,
    invert: bool,
) -> RasterBitmap {
    let gray = img.to_luma8();

    // Resize so height = tape pixel width, preserving aspect ratio
    let (orig_w, orig_h) = gray.dimensions();
    let new_h = tape_px as u32;
    let new_w = ((orig_w as f64 * new_h as f64 / orig_h as f64).round() as u32).max(1);
    let resized = image::imageops::resize(&gray, new_w, new_h, FilterType::Lanczos3);

    // Threshold to boolean grid (true = black = printed pixel)
    let binary = threshold_to_bool(&resized, threshold, invert);

    // Pin offset: the tape is centered on the printhead. For 128 pins total
    // and tape_px active pins, the offset from pin 0 is:
    let pin_offset = ((RASTER_LINE_PIXELS - tape_px) / 2) as usize;

    // Transpose: each column of the image becomes one 16-byte raster line
    let mut lines = Vec::with_capacity(new_w as usize);

    for x in 0..new_w as usize {
        let mut line = vec![0u8; RASTER_LINE_BYTES as usize];
        for y in 0..new_h as usize {
            if binary[x][y] {
                let pin = pin_offset + y;
                let byte_idx = pin / 8;
                let bit_idx = 7 - (pin % 8); // MSB-first
                if byte_idx < RASTER_LINE_BYTES as usize {
                    line[byte_idx] |= 1 << bit_idx;
                }
            }
        }
        lines.push(line);
    }

    RasterBitmap {
        lines,
        bytes_per_line: RASTER_LINE_BYTES,
    }
}

/// Threshold a grayscale image to a 2D boolean grid [x][y]
/// true = dark/black = printed pixel
fn threshold_to_bool(img: &GrayImage, threshold: u8, invert: bool) -> Vec<Vec<bool>> {
    let (w, h) = img.dimensions();
    let mut result = vec![vec![false; h as usize]; w as usize];
    for y in 0..h {
        for x in 0..w {
            let pixel = img.get_pixel(x, y).0[0];
            let is_dark = pixel < threshold;
            result[x as usize][y as usize] = if invert { !is_dark } else { is_dark };
        }
    }
    result
}

/// Generate a text-art preview of a raster bitmap using half-block characters
pub fn raster_preview(bitmap: &RasterBitmap, max_width: usize, max_height: usize) -> Vec<String> {
    let num_lines = bitmap.lines.len();
    let pixel_height = bitmap.bytes_per_line as usize * 8;

    if num_lines == 0 {
        return vec!["(empty)".to_string()];
    }

    // Scale factors
    let x_scale = ((num_lines + max_width - 1) / max_width).max(1);
    let y_scale = ((pixel_height + max_height * 2 - 1) / (max_height * 2)).max(1);

    let out_w = (num_lines + x_scale - 1) / x_scale;
    let out_h = (pixel_height + y_scale * 2 - 1) / (y_scale * 2);

    let mut rows = Vec::with_capacity(out_h);

    for row in 0..out_h {
        let mut line = String::with_capacity(out_w);
        for col in 0..out_w {
            let x = col * x_scale;
            let y_top = row * y_scale * 2;
            let y_bot = y_top + y_scale;

            let top_set = is_pixel_set(bitmap, x, y_top);
            let bot_set = is_pixel_set(bitmap, x, y_bot);

            line.push(match (top_set, bot_set) {
                (true, true) => '\u{2588}',   // full block
                (true, false) => '\u{2580}',  // upper half
                (false, true) => '\u{2584}',  // lower half
                (false, false) => ' ',
            });
        }
        rows.push(line);
    }

    rows
}

/// Check if a pixel is set in the raster bitmap
fn is_pixel_set(bitmap: &RasterBitmap, x: usize, y: usize) -> bool {
    if x >= bitmap.lines.len() {
        return false;
    }
    let line = &bitmap.lines[x];
    let byte_idx = y / 8;
    if byte_idx >= line.len() {
        return false;
    }
    let bit_idx = 7 - (y % 8);
    line[byte_idx] & (1 << bit_idx) != 0
}
