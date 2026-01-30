#!/usr/bin/env node
import os from "os";
import process from "process";
import { loadConfig, saveConfig } from "./config.js";
import { findAgentsOnPath, resolveAgentBinary, type AgentProcess } from "./agent.js";
import { spawnAgentProcess as spawnAgentProcessAdvanced, type SpawnedProcess } from "./process-runner.js";
import { LogBuffer } from "./log-buffer.js";
import { type ServerControlMessage } from "./protocol.js";
import { NoopTransport, WebSocketTransport, type Transport } from "./transport.js";

type CliArgs = {
  serverUrl?: string;
  pairingCode?: string;
  agent?: string;
  list?: boolean;
  localStdin?: boolean;
  noConnect?: boolean;
  agentArgs: string[];
};

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  const agents = findAgentsOnPath();
  if (agents.length === 0) {
    console.log("No supported agents found on PATH (codex, gemini, claude).");
    process.exitCode = 1;
  } else {
    for (const agent of agents) {
      console.log(`${agent.name}: ${agent.path}`);
    }
  }
  process.exit(0);
}

const config = loadConfig();
if (args.serverUrl) {
  config.serverUrl = args.serverUrl;
}

if (args.pairingCode) {
  if (!config.serverUrl) {
    console.error("Pairing requires --server.");
    process.exit(1);
  }
  await pairWithServer({
    serverUrl: config.serverUrl,
    pairingCode: args.pairingCode,
    label: os.hostname(),
  }).then((res) => {
    config.clientId = res.clientId;
    config.refreshToken = res.refreshToken;
    saveConfig(config);
    console.log("Pairing successful.");
  });
}

const logBuffer = new LogBuffer();
// Update map to hold SpawnedProcess which includes the child
const activeAgents = new Map<string, SpawnedProcess>();

let transport: Transport;
try {
  transport = await createTransport({
    config,
    logBuffer,
    onControl: (message) => handleControl(message),
    onAck: (id) => logBuffer.setLastAckedId(id),
    noConnect: args.noConnect ?? false,
  });
} catch (error) {
  console.error(`Connection failed, running offline: ${error instanceof Error ? error.message : "unknown error"}`);
  transport = new NoopTransport();
}

function handleControl(message: ServerControlMessage): void {
  const { action, agentId, payload } = message;
  if (!agentId) return;

  switch (action) {
    case "spawn":
    case "start": {
      let agentProc = activeAgents.get(agentId);
      if (agentProc) {
        if (payload?.prompt && agentProc.child.stdin) {
          agentProc.child.stdin.write(`${payload.prompt}\n`);
        }
        return;
      }

      const discovered = findAgentsOnPath();
      
      let preferredAgent = args.agent;
      let targetModel = payload?.model;

      // Fallback: Try to find model in args if not in payload top-level
      if (!targetModel && payload?.args) {
        const argsList = payload.args as string[];
        const modelIndex = argsList.findIndex(a => a === "--model" || a === "-m");
        if (modelIndex >= 0 && modelIndex + 1 < argsList.length) {
          targetModel = argsList[modelIndex + 1];
        }
      }

      if (!preferredAgent && targetModel) {
        if (targetModel.startsWith("gemini-")) {
          preferredAgent = "gemini";
        } else if (targetModel.startsWith("claude-")) {
          preferredAgent = "claude";
        }
      }

      if (!preferredAgent) {
        preferredAgent = payload?.name || "codex";
      }

      const agentCandidate = resolveAgentBinary(preferredAgent, discovered);
      if (!agentCandidate) {
        console.error(`No agent found for ${preferredAgent || "any supported agent"}`);
        transport.sendStatus(agentId, "error");
        return;
      }

      const optionsArgs = [...(payload?.args || args.agentArgs)];
      
      const proc = spawnAgentProcessAdvanced({
        agent: {
            id: agentId,
            name: agentCandidate.name,
            model: targetModel || "codex-cli" 
        },
        prompt: payload?.prompt || "",
        optionsArgs,
        executablePath: agentCandidate.path
      });

      activeAgents.set(agentId, proc);
      
      console.log(`[${new Date().toLocaleTimeString()}] Spawning agent: ${agentCandidate.name} (${targetModel || "default model"})`);

      transport.sendStatus(agentId, "running");

      setupAgentPiping(agentId, proc);
      break;
    }
    case "stop": {
      const proc = activeAgents.get(agentId);
      if (proc) {
        proc.child.kill();
        activeAgents.delete(agentId);
      }
      break;
    }
    case "stdin":
    case "prompt": {
      const proc = activeAgents.get(agentId);
      const data = message.data || payload?.prompt;
      if (proc && data && proc.child.stdin) {
        proc.child.stdin.write(data.endsWith("\n") ? data : `${data}\n`);
      }
      break;
    }
  }
}

function setupAgentPiping(agentId: string, proc: SpawnedProcess) {
  const setupStream = (stream: NodeJS.ReadableStream | null, name: "stdout" | "stderr") => {
    if (!stream) return;
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index + 1);
        buffer = buffer.slice(index + 1);
        transport.sendLog(agentId, name, line);
        index = buffer.indexOf("\n");
      }
    });
    stream.on("end", () => {
      if (buffer.length > 0) {
        transport.sendLog(agentId, name, buffer);
      }
    });
  };

  setupStream(proc.child.stdout, "stdout");
  setupStream(proc.child.stderr, "stderr");

  proc.child.on("exit", (code, signal) => {
    transport.sendStatus(agentId, "exited");
    activeAgents.delete(agentId);
  });

  proc.child.on("error", (error) => {
    transport.sendLog(agentId, "stderr", `Process error: ${error.message}\n`);
    transport.sendStatus(agentId, "error");
    activeAgents.delete(agentId);
  });
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { agentArgs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--server":
        parsed.serverUrl = argv[++i];
        break;
      case "--pairing-code":
        parsed.pairingCode = argv[++i];
        break;
      case "--agent":
        parsed.agent = argv[++i];
        break;
      case "--list":
        parsed.list = true;
        break;
      case "--no-connect":
        parsed.noConnect = true;
        break;
      case "--":
        parsed.agentArgs.push(...argv.slice(i + 1));
        i = argv.length;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown argument: ${arg}`);
          process.exit(1);
        } else {
          parsed.agentArgs.push(arg);
        }
    }
  }
  return parsed;
}

function printHelp(): void {
  console.log(`remote-agent-client

Usage:
  remote-agent-client --server https://host --pairing-code 123-456
  remote-agent-client --server https://host

Options:
  --server <url>        Remote Agent server URL
  --pairing-code <code> Pairing code for first-time auth
  --agent <name|path>   Preferred agent (codex, gemini, claude)
  --list                List discovered agents
  --no-connect          Run without server connection
  --                    Pass remaining args to the agent
`);
}

type PairingInput = {
  serverUrl: string;
  pairingCode: string;
  label: string;
};

async function pairWithServer(input: PairingInput): Promise<{ clientId: string; refreshToken: string }> {
  const response = await fetch(new URL("/api/clients/pair", input.serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: input.pairingCode,
      label: input.label,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Pairing failed (${response.status}): ${details}`);
  }

  return (await response.json()) as { clientId: string; refreshToken: string };
}

type TransportInput = {
  config: { serverUrl?: string; refreshToken?: string; clientId?: string };
  logBuffer: LogBuffer;
  onControl: (message: ServerControlMessage) => void;
  onAck: (id: number) => void;
  noConnect: boolean;
};

async function createTransport(input: TransportInput): Promise<Transport> {
  if (input.noConnect || !input.config.serverUrl || !input.config.refreshToken || !input.config.clientId) {
    return new NoopTransport();
  }

  const transport = new WebSocketTransport({
    serverUrl: input.config.serverUrl,
    tokenProvider: () => requestSessionToken(input.config.serverUrl!, input.config.refreshToken!),
    clientId: input.config.clientId,
    logBuffer: input.logBuffer,
    onControl: input.onControl,
    onAck: input.onAck,
  });

  await transport.connect();
  return transport;
}

async function requestSessionToken(serverUrl: string, refreshToken: string): Promise<string> {
  const response = await fetch(new URL("/api/clients/session", serverUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${refreshToken}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Session token request failed (${response.status})`);
  }

  const data = (await response.json()) as { sessionToken: string };
  return data.sessionToken;
}