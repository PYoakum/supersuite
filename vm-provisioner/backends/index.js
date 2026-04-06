/**
 * Backend registry - name -> module map
 */

import { BACKENDS } from "../lib/constants.js";
import * as firecracker from "./firecracker.js";
import * as qemu from "./qemu.js";
import * as dockerCompose from "./docker-compose.js";

const registry = {
  [BACKENDS.FIRECRACKER]: firecracker,
  [BACKENDS.QEMU]: qemu,
  [BACKENDS.DOCKER_COMPOSE]: dockerCompose,
};

export function getBackend(name) {
  const backend = registry[name];
  if (!backend) {
    throw new Error(`Unknown backend: ${name}. Valid: ${Object.keys(registry).join(", ")}`);
  }
  return backend;
}

export function listBackends() {
  return Object.keys(registry);
}
