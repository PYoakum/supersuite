let prefix = "[chat-agent]";

export function setPrefix(agentId: string) {
  prefix = `[chat-agent:${agentId}]`;
}

export const log = {
  info: (...args: unknown[]) => console.log(prefix, ...args),
  warn: (...args: unknown[]) => console.warn(prefix, "WARN", ...args),
  error: (...args: unknown[]) => console.error(prefix, "ERROR", ...args),
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) console.log(prefix, "DEBUG", ...args);
  },
};
