/**
 * Docker Compose backend - uses docker compose CLI
 */

import { exec } from "../lib/utils.js";

function projectName(vm) {
  return `vmp-${vm.id}`;
}

export async function create(vm) {
  // For docker-compose, create is a no-op - the compose file already exists
  return { success: true, data: { projectName: projectName(vm) } };
}

export async function start(vm) {
  const project = projectName(vm);
  const result = await exec("docker", [
    "compose",
    "-f", vm.imagePath,
    "-p", project,
    "up", "-d",
  ]);
  if (result.code !== 0) {
    return { success: false, error: result.stderr || "Failed to start compose project" };
  }
  return { success: true, data: { projectName: project } };
}

export async function stop(vm) {
  const project = projectName(vm);
  const result = await exec("docker", [
    "compose",
    "-f", vm.imagePath,
    "-p", project,
    "down",
  ]);
  if (result.code !== 0) {
    return { success: false, error: result.stderr || "Failed to stop compose project" };
  }
  return { success: true };
}

export async function destroy(vm) {
  const project = projectName(vm);
  const result = await exec("docker", [
    "compose",
    "-f", vm.imagePath,
    "-p", project,
    "down", "-v", "--remove-orphans",
  ]);
  if (result.code !== 0) {
    return { success: false, error: result.stderr || "Failed to destroy compose project" };
  }
  return { success: true };
}

export async function getStats(vm) {
  const project = projectName(vm);

  // Get container IDs for this project
  const ps = await exec("docker", [
    "compose",
    "-f", vm.imagePath,
    "-p", project,
    "ps", "-q",
  ]);
  if (ps.code !== 0 || !ps.stdout) {
    return { success: false, error: "No containers running" };
  }

  const containerIds = ps.stdout.split("\n").filter(Boolean);
  let totalRx = 0;
  let totalTx = 0;
  let ip = "";

  for (const cid of containerIds) {
    // Get network stats
    const stats = await exec("docker", [
      "stats", "--no-stream", "--format",
      "{{.NetIO}}", cid,
    ]);
    if (stats.code === 0 && stats.stdout) {
      const match = stats.stdout.match(/([\d.]+)([kKmMgG]?[bB]?)\s*\/\s*([\d.]+)([kKmMgG]?[bB]?)/);
      if (match) {
        totalRx += parseSize(match[1], match[2]);
        totalTx += parseSize(match[3], match[4]);
      }
    }

    // Get IP from first container
    if (!ip) {
      const inspect = await exec("docker", [
        "inspect", "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", cid,
      ]);
      if (inspect.code === 0 && inspect.stdout) {
        ip = inspect.stdout;
      }
    }
  }

  return {
    success: true,
    data: { networkRxBytes: totalRx, networkTxBytes: totalTx, ip },
  };
}

export async function isRunning(vm) {
  const project = projectName(vm);
  const result = await exec("docker", [
    "compose",
    "-f", vm.imagePath,
    "-p", project,
    "ps", "-q", "--status", "running",
  ]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

function parseSize(num, unit) {
  const n = parseFloat(num);
  const u = (unit || "").toLowerCase();
  if (u.startsWith("g")) return n * 1024 * 1024 * 1024;
  if (u.startsWith("m")) return n * 1024 * 1024;
  if (u.startsWith("k")) return n * 1024;
  return n;
}
