let counter = 0;

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  counter = (counter + 1) % 0xffff;
  const seq = counter.toString(36).padStart(3, "0");
  return `msg_${ts}_${seq}_${rand}`;
}
