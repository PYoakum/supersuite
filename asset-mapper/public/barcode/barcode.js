// public/barcode/barcode.js — Code 128B 1D barcode encoder
//
// Code 128 Subset B encodes the full printable ASCII range (0x20–0x7E),
// which covers the entire asset://device/<uuid> payload.
//
// Structure per symbol: 11 modules (bars + spaces), stop symbol: 13 modules.
// Each module width is one "unit" (scaled to the requested canvas width).

// ── Code 128 symbol table (subset B values 0–102) ────────────────────────────
// Each entry is an 11-bit integer, MSB first: 1 = bar, 0 = space.
// Values indexed by Code 128 symbol number.
const C128_PATTERNS = [
  0b11011001100, 0b11001101100, 0b11001100110, 0b10010011000, 0b10010001100,
  0b10001001100, 0b10011001000, 0b10011000100, 0b10001100100, 0b11001001000,
  0b11001000100, 0b11000100100, 0b10110011100, 0b10011011100, 0b10011001110,
  0b10111001100, 0b10011101100, 0b10011100110, 0b11001110010, 0b11001011100,
  0b11001001110, 0b11011100100, 0b11001110100, 0b11101101110, 0b11101001100,
  0b11100101100, 0b11100100110, 0b11101100100, 0b11100110100, 0b11100110010,
  0b11011011000, 0b11011000110, 0b11000110110, 0b10100011000, 0b10001011000,
  0b10001000110, 0b10110001000, 0b10001101000, 0b10001100010, 0b11010001000,
  0b11000101000, 0b11000100010, 0b10110111000, 0b10110001110, 0b10001101110,
  0b10111011000, 0b10111000110, 0b10001110110, 0b11101110110, 0b11010001110,
  0b11000101110, 0b11011101000, 0b11011100010, 0b11011101110, 0b11101011000,
  0b11101000110, 0b11100010110, 0b11101101000, 0b11101100010, 0b11100011010,
  0b11101111010, 0b11001000010, 0b11110001010, 0b10100110000, 0b10100001100,
  0b10010110000, 0b10010000110, 0b10000101100, 0b10000100110, 0b10110010000,
  0b10110000100, 0b10011010000, 0b10011000010, 0b10000110100, 0b10000110010,
  0b11000010010, 0b11001010000, 0b11110111010, 0b11000010100, 0b10001111010,
  0b10100111100, 0b10010111100, 0b10010011110, 0b10111100100, 0b10011110100,
  0b10011110010, 0b11110100100, 0b11110010100, 0b11110010010, 0b11011011110,
  0b11011110110, 0b11110110110, 0b10101111000, 0b10100011110, 0b10001011110,
  0b10111101000, 0b10111100010, 0b11110101000, 0b11110100010, 0b10111011110,
  0b10111101110, 0b11101011110, 0b11110101110,
  // Special: Start B (104), Stop (106) appended below
];

const START_B  = 0b11010010000; // symbol value 104
const STOP     = 0b11000111010; // stop pattern (13 modules)

/**
 * Encode text as Code 128B and return an array of module widths.
 * Each element is 1 (a single module-wide bar or space), grouped as
 * alternating bar/space starting with a bar.
 * Returns flat bit array: 1 = dark module, 0 = light module.
 */
function encode128B(text) {
  const bits = [];

  function pushPattern(pattern, width = 11) {
    for (let i = width - 1; i >= 0; i--) {
      bits.push((pattern >>> i) & 1);
    }
  }

  // Quiet zone (10 modules of light)
  for (let i = 0; i < 10; i++) bits.push(0);

  // Start B
  pushPattern(START_B);

  // Data symbols — Subset B: symbol value = char code − 32
  let checksum = 104; // Start B value
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error(`Code 128B: unsupported character at index ${i} (code ${code})`);
    }
    const symVal = code - 32;
    checksum += symVal * (i + 1);
    pushPattern(C128_PATTERNS[symVal]);
  }

  // Check symbol
  const checkSym = checksum % 103;
  pushPattern(C128_PATTERNS[checkSym]);

  // Stop symbol (13 modules)
  pushPattern(STOP, 13);

  // Quiet zone
  for (let i = 0; i < 10; i++) bits.push(0);

  return bits;
}

/**
 * Render a Code 128B barcode onto a canvas element.
 *
 * @param {string}            text    - The string to encode
 * @param {HTMLCanvasElement} canvas  - Target canvas
 * @param {number}            width   - Canvas width in px  (default 340)
 * @param {number}            height  - Canvas height in px (default 80)
 * @param {boolean}           showText - Print human-readable text below bars
 */
export function renderBarcode(text, canvas, width = 340, height = 80, showText = true) {
  // Sanitise: replace any non-printable ASCII with '?'
  const safe = text.replace(/[^\x20-\x7E]/g, '?');

  let bits;
  try {
    bits = encode128B(safe);
  } catch (e) {
    console.error('Code 128 encode error:', e);
    _drawError(canvas, width, height, e.message);
    return;
  }

  const textAreaH = showText ? 14 : 0;
  const barH      = height - textAreaH - 8; // 4px padding top + bottom
  const moduleW   = width / bits.length;

  canvas.width  = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      ctx.fillRect(Math.floor(i * moduleW), 4, Math.ceil(moduleW), barH);
    }
  }

  if (showText) {
    ctx.fillStyle = '#000000';
    ctx.font = '9px "Inter", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const displayText = safe.length > 48 ? safe.slice(0, 47) + '…' : safe;
    ctx.fillText(displayText, width / 2, height - 1);
  }
}

// Keep renderQR as an alias so any stale references don't hard-crash
export const renderQR = renderBarcode;

function _drawError(canvas, w, h, msg) {
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f87171';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Encode error: ' + msg.slice(0, 40), w / 2, h / 2);
}
