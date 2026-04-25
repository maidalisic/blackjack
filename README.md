# Blackjack

Multiplayer Blackjack in the browser — up to 5 players per table, real-time over WebSockets.

## Features

- **Multiplayer** — up to 5 players per room, real-time state sync
- **Full rule set** — Hit, Stand, Double Down, Split (including 10/J/Q/K), Insurance
- **Side bets** — Perfect Pairs (35:1), 21+3 (9:1)
- **Dealer logic** — draws to 17, no hole-card peek
- **Bet timer** — 25-second countdown during the betting phase
- **Chip drag & drop** — drag chips onto table zones via touch or mouse
- **Mobile-ready** — works on iOS/Android on the same network

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Backend | Python 3.12, FastAPI, WebSockets |
| Package managers | npm (frontend), uv (backend) |
| Deployment | Render.com |
| CI | GitHub Actions |

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (`pip install uv`)

### Quick start

```bash
./start.sh
```

The script starts the backend (port 8001) and frontend (port 5174) together and prints the local and LAN addresses.

```
┌─────────────────────────────────────────────┐
│            Blackjack — running               │
├─────────────────────────────────────────────┤
│  Local:    http://localhost:5174             │
│  Network:  http://192.168.x.x:5174          │
│  Backend:  http://localhost:8001             │
├─────────────────────────────────────────────┤
│  Press  Q + Enter  to quit                  │
└─────────────────────────────────────────────┘
```

Mobile devices on the same Wi-Fi can join via the Network URL.

### Manual start

```bash
# Backend
cd backend
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Project Structure

```
blackjack/
├── backend/
│   ├── main.py          # FastAPI app, WebSocket handlers, game state
│   ├── game.py          # Card logic, hand values, split/double rules
│   ├── pyproject.toml
│   └── static/          # Frontend build output (served by the backend)
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Room.tsx     # Main game page (table, controls, drag & drop)
│   │   ├── components/
│   │   │   └── HandView.tsx # Card display component
│   │   ├── gameLogic.ts     # Hand value, canSplit, canDouble
│   │   ├── types.ts         # TypeScript types
│   │   └── App.css          # Styles (casino look)
│   └── vite.config.ts
├── .github/
│   └── workflows/
│       └── ci.yml       # Build + lint (frontend) & syntax check (backend)
├── start.sh             # Local dev launcher
└── render.yaml          # Render.com deployment config
```

## Game Flow

1. **Waiting** — host creates a room, other players join with the room code
2. **Betting** — each player places a main bet and optional side bets (PP, 21+3) via click or drag & drop; 25-second timer
3. **Insurance** — if the dealer shows an Ace, each player may place an insurance bet (max half the main bet)
4. **Playing** — players act in order (Hit / Stand / Double / Split)
5. **Dealer** — draws automatically to at least 17; insurance is settled
6. **Result** — wins and losses are shown; host starts the next round

## Deployment (Render.com)

The repo is pre-configured for Render.com via `render.yaml`. The frontend is compiled into `backend/static/` during the build and served as static files by the FastAPI backend — no separate frontend service needed.

```
Build:  pip install uv && uv sync && cd ../frontend && npm install && npm run build
Start:  uv run uvicorn main:app --host 0.0.0.0 --port $PORT
```

## CI

GitHub Actions runs on every push to `main`:

- **Frontend**: `npm ci` → `npm run build` → `eslint`
- **Backend**: `uv sync` → `python -m py_compile main.py game.py`
