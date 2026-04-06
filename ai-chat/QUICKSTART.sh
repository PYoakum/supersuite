#!/usr/bin/env bash
set -euo pipefail

# ── Colors & helpers ────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
CYAN='\033[36m'
YELLOW='\033[33m'
RED='\033[31m'
MAGENTA='\033[35m'
RESET='\033[0m'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$ROOT/ai-chat/chat-agent"
AGENT_CONFIGS_DIR="$AGENT_DIR/agents"
AGENT_PID_DIR="/tmp/chat-agent-pids"

# ── Services ───────────────────────────────────────
# name|dir|port|description|start_cmd
SERVICES=(
  "agent-chat|ai-chat|3000|Chat server|bun run start"
  "team-task|ai-chat/team-task|3001|Task management|bun run start"
  "team-maker|ai-chat/team-maker|3200|Plan decomposition|bun run start"
)

clear_screen() { printf '\033[2J\033[H'; }

header() {
  echo -e "${BOLD}${CYAN}"
  echo "  ┌──────────────────────────────────────┐"
  echo "  │        Homelab App Manager            │"
  echo "  └──────────────────────────────────────┘"
  echo -e "${RESET}"
}

separator() { echo -e "${DIM}  ────────────────────────────────────────${RESET}"; }

check_bun() {
  if ! command -v bun &>/dev/null; then
    echo -e "  ${RED}bun not found.${RESET} Install it: https://bun.sh"
    exit 1
  fi
}

# ── Status helpers ─────────────────────────────────
is_installed() {
  local dir="$ROOT/$1"
  [ -d "$dir/node_modules" ]
}

port_pid() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true
}

is_port_running() {
  local port="$1"
  [ -n "$(port_pid "$port")" ]
}

status_label() {
  local dir="$1" port="$2"
  local parts=""
  if is_installed "$dir"; then
    parts="${GREEN}installed${RESET}"
  else
    parts="${DIM}not installed${RESET}"
  fi
  if [ "$port" != "—" ] && is_port_running "$port"; then
    parts="$parts  ${GREEN}● :${port}${RESET}"
  fi
  echo -e "$parts"
}

# ── Service actions ────────────────────────────────
install_service() {
  local dir="$ROOT/$1"
  echo -e "  ${CYAN}Installing deps in ${1}...${RESET}"
  (cd "$dir" && bun install --no-progress 2>&1 | sed 's/^/    /')
  echo -e "  ${GREEN}Done.${RESET}"
}

start_service() {
  local dir="$ROOT/$1" name="$2" port="$3" cmd="$4"
  if [ "$port" != "—" ] && is_port_running "$port"; then
    echo -e "  ${YELLOW}${name} already running on :${port}${RESET}"
    return
  fi
  echo -e "  ${CYAN}Starting ${name}...${RESET}"
  (cd "$dir" && $cmd &) 2>/dev/null
  sleep 1
  if [ "$port" != "—" ] && is_port_running "$port"; then
    echo -e "  ${GREEN}${name} running on :${port}${RESET}"
  else
    echo -e "  ${GREEN}${name} started${RESET}"
  fi
}

stop_service() {
  local name="$1" port="$2"
  if [ "$port" = "—" ]; then
    echo -e "  ${YELLOW}${name} has no port — use stop-agent for chat-agents${RESET}"
    return
  fi
  local pid
  pid=$(port_pid "$port")
  if [ -z "$pid" ]; then
    echo -e "  ${DIM}${name} not running${RESET}"
    return
  fi
  kill "$pid" 2>/dev/null || true
  sleep 0.5
  echo -e "  ${GREEN}Stopped ${name} (pid ${pid})${RESET}"
}

# ── Agent management ───────────────────────────────
ensure_agent_dirs() {
  mkdir -p "$AGENT_CONFIGS_DIR" "$AGENT_PID_DIR"
}

list_agent_configs() {
  ensure_agent_dirs
  local configs=()
  for f in "$AGENT_CONFIGS_DIR"/*.toml "$AGENT_DIR"/agent.toml; do
    [ -f "$f" ] && configs+=("$f")
  done
  echo "${configs[@]}"
}

agent_name_from_config() {
  local file="$1"
  # Extract sender_id from TOML
  grep -m1 'sender_id' "$file" 2>/dev/null | sed 's/.*= *"\(.*\)"/\1/' || basename "$file" .toml
}

agent_pid_file() {
  local name="$1"
  echo "$AGENT_PID_DIR/$name.pid"
}

is_agent_running() {
  local name="$1"
  local pidfile
  pidfile=$(agent_pid_file "$name")
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pidfile"
  fi
  return 1
}

start_agent() {
  local config_file="$1"
  local name
  name=$(agent_name_from_config "$config_file")
  if is_agent_running "$name"; then
    echo -e "  ${YELLOW}${name} already running${RESET}"
    return
  fi
  echo -e "  ${CYAN}Starting agent: ${name}...${RESET}"
  (cd "$AGENT_DIR" && bun run src/index.ts --config "$config_file" &)
  local pid=$!
  ensure_agent_dirs
  echo "$pid" > "$(agent_pid_file "$name")"
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo -e "  ${GREEN}${name} running (pid ${pid})${RESET}"
  else
    echo -e "  ${RED}${name} failed to start${RESET}"
    rm -f "$(agent_pid_file "$name")"
  fi
}

stop_agent() {
  local name="$1"
  local pidfile
  pidfile=$(agent_pid_file "$name")
  if [ ! -f "$pidfile" ]; then
    echo -e "  ${DIM}${name} not running${RESET}"
    return
  fi
  local pid
  pid=$(cat "$pidfile")
  kill "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  sleep 0.5
  echo -e "  ${GREEN}Stopped ${name} (pid ${pid})${RESET}"
}

stop_all_agents() {
  ensure_agent_dirs
  local stopped=0
  for pidfile in "$AGENT_PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    local name pid
    name=$(basename "$pidfile" .pid)
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
    echo -e "  ${GREEN}Stopped ${name} (pid ${pid})${RESET}"
    ((stopped++))
  done
  if [ "$stopped" -eq 0 ]; then
    echo -e "  ${DIM}No agents running${RESET}"
  fi
}

create_agent_config() {
  ensure_agent_dirs
  echo ""
  echo -e "  ${BOLD}Create new agent config${RESET}"
  separator

  printf "  ${BOLD}Agent ID${RESET} (e.g. researcher-agent): "
  read -r agent_id
  [ -z "$agent_id" ] && { echo -e "  ${RED}Cancelled.${RESET}"; return; }

  printf "  ${BOLD}Display name${RESET} (e.g. Researcher): "
  read -r display_name
  [ -z "$display_name" ] && display_name="$agent_id"

  printf "  ${BOLD}Role${RESET} (e.g. research): "
  read -r role

  printf "  ${BOLD}Specialization${RESET} (e.g. literature review): "
  read -r specialization

  printf "  ${BOLD}Personality${RESET} (e.g. curious and thorough): "
  read -r personality

  printf "  ${BOLD}Provider${RESET} [anthropic/openai/gemini/openai-compat] (default: anthropic): "
  read -r provider
  [ -z "$provider" ] && provider="anthropic"

  printf "  ${BOLD}Model${RESET} (default: claude-sonnet-4-20250514): "
  read -r model
  [ -z "$model" ] && model="claude-sonnet-4-20250514"

  local api_key_env="LLM_API_KEY"
  case "$provider" in
    anthropic) api_key_env="ANTHROPIC_API_KEY" ;;
    openai) api_key_env="OPENAI_API_KEY" ;;
    gemini) api_key_env="GEMINI_API_KEY" ;;
  esac

  local base_url=""
  if [ "$provider" = "openai-compat" ]; then
    printf "  ${BOLD}Base URL${RESET} (e.g. http://localhost:11434/v1): "
    read -r base_url
  fi

  printf "  ${BOLD}Enable tools?${RESET} [y/N]: "
  read -r enable_tools
  local tools_enabled="false"
  local tools_allowed=""
  if [[ "$enable_tools" =~ ^[Yy] ]]; then
    tools_enabled="true"
    printf "  ${BOLD}Allowed tools${RESET} (comma-separated, or empty for all): "
    read -r tools_allowed_raw
    if [ -n "$tools_allowed_raw" ]; then
      tools_allowed=$(echo "$tools_allowed_raw" | sed 's/,/", "/g')
      tools_allowed="[\"$tools_allowed\"]"
    else
      tools_allowed="[]"
    fi
  fi

  local config_file="$AGENT_CONFIGS_DIR/${agent_id}.toml"

  cat > "$config_file" <<TOML
[identity]
sender_id = "${agent_id}"
display_name = "${display_name}"
role = "${role}"
sender_type = "agent"
channel = "general"
tags = ["${role}"]

[server]
url = "ws://localhost:3000/ws"
api_url = "http://localhost:3000"
reconnect_delay_ms = 2000
max_reconnect_delay_ms = 15000
max_reconnect_attempts = 5
http_poll_interval_ms = 3000
bootstrap_history = 50

[llm]
provider = "${provider}"
model = "${model}"
api_key_env = "${api_key_env}"
base_url = "${base_url}"
max_tokens = 1024
temperature = 0.7

[prompt]
template = """
You are {{NAME}}, a specialist in {{SPECIALIZATION}}. {{PERSONALITY}}
You are participating in a multi-agent chat room. Keep your messages
concise and collaborative. This is a hybrid team of AI agents and
humans — encourage equal participation.
"""

[prompt.variables]
NAME = "${display_name}"
SPECIALIZATION = "${specialization}"
PERSONALITY = "${personality}"

[context]
max_messages = 40
max_chars = 12000
include_own_messages = true

[limits.rate]
min_delay_ms = 3000
max_per_minute = 10
max_message_chars = 5000

[limits.spend]
max_input_tokens = 500000
max_output_tokens = 50000

[limits.messages]
max_sent = 200
max_received = 500

[limits.session]
max_duration_minutes = 60
max_total_messages = 300
end_keywords = ["session:end", "/end"]
send_farewell = true
farewell_message = "Session limit reached. Signing off."

[tools]
enabled = ${tools_enabled}
allowed = ${tools_allowed:-[]}
denied = []
sandbox_dir = "./sandbox"
max_tool_rounds = 5
announce_tool_use = true

[guardrails]
enabled = false
proxy_url = ""

[webhooks]
url = ""
on_error = true
on_limit_reached = true
on_session_end = true
TOML

  echo ""
  echo -e "  ${GREEN}Created: ${config_file}${RESET}"
}

# ── Display ────────────────────────────────────────
show_services() {
  echo -e "  ${BOLD}Services:${RESET}"
  echo ""
  local i=1
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name dir port desc cmd <<< "$entry"
    local status
    status=$(status_label "$dir" "$port")
    printf "  ${BOLD}%d)${RESET} %-22s %s\n" "$i" "$desc" "$status"
    ((i++))
  done
  echo ""
}

show_agents() {
  ensure_agent_dirs
  echo -e "  ${BOLD}Chat Agents:${RESET}"
  echo ""

  local configs=()
  for f in "$AGENT_DIR"/agent.toml "$AGENT_CONFIGS_DIR"/*.toml; do
    [ -f "$f" ] && configs+=("$f")
  done

  if [ ${#configs[@]} -eq 0 ]; then
    echo -e "  ${DIM}No agent configs found${RESET}"
    echo ""
    return
  fi

  local i=1
  for f in "${configs[@]}"; do
    local name
    name=$(agent_name_from_config "$f")
    local running_label=""
    if is_agent_running "$name"; then
      local pid
      pid=$(cat "$(agent_pid_file "$name")")
      running_label="  ${GREEN}● pid ${pid}${RESET}"
    fi
    local file_label
    file_label=$(basename "$f")
    printf "  ${MAGENTA}%s)${RESET} %-22s ${DIM}%s${RESET}%s\n" "a${i}" "$name" "$file_label" "$running_label"
    ((i++))
  done
  echo ""
}

show_assets() {
  local assets_dir="$ROOT/ai-chat/public"
  echo -e "  ${BOLD}Shared Assets:${RESET}"
  echo ""

  local tts_status="${DIM}not downloaded${RESET}"
  if [ -d "$assets_dir/tts/tts" ]; then
    local model_count
    model_count=$(ls -d "$assets_dir"/tts/tts/tts_models--* "$assets_dir"/tts/tts/vocoder_models--* 2>/dev/null | wc -l | tr -d ' ')
    tts_status="${GREEN}${model_count} models${RESET}"
  fi

  local sf2_status="${DIM}missing${RESET}"
  [ -f "$assets_dir/MuseScore_General.sf2" ] && sf2_status="${GREEN}205M${RESET}"

  local drums_status="${DIM}missing${RESET}"
  [ -d "$assets_dir/drums808" ] && drums_status="${GREEN}$(ls "$assets_dir"/drums808/*.mp3 2>/dev/null | wc -l | tr -d ' ') samples${RESET}"

  local tools_count=0
  [ -d "$ROOT/ai-chat/chat-agent/tools" ] && tools_count=$(find "$ROOT/ai-chat/chat-agent/tools" -maxdepth 1 -name '*.ts' ! -name 'types.ts' ! -name 'index.ts' ! -name 'router.ts' ! -name 'sandbox.ts' ! -name 'cache.ts' 2>/dev/null | wc -l | tr -d ' ')
  local tools_status="${GREEN}${tools_count} tools${RESET}"

  printf "  %-20s %s\n" "TTS models" "$tts_status"
  printf "  %-20s %s\n" "SoundFont" "$sf2_status"
  printf "  %-20s %s\n" "Drum samples" "$drums_status"
  printf "  %-20s %s\n" "Agent tools" "$tools_status"
  echo ""
}

menu() {
  echo -e "  ${BOLD}Actions:${RESET}"
  echo ""
  echo -e "  ${BOLD}i)${RESET}  Install all deps       ${BOLD}r)${RESET}  Run all services"
  echo -e "  ${BOLD}s)${RESET}  Stop all services       ${BOLD}sa)${RESET} Stop all agents"
  echo ""
  echo -e "  ${BOLD}i#)${RESET} Install service #       ${BOLD}r#)${RESET} Run service #"
  echo -e "  ${BOLD}s#)${RESET} Stop service #"
  echo ""
  echo -e "  ${BOLD}ra#)${RESET} Run agent a#           ${BOLD}xa#)${RESET} Stop agent a#"
  echo -e "  ${BOLD}ra)${RESET}  Run all agents          ${BOLD}xa)${RESET}  Stop all agents"
  echo ""
  echo -e "  ${BOLD}new)${RESET}    Create agent config  ${BOLD}dry#)${RESET} Dry-run agent a#"
  echo -e "  ${BOLD}assets)${RESET} Download TTS models"
  echo ""
  echo -e "  ${BOLD}q)${RESET} Quit"
  echo ""
}

# ── Agent config array builder ─────────────────────
get_agent_configs() {
  ensure_agent_dirs
  local configs=()
  for f in "$AGENT_DIR"/agent.toml "$AGENT_CONFIGS_DIR"/*.toml; do
    [ -f "$f" ] && configs+=("$f")
  done
  echo "${configs[@]}"
}

get_agent_config_by_index() {
  local idx="$1"
  local configs
  read -ra configs <<< "$(get_agent_configs)"
  if [ "$idx" -ge 1 ] && [ "$idx" -le "${#configs[@]}" ]; then
    echo "${configs[$((idx-1))]}"
  fi
}

# ── Main loop ──────────────────────────────────────
check_bun

while true; do
  clear_screen
  header
  show_services
  show_agents
  show_assets
  separator
  menu
  printf "  ${BOLD}> ${RESET}"
  read -r choice

  case "$choice" in
    # ── Install ──
    i)
      for entry in "${SERVICES[@]}"; do
        IFS='|' read -r name dir port desc cmd <<< "$entry"
        install_service "$dir"
      done
      install_service "ai-chat/chat-agent"
      ;;
    i[1-9])
      idx="${choice:1}"
      if [ "$idx" -le "${#SERVICES[@]}" ]; then
        IFS='|' read -r name dir port desc cmd <<< "${SERVICES[$((idx-1))]}"
        install_service "$dir"
      else
        echo -e "  ${YELLOW}Invalid service number.${RESET}"
      fi
      ;;

    # ── Run services ──
    r)
      for entry in "${SERVICES[@]}"; do
        IFS='|' read -r name dir port desc cmd <<< "$entry"
        start_service "$dir" "$name" "$port" "$cmd"
      done
      ;;
    r[1-9])
      idx="${choice:1}"
      if [ "$idx" -le "${#SERVICES[@]}" ]; then
        IFS='|' read -r name dir port desc cmd <<< "${SERVICES[$((idx-1))]}"
        start_service "$dir" "$name" "$port" "$cmd"
      else
        echo -e "  ${YELLOW}Invalid service number.${RESET}"
      fi
      ;;

    # ── Stop services ──
    s)
      for entry in "${SERVICES[@]}"; do
        IFS='|' read -r name dir port desc cmd <<< "$entry"
        stop_service "$name" "$port"
      done
      stop_all_agents
      ;;
    s[1-9])
      idx="${choice:1}"
      if [ "$idx" -le "${#SERVICES[@]}" ]; then
        IFS='|' read -r name dir port desc cmd <<< "${SERVICES[$((idx-1))]}"
        stop_service "$name" "$port"
      else
        echo -e "  ${YELLOW}Invalid service number.${RESET}"
      fi
      ;;

    # ── Run agents ──
    ra)
      read -ra configs <<< "$(get_agent_configs)"
      for f in "${configs[@]}"; do
        [ -f "$f" ] && start_agent "$f"
      done
      ;;
    ra[1-9]|ra[1-9][0-9])
      idx="${choice:2}"
      config_file=$(get_agent_config_by_index "$idx")
      if [ -n "$config_file" ]; then
        start_agent "$config_file"
      else
        echo -e "  ${YELLOW}Invalid agent number.${RESET}"
      fi
      ;;

    # ── Stop agents ──
    xa)
      stop_all_agents
      ;;
    sa)
      stop_all_agents
      ;;
    xa[1-9]|xa[1-9][0-9])
      idx="${choice:2}"
      config_file=$(get_agent_config_by_index "$idx")
      if [ -n "$config_file" ]; then
        local_name=$(agent_name_from_config "$config_file")
        stop_agent "$local_name"
      else
        echo -e "  ${YELLOW}Invalid agent number.${RESET}"
      fi
      ;;

    # ── Create agent config ──
    new)
      create_agent_config
      ;;

    # ── Dry-run agent ──
    dry[1-9]|dry[1-9][0-9])
      idx="${choice:3}"
      config_file=$(get_agent_config_by_index "$idx")
      if [ -n "$config_file" ]; then
        echo ""
        (cd "$AGENT_DIR" && bun run src/index.ts --config "$config_file" --dry-run)
      else
        echo -e "  ${YELLOW}Invalid agent number.${RESET}"
      fi
      ;;

    # ── Download assets ──
    assets)
      echo ""
      local dl_script="$ROOT/ai-chat/public/download-models.sh"
      if [ -f "$dl_script" ]; then
        echo -e "  ${CYAN}Downloading TTS models (this may take a while)...${RESET}"
        bash "$dl_script"
      else
        echo -e "  ${RED}download-models.sh not found${RESET}"
      fi
      ;;

    # ── Quit ──
    q|Q)
      echo -e "  ${DIM}Bye.${RESET}"
      exit 0
      ;;
    *)
      echo -e "  ${YELLOW}Unknown option: ${choice}${RESET}"
      ;;
  esac

  echo ""
  printf "  ${DIM}Press enter to continue...${RESET}"
  read -r
done
