import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

let pagesDir;

export function init(dir) {
  pagesDir = dir;
}

export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(slug) {
  if (!slug || slug.includes("..") || slug.includes("/") || slug.includes("\\")) return false;
  if (slug !== slugify(slug)) return false;
  return true;
}

function filePath(slug) {
  return join(pagesDir, `${slug}.md`);
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export async function getPage(slug) {
  try {
    const fp = filePath(slug);
    const content = await readFile(fp, "utf-8");
    const stats = await stat(fp);
    return {
      slug,
      content,
      title: extractTitle(content) || slug,
      modified: stats.mtime,
    };
  } catch {
    return null;
  }
}

export async function savePage(slug, content) {
  await mkdir(pagesDir, { recursive: true });
  await writeFile(filePath(slug), content, "utf-8");
}

export async function listPages() {
  await mkdir(pagesDir, { recursive: true });
  try {
    const files = await readdir(pagesDir);
    const pages = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const slug = file.slice(0, -3);
      const fp = filePath(slug);
      const content = await readFile(fp, "utf-8");
      const stats = await stat(fp);
      pages.push({
        slug,
        title: extractTitle(content) || slug,
        modified: stats.mtime,
      });
    }
    pages.sort((a, b) => a.title.localeCompare(b.title));
    return pages;
  } catch {
    return [];
  }
}

export async function searchPages(query) {
  if (!query || !query.trim()) return [];
  const q = query.toLowerCase();
  const all = await listPages();
  const results = [];

  for (const page of all) {
    const content = await readFile(filePath(page.slug), "utf-8");
    const lower = content.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1 && !page.title.toLowerCase().includes(q)) continue;

    let snippet = "";
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + query.length + 60);
      snippet = (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
    }

    results.push({ ...page, snippet });
  }
  return results;
}

export async function ensureDefaultPage() {
  await mkdir(pagesDir, { recursive: true });
  const home = await getPage("home");
  if (!home) {
    await savePage("home", `# Welcome\n\nWelcome to your wiki! Edit this page to get started.\n`);
  }
}
