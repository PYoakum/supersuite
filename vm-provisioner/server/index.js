/**
 * Bun.serve() with WebSocket upgrade and route dispatch
 */

import { corsHeaders, handleOptions, jsonResponse, errorResponse } from "./middleware.js";
import { handleOpen, handleMessage, handleClose } from "./websocket.js";
import { handleDashboard } from "./routes/static.js";
import { handleListVms, handleGetVm, handleCreateVm, handleStartVm, handleStopVm, handleDestroyVm } from "./routes/vms.js";
import { handleListImages, setImagesDir } from "./routes/images.js";
import { handleBrowse } from "./routes/browse.js";
import { handleAllStats, handleVmStats } from "./routes/stats.js";
import {
  handleListGroups, handleCreateGroup, handleUpdateGroup, handleDeleteGroup,
  handleAddVmsToGroup, handleRemoveVmsFromGroup,
  handleBulkStart, handleBulkStop, handleBulkDestroy, handleBulkCreate,
} from "./routes/groups.js";
import { handleListTags, handleSetVmTags } from "./routes/tags.js";
import { loadGroups } from "../persistence/groups.js";

/**
 * Start the HTTP + WebSocket server
 */
export async function startServer({ port = 3000, imagesDir = "./images" } = {}) {
  setImagesDir(imagesDir);
  await loadGroups();

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // CORS preflight
      if (method === "OPTIONS") return handleOptions();

      // WebSocket upgrade
      if (path === "/ws") {
        const upgraded = server.upgrade(req);
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return;
      }

      try {
        // Dashboard
        if (path === "/" && method === "GET") {
          return handleDashboard();
        }

        // VM routes
        if (path === "/api/vms" && method === "GET") return await handleListVms();
        if (path === "/api/vms" && method === "POST") return await handleCreateVm(req);

        // VM :id routes
        const vmMatch = path.match(/^\/api\/vms\/([^/]+)$/);
        if (vmMatch) {
          const id = vmMatch[1];
          if (method === "GET") return await handleGetVm(id);
          if (method === "DELETE") return await handleDestroyVm(id);
        }

        const vmStartMatch = path.match(/^\/api\/vms\/([^/]+)\/start$/);
        if (vmStartMatch && method === "POST") return await handleStartVm(vmStartMatch[1]);

        const vmStopMatch = path.match(/^\/api\/vms\/([^/]+)\/stop$/);
        if (vmStopMatch && method === "POST") return await handleStopVm(vmStopMatch[1]);

        // Group routes
        if (path === "/api/groups" && method === "GET") return await handleListGroups();
        if (path === "/api/groups" && method === "POST") return await handleCreateGroup(req);

        const groupMatch = path.match(/^\/api\/groups\/([^/]+)$/);
        if (groupMatch) {
          const gid = groupMatch[1];
          if (method === "PUT") return await handleUpdateGroup(gid, req);
          if (method === "DELETE") return await handleDeleteGroup(gid);
        }

        const groupVmsMatch = path.match(/^\/api\/groups\/([^/]+)\/vms$/);
        if (groupVmsMatch) {
          const gid = groupVmsMatch[1];
          if (method === "POST") return await handleAddVmsToGroup(gid, req);
          if (method === "DELETE") return await handleRemoveVmsFromGroup(gid, req);
        }

        const groupStartMatch = path.match(/^\/api\/groups\/([^/]+)\/start$/);
        if (groupStartMatch && method === "POST") return await handleBulkStart(groupStartMatch[1]);

        const groupStopMatch = path.match(/^\/api\/groups\/([^/]+)\/stop$/);
        if (groupStopMatch && method === "POST") return await handleBulkStop(groupStopMatch[1]);

        const groupDestroyMatch = path.match(/^\/api\/groups\/([^/]+)\/destroy$/);
        if (groupDestroyMatch && method === "POST") return await handleBulkDestroy(groupDestroyMatch[1]);

        const groupCreateMatch = path.match(/^\/api\/groups\/([^/]+)\/create$/);
        if (groupCreateMatch && method === "POST") return await handleBulkCreate(groupCreateMatch[1], req);

        // Tag routes
        if (path === "/api/tags" && method === "GET") return await handleListTags();

        const vmTagsMatch = path.match(/^\/api\/vms\/([^/]+)\/tags$/);
        if (vmTagsMatch && method === "PUT") return await handleSetVmTags(vmTagsMatch[1], req);

        // Image routes
        if (path === "/api/images" && method === "GET") return await handleListImages(url);

        // File browser
        if (path === "/api/browse" && method === "GET") return await handleBrowse(url);

        // Stats routes
        if (path === "/api/stats" && method === "GET") return await handleAllStats();

        const statsMatch = path.match(/^\/api\/stats\/([^/]+)$/);
        if (statsMatch && method === "GET") return await handleVmStats(statsMatch[1]);

        return jsonResponse({ success: false, error: "Not found" }, 404);
      } catch (e) {
        return errorResponse(e);
      }
    },

    websocket: {
      open(ws) { handleOpen(ws); },
      message(ws, message) { handleMessage(ws, message); },
      close(ws) { handleClose(ws); },
    },
  });

  console.log(`VM Provisioner running at http://localhost:${server.port}`);
  return server;
}
