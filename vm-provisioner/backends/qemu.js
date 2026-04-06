/**
 * QEMU backend - spawned process with QMP socket for control/stats
 */

import { exec, spawn, sleep } from "../lib/utils.js";
import { SOCKET_PATHS } from "../lib/constants.js";
import { connect } from "node:net";
import { lookupVmIp } from "../networking/index.js";

function qmpSocket(vm) {
  return SOCKET_PATHS.qemu(vm.id);
}

export async function create(vm) {
  // Validate the image exists
  const file = Bun.file(vm.imagePath);
  if (!(await file.exists())) {
    return { success: false, error: `Image not found: ${vm.imagePath}` };
  }
  return { success: true, data: { socketPath: qmpSocket(vm) } };
}

export async function start(vm) {
  const sock = qmpSocket(vm);
  const netArgs = [];
  if (vm.config?.tapDevice) {
    // TAP networking via bridge
    netArgs.push(
      "-netdev", `tap,id=net0,ifname=${vm.config.tapDevice},script=no,downscript=no`,
      "-device", `virtio-net-pci,netdev=net0,mac=${vm.config.guestMac || "52:54:00:00:00:01"}`,
    );
    vm._tapDevice = vm.config.tapDevice;
    vm._mac = vm.config.guestMac;
  } else {
    // Fallback: user-mode networking
    netArgs.push("-net", "nic,model=virtio", "-net", "user");
  }

  const args = [
    "-m", `${vm.memMb || 256}`,
    "-smp", `${vm.vcpus || 1}`,
    "-drive", `file=${vm.imagePath},format=qcow2,if=virtio`,
    "-qmp", `unix:${sock},server,nowait`,
    "-nographic",
    ...netArgs,
    ...(vm.config?.extraArgs || []),
  ];

  const proc = spawn("qemu-system-x86_64", args);
  vm._proc = proc;
  vm._pid = proc.pid;
  vm._socketPath = sock;

  // Wait briefly for QMP socket to become available
  await sleep(1000);

  return { success: true, data: { pid: proc.pid, socketPath: sock } };
}

export async function stop(vm) {
  try {
    const result = await qmpCommand(vm, { execute: "system_powerdown" });
    if (!result.success) {
      // Fallback: force quit
      await qmpCommand(vm, { execute: "quit" });
    }
    // Wait for process to exit
    if (vm._proc) {
      await Promise.race([vm._proc.exited, sleep(10000)]);
    }
    return { success: true };
  } catch (e) {
    // Try killing the process directly
    if (vm._pid) {
      try { process.kill(vm._pid, "SIGTERM"); } catch {}
    }
    return { success: true };
  }
}

export async function destroy(vm) {
  await stop(vm);
  // Clean up socket
  const sock = qmpSocket(vm);
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(sock);
  } catch {}
  vm._proc = null;
  vm._pid = null;
  return { success: true };
}

export async function getStats(vm) {
  try {
    let networkRxBytes = 0;
    let networkTxBytes = 0;
    let ip = "";

    if (vm._tapDevice) {
      // TAP mode: read sysfs stats (same as Firecracker)
      try {
        const rxFile = Bun.file(`/sys/class/net/${vm._tapDevice}/statistics/rx_bytes`);
        const txFile = Bun.file(`/sys/class/net/${vm._tapDevice}/statistics/tx_bytes`);
        if (await rxFile.exists()) networkRxBytes = parseInt(await rxFile.text(), 10) || 0;
        if (await txFile.exists()) networkTxBytes = parseInt(await txFile.text(), 10) || 0;
      } catch {}

      // IP: try DHCP lease first, then ARP fallback
      try {
        ip = await lookupVmIp(vm) || "";
      } catch {}
      if (!ip) {
        try {
          const arpFile = Bun.file("/proc/net/arp");
          if (await arpFile.exists()) {
            const arp = await arpFile.text();
            for (const line of arp.split("\n")) {
              if (line.includes(vm._tapDevice)) {
                const parts = line.trim().split(/\s+/);
                if (parts[0]) { ip = parts[0]; break; }
              }
            }
          }
        } catch {}
      }
    } else {
      // User-mode fallback: QMP query
      const netResult = await qmpCommand(vm, { execute: "query-network" });
      if (netResult.success && netResult.data?.return) {
        for (const iface of netResult.data.return) {
          networkRxBytes += iface["rx-bytes"] || 0;
          networkTxBytes += iface["tx-bytes"] || 0;
        }
      }
    }

    return {
      success: true,
      data: { networkRxBytes, networkTxBytes, ip: ip || vm._ip || "" },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function isRunning(vm) {
  const sock = qmpSocket(vm);
  try {
    const result = await qmpCommand(
      { ...vm, _socketPath: sock },
      { execute: "query-status" },
    );
    return result.success && result.data?.return?.status === "running";
  } catch {
    // Fallback: check if PID is alive
    if (vm._pid) {
      try {
        process.kill(vm._pid, 0);
        return true;
      } catch {}
    }
    return false;
  }
}

/**
 * Send a QMP command via the unix socket
 */
async function qmpCommand(vm, command) {
  const sock = vm._socketPath || qmpSocket(vm);
  const file = Bun.file(sock);
  if (!(await file.exists())) {
    return { success: false, error: "QMP socket not found" };
  }
  return new Promise((resolve) => {
    const client = connect(sock, () => {
      let buf = "";
      client.on("data", (data) => {
        buf += data.toString();
        // QMP sends greeting first, then we negotiate, then get response
        if (buf.includes('"QMP"')) {
          // Send capabilities negotiation
          client.write(JSON.stringify({ execute: "qmp_capabilities" }) + "\n");
        } else if (buf.includes('"return"') && buf.includes("qmp_capabilities") === false) {
          // Parse the last complete JSON response
          const lines = buf.split("\n").filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(lines[i]);
              if ("return" in parsed || "error" in parsed) {
                client.end();
                resolve({ success: !parsed.error, data: parsed });
                return;
              }
            } catch {}
          }
        } else if (buf.split("\n").filter(Boolean).length >= 2) {
          // After capabilities ack, send actual command
          const lines = buf.split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1];
          try {
            const parsed = JSON.parse(lastLine);
            if ("return" in parsed && Object.keys(parsed.return || {}).length === 0) {
              // This is the capabilities ack
              client.write(JSON.stringify(command) + "\n");
            }
          } catch {}
        }
      });
    });

    client.on("error", () => {
      resolve({ success: false, error: "QMP connection failed" });
    });

    setTimeout(() => {
      client.end();
      resolve({ success: false, error: "QMP timeout" });
    }, 5000);
  });
}
