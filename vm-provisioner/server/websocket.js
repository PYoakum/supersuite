/**
 * WebSocket pub/sub manager with per-VM subscription filtering
 */

/** @type {Set<object>} */
const clients = new Set();

/**
 * Handle a new WebSocket connection
 */
export function handleOpen(ws) {
  const client = { ws, subscribedVmIds: null }; // null = all VMs
  clients.add(client);
  ws._client = client;
}

/**
 * Handle incoming WebSocket message
 */
export function handleMessage(ws, message) {
  const client = ws._client;
  if (!client) return;

  let msg;
  try {
    msg = typeof message === "string" ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message));
  } catch {
    return;
  }

  if (msg.type === "subscribe") {
    if (Array.isArray(msg.vmIds) && msg.vmIds.length > 0) {
      client.subscribedVmIds = new Set(msg.vmIds);
    } else {
      client.subscribedVmIds = null; // subscribe to all
    }
  } else if (msg.type === "unsubscribe") {
    if (Array.isArray(msg.vmIds) && client.subscribedVmIds) {
      for (const id of msg.vmIds) {
        client.subscribedVmIds.delete(id);
      }
      if (client.subscribedVmIds.size === 0) {
        client.subscribedVmIds = null;
      }
    }
  }
}

/**
 * Handle WebSocket close
 */
export function handleClose(ws) {
  const client = ws._client;
  if (client) {
    clients.delete(client);
    ws._client = null;
  }
}

/**
 * Broadcast a message to all connected clients (with filtering)
 */
export function broadcast(message) {
  const json = JSON.stringify(message);

  for (const client of clients) {
    try {
      // For stats messages, filter by subscription
      if (message.type === "stats" && client.subscribedVmIds) {
        const filtered = {};
        for (const [vmId, data] of Object.entries(message.data)) {
          if (client.subscribedVmIds.has(vmId)) {
            filtered[vmId] = data;
          }
        }
        if (Object.keys(filtered).length > 0) {
          client.ws.send(JSON.stringify({ type: "stats", data: filtered }));
        }
      } else if (message.type !== "stats" && client.subscribedVmIds) {
        // For VM events, only send if the VM is in subscription
        const vmId = message.data?.vmId;
        if (!vmId || client.subscribedVmIds.has(vmId)) {
          client.ws.send(json);
        }
      } else {
        client.ws.send(json);
      }
    } catch {}
  }
}

export function clientCount() {
  return clients.size;
}
