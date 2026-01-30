# remote-agent-client

Client companion for Remote Agent Orchestrator (the `remote-agent` web UI). This client runs on a user's machine and streams local stdio to the hosted UI with a persistent, authenticated connection.

## Status
Scaffold + initial runtime. Server endpoints are still pending in `remote-agent`.

## Goals
- Persistent, low-latency streaming of stdout/stderr/system logs to the remote UI.
- Secure pairing + authentication; least privilege by default.
- Support for launching and supervising an installed local agent CLI (Codex, Gemini, or Claude).
- Resilient reconnect with replay from last acknowledged log index.

## Usage (dev)
```bash
npm install
npm run build
node dist/index.js --list
node dist/index.js --server https://host --pairing-code 123-456
node dist/index.js --server https://host --agent codex --local-stdin
```

## Relationship to `remote-agent`
The server currently spawns agent processes locally and streams logs via SSE (`/api/agents/[id]/stream`). This client shifts execution to the user's device while keeping the UI and session persistence in `remote-agent`.

## Security posture (high level)
- Mandatory auth handshake (pairing code or QR -> short-lived token -> long-lived refresh token bound to device).
- TLS required for all client/server connections.
- Session keys rotated; explicit session revoke support.
- Strict allow-list of commands and args passed to local agent binaries.
- No plaintext secrets on disk; OS keychain when possible.

See `PLAN.md` for details.
