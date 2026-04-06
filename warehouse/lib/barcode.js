import bwipjs from "bwip-js";

const SYMBOLOGY_MAP = {
  Code128: "code128",
  Code39: "code39",
  EAN13: "ean13",
  UPCA: "upca",
};

export async function generateBarcodeImage(symbology, value) {
  const bcid = SYMBOLOGY_MAP[symbology] || "code128";
  const png = await bwipjs.toBuffer({
    bcid,
    text: value,
    scale: 3,
    height: 10,
    includetext: true,
    textxalign: "center",
  });
  return Buffer.from(png);
}
