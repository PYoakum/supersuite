/**
 * Project CRUD - JSON file storage for project state
 */

import { readdir, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

let projectsDir = "data/projects";

export function configure(config) {
  projectsDir = config.storage?.projects_dir || "data/projects";
}

export async function init() {
  await mkdir(projectsDir, { recursive: true });
}

function defaultProject(name) {
  return {
    id: crypto.randomUUID(),
    name: name || "Untitled Project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      format: "mp4",
    },
    timeline: {
      tracks: [
        {
          id: "track-1",
          type: "video",
          label: "Video 1",
          items: [],
        },
      ],
    },
  };
}

export async function createProject(name) {
  const project = defaultProject(name);
  const filePath = join(projectsDir, `${project.id}.json`);
  await Bun.write(filePath, JSON.stringify(project, null, 2));
  return project;
}

export async function listProjects() {
  const entries = await readdir(projectsDir);
  const projects = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const data = await Bun.file(join(projectsDir, entry)).json();
      projects.push({
        id: data.id,
        name: data.name,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch { /* skip corrupt files */ }
  }

  projects.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return projects;
}

export async function getProject(id) {
  const filePath = join(projectsDir, `${id}.json`);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return file.json();
}

export async function updateProject(id, data) {
  const filePath = join(projectsDir, `${id}.json`);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const existing = await file.json();
  const updated = {
    ...existing,
    ...data,
    id, // preserve id
    updatedAt: new Date().toISOString(),
  };
  await Bun.write(filePath, JSON.stringify(updated, null, 2));
  return updated;
}

export async function deleteProject(id) {
  const filePath = join(projectsDir, `${id}.json`);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return false;
  await unlink(filePath);
  return true;
}
