export function createSocket({ onMessage, onStatus }) {
  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  const MAX_DELAY = 15000;

  function getUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    onStatus("connecting");
    ws = new WebSocket(getUrl());

    ws.addEventListener("open", () => {
      reconnectDelay = 1000;
      onStatus("connected");
    });

    ws.addEventListener("message", (evt) => {
      try {
        const envelope = JSON.parse(evt.data);
        onMessage(envelope);
      } catch { /* ignore malformed */ }
    });

    ws.addEventListener("close", () => {
      onStatus("disconnected");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      onStatus("error");
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    onStatus("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
      connect();
    }, reconnectDelay);
  }

  function send(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  }

  connect();

  return { send, disconnect, reconnect: connect };
}
