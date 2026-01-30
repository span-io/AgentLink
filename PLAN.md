# Implementation Plan

## 1) Review of current `remote-agent`
- UI pulls agent lists and log streams via SSE endpoints in `app/api/agents/*`.
- `lib/server/agents/process-hub.ts` owns process spawning, log capture, and session persistence.
- There is no authentication layer yet.

## 2) Proposed architecture
### Roles
- **remote-agent (server/UI)**: hosts the UI, persists sessions, and brokers connections.
- **remote-agent-client (this project)**: runs on user machine, spawns local agent CLI, streams stdio to server.
- **Agent CLI**: `codex`, `gemini`, or `claude` installed locally.

### Transport
- Use a single persistent WebSocket (or WebTransport if available later) from client to server.
- Messages are framed JSON with a compact envelope:
  - `type: hello | auth | log | status | ack | control | error | ping | pong`
  - `sessionId`, `clientId`, `seq`, `ts`, `payload`
- Backpressure: client buffers output and respects server `ack` cursor.
- Replay: on reconnect, client resumes from last acknowledged `seq`.

### Client execution model
- Client confirms one of `codex`, `gemini`, `claude` on PATH (config override allowed).
- Launches a single agent process per session; captures stdout/stderr.
- Exposes a minimal control channel: start, stop, and send prompt (stdin or args mode).

## 3) Authentication plan (security-first)
- Pairing flow from UI:
  1. UI requests a **pairing code** (short TTL, one-time use).
  2. Client presents pairing code to `/api/clients/pair` to receive **device access token** + **refresh token**.
  3. Client stores tokens in OS keychain when available; otherwise encrypted local file.
- Each WebSocket session uses a short-lived **session token** minted from refresh token.
- Tokens are scoped to `clientId` and device fingerprint; server can revoke at any time.
- All connections require TLS; refuse insecure HTTP in production mode.

## 4) Server changes needed in `remote-agent`
- Add authenticated client registry and session store (revocation list, device metadata).
- Add `/api/clients/pair`, `/api/clients/session` (issue short-lived session tokens).
- Add WebSocket endpoint `/api/clients/stream` for logs + control messages.
- Update UI to display **remote client sessions** alongside local ones.
- Extend `process-hub` abstraction to support remote runners vs local spawn.

## 5) Reliability & observability
- Heartbeat every 10-15s; fail fast on missed heartbeats.
- Persistent session metadata (last seen, last ack, exit code).
- Client-side ring buffer for unacked logs.
- Audit log for auth events and remote control actions.

## 6) Open questions
- Which auth mechanism is preferred (pairing code vs. OIDC device flow)?
- Should the client support multiple concurrent agent sessions?
- Do we allow stdin streaming for interactive tools, or prompts-only v0?

## 7) Implementation Status (2026-01-29)
- [x] **Transport**: WebSocket implementation with resilient reconnect and log replay.
- [x] **Reliability**: Heartbeats (Ping/Pong) and client-side watchdog (30s timeout).
- [x] **Security**: Refresh tokens are stored in an encrypted local file (`.remote-agent-client/config.json`) using a machine-specific key.
- [x] **Client Execution**: Spawning of local agents (`codex`, `gemini`, `claude`) and stdio piping is functional.