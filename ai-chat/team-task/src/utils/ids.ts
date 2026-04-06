let seq = 0;

export function generateTaskId(): string {
  const ts = Date.now();
  const s = seq++;
  const r = Math.random().toString(36).slice(2, 6);
  return `task_${ts}_${s}_${r}`;
}
