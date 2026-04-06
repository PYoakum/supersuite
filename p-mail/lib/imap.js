import { ImapFlow } from "imapflow";

export function createImapClient(config) {
  let client = null;
  let connected = false;

  function buildClient() {
    const c = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      logger: false,
    });

    c.on("close", () => {
      connected = false;
      console.log("IMAP connection closed, will reconnect on next operation");
    });

    c.on("error", (err) => {
      connected = false;
      console.error("IMAP error:", err.message);
    });

    return c;
  }

  async function ensureConnected() {
    if (connected && client) return;
    if (client) {
      try { client.close(); } catch {}
    }
    client = buildClient();
    await client.connect();
    connected = true;
  }

  async function withLock(folder, fn) {
    await ensureConnected();
    const lock = await client.getMailboxLock(folder);
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  }

  return {
    async connect() {
      await ensureConnected();
      console.log("IMAP connected to", config.host);
    },

    async listFolders() {
      await ensureConnected();
      const tree = await client.listTree();
      return flattenTree(tree);
    },

    async folderStatus(folder) {
      await ensureConnected();
      return await client.status(folder, { messages: true, unseen: true });
    },

    async listMessages(folder, page = 1, pageSize = 50) {
      return await withLock(folder, async (c) => {
        const status = c.mailbox;
        const total = status.exists;
        if (total === 0) return { messages: [], total, page, pages: 0 };

        const pages = Math.ceil(total / pageSize);
        const end = total - (page - 1) * pageSize;
        const start = Math.max(1, end - pageSize + 1);

        if (end < 1) return { messages: [], total, page, pages };

        const range = `${start}:${end}`;
        const messages = [];

        for await (const msg of c.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
          uid: true,
        })) {
          messages.push({
            uid: msg.uid,
            seq: msg.seq,
            flags: [...(msg.flags || [])],
            envelope: msg.envelope,
            hasAttachments: hasAttachmentParts(msg.bodyStructure),
          });
        }

        // Newest first
        messages.sort((a, b) => b.seq - a.seq);

        return { messages, total, page, pages };
      });
    },

    async getMessage(folder, uid, external = false) {
      return await withLock(folder, async (c) => {
        const msg = await c.fetchOne(String(uid), {
          source: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          uid: true,
        }, { uid: true });

        if (!msg) return null;

        return {
          uid: msg.uid,
          flags: [...(msg.flags || [])],
          envelope: msg.envelope,
          source: msg.source,
          bodyStructure: msg.bodyStructure,
          external,
        };
      });
    },

    async getAttachment(folder, uid, partId) {
      return await withLock(folder, async (c) => {
        const { content, meta } = await c.download(String(uid), partId, { uid: true });
        const chunks = [];
        for await (const chunk of content) {
          chunks.push(chunk);
        }
        return { data: Buffer.concat(chunks), meta };
      });
    },

    async moveMessages(folder, uids, destination) {
      return await withLock(folder, async (c) => {
        await c.messageMove(uids.join(","), destination, { uid: true });
      });
    },

    async deleteMessages(folder, uids) {
      return await withLock(folder, async (c) => {
        await c.messageDelete(uids.join(","), { uid: true });
      });
    },

    async setFlags(folder, uids, flags, action = "add") {
      return await withLock(folder, async (c) => {
        if (action === "add") {
          await c.messageFlagsAdd(uids.join(","), flags, { uid: true });
        } else if (action === "remove") {
          await c.messageFlagsRemove(uids.join(","), flags, { uid: true });
        } else {
          await c.messageFlagsSet(uids.join(","), flags, { uid: true });
        }
      });
    },

    async appendMessage(folder, raw, flags = []) {
      await ensureConnected();
      return await client.append(folder, raw, flags);
    },

    async search(folder, query) {
      return await withLock(folder, async (c) => {
        const uids = await c.search(
          { or: [{ subject: query }, { from: query }, { to: query }, { body: query }] },
          { uid: true }
        );
        if (!uids.length) return [];

        const messages = [];
        for await (const msg of c.fetch(uids.join(","), {
          envelope: true,
          flags: true,
          bodyStructure: true,
          uid: true,
        }, { uid: true })) {
          messages.push({
            uid: msg.uid,
            seq: msg.seq,
            flags: [...(msg.flags || [])],
            envelope: msg.envelope,
            hasAttachments: hasAttachmentParts(msg.bodyStructure),
          });
        }

        messages.sort((a, b) => b.seq - a.seq);
        return messages;
      });
    },

    async saveDraft(raw) {
      await ensureConnected();
      // Try common draft folder names
      const folders = await client.listTree();
      const draftFolder = findSpecialFolder(folders, "\\Drafts") || "Drafts";
      return await client.append(draftFolder, raw, ["\\Draft", "\\Seen"]);
    },

    async getDraftFolder() {
      await ensureConnected();
      const folders = await client.listTree();
      return findSpecialFolder(folders, "\\Drafts") || "Drafts";
    },

    async getSentFolder() {
      await ensureConnected();
      const folders = await client.listTree();
      return findSpecialFolder(folders, "\\Sent") || "Sent";
    },

    async getTrashFolder() {
      await ensureConnected();
      const folders = await client.listTree();
      return findSpecialFolder(folders, "\\Trash") || "Trash";
    },
  };
}

function flattenTree(tree, result = []) {
  if (tree.folders) {
    for (const folder of tree.folders) {
      result.push({
        name: folder.name,
        path: folder.path,
        specialUse: folder.specialUse || null,
        delimiter: folder.delimiter,
      });
      if (folder.folders?.length) {
        flattenTree(folder, result);
      }
    }
  }
  return result;
}

function findSpecialFolder(tree, flag) {
  if (tree.folders) {
    for (const f of tree.folders) {
      if (f.specialUse === flag) return f.path;
      const sub = findSpecialFolder(f, flag);
      if (sub) return sub;
    }
  }
  return null;
}

function hasAttachmentParts(structure) {
  if (!structure) return false;
  if (structure.disposition === "attachment") return true;
  if (structure.childNodes) {
    return structure.childNodes.some(hasAttachmentParts);
  }
  return false;
}
