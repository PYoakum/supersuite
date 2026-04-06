#!/usr/bin/env bun
/**
 * VM Provisioner - entry point
 */

import { parseArgs } from "./lib/utils.js";
import { DEFAULTS } from "./lib/constants.js";
import { recoverVms } from "./persistence/recovery.js";
import { startServer } from "./server/index.js";
import { startStatsLoop } from "./stats/index.js";
import { initNetwork, shutdownNetwork } from "./networking/index.js";

const args = parseArgs(process.argv.slice(2));
const port = parseInt(args.port) || DEFAULTS.PORT;
const imagesDir = args.images || DEFAULTS.IMAGES_DIR;
const noNetwork = !!args["no-network"];

console.log("VM Provisioner starting...");
console.log(`  Port: ${port}`);
console.log(`  Images dir: ${imagesDir}`);

// Initialize networking (before recovery so recovered VMs can get TAPs)
if (!noNetwork) {
  await initNetwork({
    bridgeName: args["bridge-name"],
    subnet: args.subnet,
  });
} else {
  console.log("  Networking: disabled (--no-network)");
}

// Recover persistent VMs
await recoverVms();

// Start server
await startServer({ port, imagesDir });

// Start stats broadcast loop
startStatsLoop();

// Graceful shutdown
function onShutdown() {
  console.log("\nShutting down...");
  shutdownNetwork().finally(() => process.exit(0));
}

process.on("SIGINT", onShutdown);
process.on("SIGTERM", onShutdown);
