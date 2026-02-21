import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import process from "process";
import { mkdir } from "fs/promises";
import type { BootstrapControlPayload, BootstrapEventStatus } from "./protocol.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_ALLOWED_COMMANDS = ["npx", "npm"];
const DEFAULT_ALLOWED_ENV = ["CI", "NODE_ENV", "NPM_CONFIG_YES"];
const MAX_ARGS = 128;
const MAX_ARG_LEN = 4096;

export type BootstrapTransport = {
  sendBootstrap(runId: string, status: BootstrapEventStatus, message?: string): void;
};

export type BootstrapNormalized = {
  runId: string;
  workingDirectory: string;
  command: string;
  args: string[];
  timeoutMs: number;
  env: Record<string, string>;
};

type BootstrapSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: ["ignore", "pipe", "pipe"];
};

type BootstrapChild = ChildProcessByStdio<null, Readable, Readable>;

type BootstrapDependencies = {
  mkdirFn: (path: string) => Promise<void>;
  spawnFn: (
    command: string,
    args: string[],
    options: BootstrapSpawnOptions,
  ) => BootstrapChild;
};

export function parseCsvList(value: string | undefined, fallback: string[]): Set<string> {
  if (!value || !value.trim()) {
    return new Set(fallback);
  }
  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return new Set(entries.length > 0 ? entries : fallback);
}

export function sanitizeBootstrapEnv(
  input: Record<string, string> | undefined,
  allowed: Set<string>,
): Record<string, string> {
  if (!input) {
    return {};
  }
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_ARG_LEN) {
      continue;
    }
    sanitized[key] = trimmed;
  }
  return sanitized;
}

export function normalizeBootstrapPayload(
  payload: BootstrapControlPayload | undefined,
  commandAllowlist: Set<string>,
  envAllowlist: Set<string>,
): { ok: true; value: BootstrapNormalized } | { ok: false; error: string } {
  const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
  if (!runId) {
    return { ok: false, error: "Missing runId." };
  }

  const workingDirectory =
    typeof payload?.workingDirectory === "string" ? payload.workingDirectory.trim() : "";
  if (!workingDirectory) {
    return { ok: false, error: "Missing workingDirectory." };
  }

  const command =
    typeof payload?.command === "string" && payload.command.trim().length > 0
      ? payload.command.trim()
      : "npx";
  if (!commandAllowlist.has(command)) {
    return {
      ok: false,
      error: `Bootstrap command \"${command}\" is not allowed.`,
    };
  }

  const argsRaw = Array.isArray(payload?.args) ? payload.args : [];
  const args = argsRaw
    .filter((arg): arg is string => typeof arg === "string")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);

  if (args.length > MAX_ARGS) {
    return { ok: false, error: `Bootstrap args exceed max count (${MAX_ARGS}).` };
  }

  for (const arg of args) {
    if (arg.length > MAX_ARG_LEN) {
      return { ok: false, error: `Bootstrap arg exceeds max length (${MAX_ARG_LEN}).` };
    }
  }

  const requestedTimeout =
    typeof payload?.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
      ? payload.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(requestedTimeout, 1), MAX_TIMEOUT_MS);

  const env = sanitizeBootstrapEnv(payload?.env, envAllowlist);

  return {
    ok: true,
    value: {
      runId,
      workingDirectory,
      command,
      args,
      timeoutMs,
      env,
    },
  };
}

export class BootstrapRunner {
  private readonly deps: BootstrapDependencies;

  private activeRunId: string | null = null;

  private readonly commandAllowlist: Set<string>;

  private readonly envAllowlist: Set<string>;

  constructor(
    deps: Partial<BootstrapDependencies> = {},
    options: {
      commandAllowlist?: Set<string>;
      envAllowlist?: Set<string>;
    } = {},
  ) {
    this.deps = {
      mkdirFn: deps.mkdirFn ?? (async (path: string) => {
        await mkdir(path, { recursive: true });
      }),
      spawnFn:
        deps.spawnFn ??
        ((command: string, args: string[], options: BootstrapSpawnOptions) =>
          spawn(command, args, options) as BootstrapChild),
    };
    this.commandAllowlist =
      options.commandAllowlist ??
      parseCsvList(process.env.AGENT_LINK_BOOTSTRAP_ALLOWED_COMMANDS, DEFAULT_ALLOWED_COMMANDS);
    this.envAllowlist =
      options.envAllowlist ??
      parseCsvList(process.env.AGENT_LINK_BOOTSTRAP_ALLOWED_ENV, DEFAULT_ALLOWED_ENV);
  }

  async run(payload: BootstrapControlPayload | undefined, transport: BootstrapTransport): Promise<void> {
    const normalized = normalizeBootstrapPayload(payload, this.commandAllowlist, this.envAllowlist);
    if (!normalized.ok) {
      const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
      if (runId) {
        transport.sendBootstrap(runId, "error", normalized.error);
      }
      return;
    }

    const request = normalized.value;
    if (this.activeRunId) {
      transport.sendBootstrap(
        request.runId,
        "error",
        `Bootstrap already running for run ${this.activeRunId}.`,
      );
      return;
    }

    this.activeRunId = request.runId;
    try {
      await this.deps.mkdirFn(request.workingDirectory);
      transport.sendBootstrap(
        request.runId,
        "started",
        `Running bootstrap command: ${request.command} ${request.args.join(" ")} (cwd=${request.workingDirectory})`,
      );
      await this.runProcess(request, transport);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      transport.sendBootstrap(request.runId, "error", `Bootstrap failed: ${message}`);
    } finally {
      if (this.activeRunId === request.runId) {
        this.activeRunId = null;
      }
    }
  }

  private async runProcess(request: BootstrapNormalized, transport: BootstrapTransport): Promise<void> {
    await new Promise<void>((resolve) => {
      let child: BootstrapChild;
      try {
        child = this.deps.spawnFn(request.command, request.args, {
          cwd: request.workingDirectory,
          env: {
            ...process.env,
            ...request.env,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        transport.sendBootstrap(request.runId, "error", `Bootstrap process error: ${message}`);
        resolve();
        return;
      }

      let settled = false;
      const complete = (status: "complete" | "error", message: string) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        transport.sendBootstrap(request.runId, status, message);
        resolve();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        complete("error", `Bootstrap timed out after ${request.timeoutMs}ms.`);
      }, request.timeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        transport.sendBootstrap(request.runId, "log", chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        transport.sendBootstrap(request.runId, "log", chunk);
      });
      child.on("error", (error) => {
        complete("error", `Bootstrap process error: ${error.message}`);
      });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          complete("complete", "Bootstrap completed successfully.");
          return;
        }
        complete(
          "error",
          `Bootstrap exited with code ${String(code ?? "null")} signal ${String(signal ?? "null")}.`,
        );
      });
    });
  }
}
