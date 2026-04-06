const WS = {
  socket: null,
  listeners: {},
  reconnectDelay: 1000,
  maxDelay: 15000,
  intentionalClose: false,

  connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${proto}//${location.host}/ws`);
    this.intentionalClose = false;

    this.socket.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.emit(msg.type, msg.payload);
      } catch {}
    };

    this.socket.onclose = () => {
      this.emit("connection:status", { status: "disconnected" });
      if (!this.intentionalClose) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxDelay);
      }
    };
  },

  send(type, payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
    }
  },

  on(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  },

  emit(type, payload) {
    (this.listeners[type] || []).forEach((fn) => fn(payload));
  },

  disconnect() {
    this.intentionalClose = true;
    if (this.socket) this.socket.close();
  },
};
