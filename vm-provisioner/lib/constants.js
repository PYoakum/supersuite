/**
 * Constants and defaults for vm-provisioner
 */

export const BACKENDS = {
  FIRECRACKER: "firecracker",
  QEMU: "qemu",
  DOCKER_COMPOSE: "docker-compose",
};

export const STATUS = {
  CREATED: "created",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  ERROR: "error",
};

export const DEFAULTS = {
  PORT: 3000,
  IMAGES_DIR: "./images",
  STATE_FILE: ".vm-state.json",
  STATS_INTERVAL_MS: 3000,
  VCPUS: 1,
  MEM_MB: 256,
  BRIDGE_NAME: "vmp-br0",
  SUBNET: "172.20.0.0/24",
  BRIDGE_IP: "172.20.0.1",
  DHCP_RANGE_START: "172.20.0.2",
  DHCP_RANGE_END: "172.20.0.254",
  NETWORK_CONFIG_PATH: "/tmp/vmp-network.json",
  DEFAULT_TAP_COUNT: 8,
  GROUPS_FILE: ".vm-groups.json",
};

export const IMAGE_EXTENSIONS = {
  [BACKENDS.FIRECRACKER]: [".ext4", ".squashfs", ".img"],
  [BACKENDS.QEMU]: [".qcow2", ".img", ".raw", ".iso", ".cdr", ".iso.cdr"],
  [BACKENDS.DOCKER_COMPOSE]: [".yml", ".yaml"],
};

export const SOCKET_PATHS = {
  firecracker: (id) => `/tmp/firecracker-${id}.sock`,
  qemu: (id) => `/tmp/qemu-qmp-${id}.sock`,
};
