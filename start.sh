#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

BACKEND_PORT=8001
FRONTEND_PORT=5174

cleanup() {
    echo ""
    echo "Shutting down..."
    [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null
    [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null
    wait 2>/dev/null
    echo "Done."
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Start backend ──────────────────────────────────────────
echo "Installing backend dependencies..."
cd "$BACKEND_DIR"
uv sync --quiet

echo "Starting backend on port $BACKEND_PORT..."
uv run uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" \
    --log-level warning &
BACKEND_PID=$!

# ── Start frontend ─────────────────────────────────────────
echo "Starting frontend on port $FRONTEND_PORT..."
cd "$FRONTEND_DIR"
npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

# ── Wait for servers ───────────────────────────────────────
echo "Waiting for servers..."
for i in $(seq 1 20); do
    sleep 0.5
    nc -z 127.0.0.1 "$BACKEND_PORT"  2>/dev/null && \
    nc -z 127.0.0.1 "$FRONTEND_PORT" 2>/dev/null && break
done

# ── Get local network IP ───────────────────────────────────
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null \
    || ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' \
    || echo "unknown")

# ── Print info panel ───────────────────────────────────────
clear
echo "┌─────────────────────────────────────────────┐"
echo "│            Blackjack — running               │"
echo "├─────────────────────────────────────────────┤"
echo "│  Local:    http://localhost:$FRONTEND_PORT        │"
echo "│  Network:  http://$LAN_IP:$FRONTEND_PORT       │"
echo "│  Backend:  http://localhost:$BACKEND_PORT        │"
echo "├─────────────────────────────────────────────┤"
echo "│  Admin:    http://localhost:$FRONTEND_PORT/admin  │"
echo "│  Admin:    http://$LAN_IP:$FRONTEND_PORT/admin │"
echo "├─────────────────────────────────────────────┤"
echo "│  Press  Q + Enter  to quit                  │"
echo "└─────────────────────────────────────────────┘"
echo ""

# ── Menu loop ─────────────────────────────────────────────
while true; do
    read -r -p "> " input
    case "${input,,}" in
        q|quit|exit) cleanup ;;
        *) echo "  (Q to quit)" ;;
    esac
done
