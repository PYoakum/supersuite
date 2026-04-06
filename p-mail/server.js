import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { createImapClient } from "./lib/imap.js";
import { createSmtpTransport } from "./lib/smtp.js";
import { createServer } from "./server/index.js";

const raw = await readFile("config.toml", "utf-8");
const config = parse(raw);

config.server ??= {};
config.server.port ??= 3000;
config.server.host ??= "0.0.0.0";
config.imap ??= {};
config.imap.page_size ??= 50;
config.attachments ??= {};
config.attachments.max_upload_size ??= 26214400;
config.theme ??= {};

const imap = createImapClient(config.imap);
const smtp = createSmtpTransport(config.smtp);

await imap.connect();

const server = createServer(config, imap, smtp);
console.log(`p-mail running at http://${server.hostname}:${server.port}`);
