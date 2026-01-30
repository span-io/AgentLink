import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export type AgentCandidate = {
  name: "codex" | "gemini" | "claude";
  path: string;
};

export type AgentProcess = {
  name: AgentCandidate["name"];
  child: ReturnType<typeof spawn>;
};

const AGENT_NAMES: AgentCandidate["name"][] = ["codex", "gemini", "claude"];

export function findAgentsOnPath(): AgentCandidate[] {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const results: AgentCandidate[] = [];

  for (const name of AGENT_NAMES) {
    for (const dir of pathEntries) {
      const fullPath = path.join(dir, name);
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        results.push({ name, path: fullPath });
        break;
      } catch {
        // continue searching
      }
    }
  }

  return results;
}

export function resolveAgentBinary(
  preferred?: string,
  discovered?: AgentCandidate[]
): AgentCandidate | null {
  // 1. Check for specific environment variable overrides first
  if (preferred === "codex" && process.env.CODEX_BIN) {
    return { name: "codex", path: process.env.CODEX_BIN };
  }
  if (preferred === "gemini" && process.env.GEMINI_BIN) {
    return { name: "gemini", path: process.env.GEMINI_BIN };
  }
  if (preferred === "claude" && process.env.CLAUDE_BIN) {
    return { name: "claude", path: process.env.CLAUDE_BIN };
  }

  // 2. If preferred is an absolute/relative path that exists
  if (preferred) {
    if (fs.existsSync(preferred)) {
      return {
        name: inferNameFromPath(preferred),
        path: preferred,
      };
    }
    const byName = (discovered ?? findAgentsOnPath()).find(
      (agent) => agent.name === preferred
    );
    return byName ?? null;
  }

  const available = discovered ?? findAgentsOnPath();
  return available[0] ?? null;
}

function inferNameFromPath(agentPath: string): AgentCandidate["name"] {
  const base = path.basename(agentPath).toLowerCase();
  if (base.includes("gemini")) {
    return "gemini";
  }
  if (base.includes("claude")) {
    return "claude";
  }
  return "codex";
}

export function spawnAgentProcess(
  agent: AgentCandidate,
  args: string[]
): AgentProcess {
  const child = spawn(agent.path, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  return { name: agent.name, child };
}
