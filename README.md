# TurboWarp WebSocket Relay Server

A Cloudflare Worker + Durable Object that acts as a WebSocket relay server for TurboWarp (modded Scratch) multiplayer projects. Converted from a Python `asyncio` + `websockets` server.

## Live URLs

| What | URL |
|------|-----|
| Log viewer (web page) | `https://turbowarp-websocket-server.jack-turbowarp.workers.dev/` |
| WebSocket endpoint (TurboWarp clients) | `wss://turbowarp-websocket-server.jack-turbowarp.workers.dev/ws` |

## How it works

- **Durable Object** (`TurboWarpServer`) — holds all WebSocket connections in memory, tracks usernames, manages pairing, and relays messages between paired clients.
- **Worker** — routes all requests to a single global Durable Object instance.
- **Log viewer page** — served at `/`. Opens a WebSocket to `/logs` and displays all server log output in real-time, color-coded by event type.

## Protocol

TurboWarp clients connect to the WebSocket endpoint and send text messages:

| Message | Action |
|---------|--------|
| `username:NAME` | Set or change username |
| `connect:TARGET` | Pair with another user by username |
| `active:NUM` | Send to both paired clients |
| `smack:DATA` | Send to both paired clients |
| *(anything else)* | Echoed back as `Echo: <message>` |

## Deploy

```bash
npx wrangler deploy
```

## Architecture

```
TurboWarp Client A ──┐
                      ├──> Worker ──> Durable Object (TurboWarpServer)
TurboWarp Client B ──┘         │
                               ├── sessions Map (ws → username)
                               ├── pairs Map (ws ↔ ws)
                               └── observers Set (log viewers)
Browser (log page) ──> /logs ─┘
```
