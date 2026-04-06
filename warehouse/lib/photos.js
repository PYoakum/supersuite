import sharp from "sharp";

export async function generateThumbnail(buffer) {
  return sharp(buffer)
    .resize(300, 300, { fit: "inside" })
    .png()
    .toBuffer();
}
