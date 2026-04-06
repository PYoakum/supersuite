/**
 * Firecracker backend - API socket, Bun.spawn, tap device stats
 */

import { spawn, sleep } from "../lib/utils.js";
import { SOCKET_PATHS } from "../lib/constants.js";
import { readdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { lookupVmIp } from "../networking/index.js";

function apiSocket(vm) {
  return SOCKET_PATHS.firecracker(vm.id);
}

export async function create(vm) {
  const file = Bun.file(vm.imagePath);
  if (!(await file.exists())) {
    return { success: false, error: `Image not found: ${vm.imagePath}` };
  }
  return { success: true, data: { socketPath: apiSocket(vm) } };
}

export async function start(vm) {
  const sock = apiSocket(vm);

  // Clean up stale socket
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(sock);
  } catch {}

  const proc = spawn("firecracker", ["--api-sock", sock]);
  vm._proc = proc;
  vm._pid = proc.pid;
  vm._socketPath = sock;

  // Wait for socket to be ready
  await sleep(500);

  // Configure the VM via API
  let kernelPath = vm.config?.kernelPath;
  const rootfsPath = vm.config?.rootfsPath || vm.imagePath;

  // Auto-detect kernel: look for a *vmlinux file in the same directory as the rootfs
  if (!kernelPath) {
    kernelPath = await findKernel(rootfsPath);
  }
  if (!kernelPath) {
    return { success: false, error: "No kernel found. Set config.kernelPath or place a *vmlinux file next to the rootfs." };
  }

  // Set machine config
  await fcPut(sock, "/machine-config", {
    vcpu_count: vm.vcpus || 1,
    mem_size_mib: vm.memMb || 256,
  });

  // Set boot source
  await fcPut(sock, "/boot-source", {
    kernel_image_path: kernelPath,
    boot_args: vm.config?.bootArgs || "console=ttyS0 reboot=k panic=1 pci=off",
  });

  // Set root drive
  await fcPut(sock, "/drives/rootfs", {
    drive_id: "rootfs",
    path_on_host: rootfsPath,
    is_root_device: true,
    is_read_only: false,
  });

  // Set network interface if configured
  if (vm.config?.tapDevice) {
    await fcPut(sock, "/network-interfaces/eth0", {
      iface_id: "eth0",
      guest_mac: vm.config.guestMac || "AA:FC:00:00:00:01",
      host_dev_name: vm.config.tapDevice,
    });
    vm._tapDevice = vm.config.tapDevice;
  }

  // Start the instance
  const startResult = await fcPut(sock, "/actions", {
    action_type: "InstanceStart",
  });

  if (!startResult.success) {
    return { success: false, error: startResult.error || "Failed to start instance" };
  }

  return { success: true, data: { pid: proc.pid, socketPath: sock } };
}

export async function stop(vm) {
  const sock = vm._socketPath || apiSocket(vm);

  // Send InstanceHalt via API
  await fcPut(sock, "/actions", { action_type: "SendCtrlAltDel" });

  // Wait for graceful shutdown
  if (vm._proc) {
    const exited = await Promise.race([vm._proc.exited, sleep(10000)]);
    if (exited === undefined) {
      // Force kill
      try { process.kill(vm._pid, "SIGKILL"); } catch {}
    }
  }

  return { success: true };
}

export async function destroy(vm) {
  // Kill process
  if (vm._pid) {
    try { process.kill(vm._pid, "SIGKILL"); } catch {}
  }
  if (vm._proc) {
    await Promise.race([vm._proc.exited, sleep(3000)]);
  }

  // Clean up socket
  const sock = apiSocket(vm);
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(sock);
  } catch {}

  vm._proc = null;
  vm._pid = null;
  return { success: true };
}

export async function getStats(vm) {
  let networkRxBytes = 0;
  let networkTxBytes = 0;
  let ip = "";

  // Read tap device stats from /sys/class/net/
  if (vm._tapDevice) {
    try {
      const rxFile = Bun.file(`/sys/class/net/${vm._tapDevice}/statistics/rx_bytes`);
      const txFile = Bun.file(`/sys/class/net/${vm._tapDevice}/statistics/tx_bytes`);
      if (await rxFile.exists()) {
        networkRxBytes = parseInt(await rxFile.text(), 10) || 0;
      }
      if (await txFile.exists()) {
        networkTxBytes = parseInt(await txFile.text(), 10) || 0;
      }
    } catch {}

    // Try DHCP lease lookup first (most reliable)
    try {
      ip = await lookupVmIp(vm) || "";
    } catch {}

    // ARP table fallback
    if (!ip) {
      try {
        const arpFile = Bun.file("/proc/net/arp");
        if (await arpFile.exists()) {
          const arp = await arpFile.text();
          for (const line of arp.split("\n")) {
            if (line.includes(vm._tapDevice)) {
              const parts = line.trim().split(/\s+/);
              if (parts[0]) {
                ip = parts[0];
                break;
              }
            }
          }
        }
      } catch {}
    }
  }

  return {
    success: true,
    data: { networkRxBytes, networkTxBytes, ip: ip || vm._ip || "" },
  };
}

export async function isRunning(vm) {
  if (vm._pid) {
    try {
      process.kill(vm._pid, 0);
      return true;
    } catch {}
  }

  // Try the API socket
  const sock = vm._socketPath || apiSocket(vm);
  try {
    const resp = await fcGet(sock, "/");
    return resp.success;
  } catch {}

  return false;
}

/**
 * Auto-detect a kernel (vmlinux) file in the same directory as the rootfs.
 * Tries: exact prefix match first (e.g. test-vm-rootfs.ext4 -> test-vm-vmlinux),
 * then falls back to any *vmlinux file in the directory.
 */
async function findKernel(rootfsPath) {
  const dir = dirname(rootfsPath);
  const rootfsName = basename(rootfsPath);

  // Derive expected kernel name: replace rootfs filename pattern with vmlinux
  // e.g. "test-vm-rootfs.ext4" -> "test-vm-vmlinux", "my-rootfs.ext4" -> "my-vmlinux"
  const prefix = rootfsName.replace(/-?rootfs.*$/, "").replace(/\.$/, "");

  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  const vmlinuxFiles = entries.filter((f) => f.endsWith("vmlinux"));

  // Try prefix match first
  if (prefix) {
    const prefixMatch = vmlinuxFiles.find((f) => f.startsWith(prefix));
    if (prefixMatch) return join(dir, prefixMatch);
  }

  // Fall back to any vmlinux in the directory
  if (vmlinuxFiles.length > 0) return join(dir, vmlinuxFiles[0]);

  return null;
}

/**
 * HTTP PUT to Firecracker API socket
 */
async function fcPut(socketPath, path, body) {
  try {
    const resp = await fetch(`http://localhost${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      unix: socketPath,
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { success: false, error: text };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * HTTP GET from Firecracker API socket
 */
async function fcGet(socketPath, path) {
  try {
    const resp = await fetch(`http://localhost${path}`, {
      unix: socketPath,
    });
    const data = await resp.json();
    return { success: resp.ok, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
