/**
 * Generic JSON state load/save via Bun.file/Bun.write
 */

export async function loadJson(path, fallback = null) {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return fallback;
    const text = await file.text();
    return JSON.parse(text);
  } catch (e) {
    console.error(`Failed to load ${path}:`, e.message);
    return fallback;
  }
}

export async function saveJson(path, data) {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}
