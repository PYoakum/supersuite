FROM oven/bun:1-alpine AS base
WORKDIR /app

# ── agent-chat ────────────────────────────────────
FROM base AS agent-chat
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY public/ public/
RUN mkdir -p data
EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]

# ── team-task ─────────────────────────────────────
FROM base AS team-task
COPY team-task/package.json ./
RUN bun install
COPY team-task/src/ src/
COPY team-task/public/ public/
RUN mkdir -p data
EXPOSE 3001
CMD ["bun", "run", "src/server.ts"]

# ── team-maker ────────────────────────────────────
FROM base AS team-maker
COPY team-maker/package.json team-maker/bun.lock ./
RUN bun install --frozen-lockfile
COPY team-maker/src/ src/
COPY team-maker/public/ public/
COPY team-maker/agents/ agents/
EXPOSE 3200
CMD ["bun", "run", "src/server.ts"]

# ── chat-agent ────────────────────────────────────
FROM base AS chat-agent
COPY chat-agent/package.json chat-agent/bun.lock ./
RUN bun install --frozen-lockfile
COPY chat-agent/src/ src/
CMD ["bun", "run", "src/index.ts"]
