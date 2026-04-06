import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { init, ensureDefaultPage } from "./lib/wiki.js";
import { createServer } from "./server/index.js";

const raw = await readFile("config.toml", "utf-8");
const config = parse(raw);

// Defaults
config.server ??= {};
config.server.port ??= 3000;
config.server.host ??= "0.0.0.0";
config.site ??= {};
config.site.name ??= "Wiki";
config.auth ??= {};
config.auth.edit_password ??= "";
config.auth.salt ??= "default-salt";
config.auth.cookie_name ??= "wiki_session";
config.auth.max_age ??= 604800;
config.wiki ??= {};
config.wiki.pages_dir ??= "pages";

init(config.wiki.pages_dir);
await ensureDefaultPage();

const server = createServer(config);
console.log(`Wiki running at http://${server.hostname}:${server.port}`);
