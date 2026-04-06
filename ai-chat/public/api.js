const BASE = "";

export async function fetchMessages({ limit = 100, before, after, order } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (before) params.set("before", before);
  if (after) params.set("after", after);
  if (order) params.set("order", order);

  const res = await fetch(`${BASE}/api/messages?${params}`);
  const data = await res.json();
  return data.ok ? data.messages : [];
}

export async function postMessage(payload) {
  const res = await fetch(`${BASE}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function searchMessages({ q, senderId, senderType, after, before, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (senderId) params.set("senderId", senderId);
  if (senderType) params.set("senderType", senderType);
  if (after) params.set("after", after);
  if (before) params.set("before", before);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const res = await fetch(`${BASE}/api/search?${params}`);
  const data = await res.json();
  return data.ok ? { results: data.results, total: data.total } : { results: [], total: 0 };
}

export async function fetchAllMessages() {
  const all = [];
  let before = undefined;
  while (true) {
    const params = new URLSearchParams({ limit: "500", order: "asc" });
    if (before) params.set("before", before);
    const res = await fetch(`${BASE}/api/messages?${params}`);
    const data = await res.json();
    const msgs = data.ok ? data.messages : [];
    if (msgs.length === 0) break;
    all.push(...msgs);
    if (msgs.length < 500) break;
    before = msgs[0].id;
  }
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return all;
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/api/stats`);
  return res.json();
}
