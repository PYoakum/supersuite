import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { parse } from "smol-toml";
import { configure as configureUploads, init as initUploads } from "./lib/uploads.js";
import { configure as configureProjects, init as initProjects } from "./lib/projects.js";
import { setFfprobePath } from "./lib/ffprobe.js";
import { setFfmpegPath } from "./lib/ffmpeg.js";
import { createServer } from "./server/index.js";

const raw = await readFile("config.toml", "utf-8");
const config = parse(raw);

// Defaults
config.server ??= {};
config.server.port ??= 3000;
config.server.host ??= "0.0.0.0";
config.storage ??= {};
config.storage.uploads_dir ??= "data/uploads";
config.storage.output_dir ??= "data/output";
config.storage.projects_dir ??= "data/projects";
config.storage.thumbnails_dir ??= "data/thumbnails";
config.storage.max_upload_mb ??= 500;
config.ffmpeg ??= {};
config.ffmpeg.ffmpeg_path ??= "";
config.ffmpeg.ffprobe_path ??= "";

// Init directories
await mkdir(config.storage.uploads_dir, { recursive: true });
await mkdir(config.storage.output_dir, { recursive: true });
await mkdir(config.storage.projects_dir, { recursive: true });
await mkdir(config.storage.thumbnails_dir, { recursive: true });

// Configure libs
configureUploads(config);
configureProjects(config);
setFfprobePath(config.ffmpeg.ffprobe_path);
setFfmpegPath(config.ffmpeg.ffmpeg_path);

// Init (scan existing files)
await initUploads();
await initProjects();

const server = createServer(config);
console.log(`Vidiyo running at http://${server.hostname}:${server.port}`);
