# AgentLink (Client)

**AgentLink** is the secure bridge between your local development environment and **Span**, the remote control plane. It allows you to run powerful AI agent tools (like Codex, Gemini, or Claude) on your own machine—where they have access to your code, compilers, and local tools—while controlling and monitoring them from a centralized web interface.

Think of it as a **reverse tunnel for AI agents**: The "brains" and history live in the cloud (or your self-hosted server), but the "hands" are local.

## 🚀 How It Works

1.  **You run this CLI** on your laptop or dev server.
2.  **It connects** to your Remote Agent Orchestrator via a secure WebSocket.
3.  **It waits for commands.** When you send a prompt in the Web UI, the server signals this client.
4.  **It executes the agent** locally on your machine.
5.  **It streams logs/output** back to the Web UI in real-time.

## 📦 Installation & Usage

You don't need to install this globally. We recommend running it on-demand via `npx`.

### 1. Connect a New Device
In the Remote Agent Web UI, click **+ Connect New Device**. You will be given a pairing code.

Run the following command in your terminal:

```bash
npx -y remote-agent-client --server https://www.code-agent.online --pairing-code YOUR-PAIRING-CODE
```

### 2. Run in Background
Once paired, the client will save your credentials to `~/.config/remote-agent/client.json`. You can subsequently run it without the pairing code:

```bash
npx -y remote-agent-client --server https://www.code-agent.online
```

### 3. Agent Selection
By default, the client auto-discovers supported agents (`codex`, `gemini`, `claude`) in your `PATH`.
You can force a specific binary using the `--agent` flag or environment variables:

```bash
# Force usage of a specific binary
npx -y remote-agent-client --server ... --agent /usr/local/bin/my-custom-codex
```

## 🔒 Security & Risk Profile

**This tool allows a remote server to execute commands on your machine.** It is designed for developers who own both the server and the client.

### What it Protects Against
*   **Unauthorized Connection:** Pairing requires a short-lived, cryptographic code. Once paired, connections use a refresh token bound to your device.
*   **Man-in-the-Middle:** All traffic is encrypted via TLS (WebSocket Secure).
*   **Drive-by Attacks:** The client does not listen on any open ports; it makes an outbound connection to the server.

### What it Does NOT Protect Against
*   **Compromised Server:** If your Remote Agent Orchestrator server is hacked, an attacker can send "spawn" commands to your connected client.
*   **Malicious Agent Output:** If the AI agent (e.g., Gemini) decides to run `rm -rf /`, this client will faithfully execute that command.
*   **Local Privilege Escalation:** The agent runs with the same permissions as the user who ran `npx remote-agent-client`. Do not run this as root.

### ⚠️ Threat Model: "Remote Shell"
You should treat this client with the same security caution as an **SSH Session**.
*   **Difficulty for Malicious Actors:** If they compromise your Orchestrator account, gaining code execution on your local machine is **Trivial (Low Difficulty)**. They just need to send a prompt to the agent telling it to run a shell command.
*   **Mitigation:**
    *   Only connect to servers you trust.
    *   Run the client inside a Docker container or VM if you are working with untrusted inputs.
    *   Use the agent's built-in sandboxing (e.g. `--approval-mode`) to review commands before they run.

## 🛠 Configuration

Configuration is stored in `~/.config/remote-agent/client.json`.

**Environment Variables:**
*   `CODEX_BIN`, `GEMINI_BIN`, `CLAUDE_BIN`: Override the path to specific agent binaries.
*   `CODEX_CWD`: Set the working directory for the agent (defaults to the directory where you ran the client).

## License

MIT