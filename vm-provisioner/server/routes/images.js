/**
 * Image listing endpoint
 */

import { jsonResponse } from "../middleware.js";
import { listImages } from "../../images/index.js";

let imagesDir = "./images";

export function setImagesDir(dir) {
  imagesDir = dir;
}

export async function handleListImages(url) {
  const backend = url.searchParams.get("backend") || undefined;
  const images = await listImages(imagesDir, backend);
  return jsonResponse({ success: true, data: images });
}
