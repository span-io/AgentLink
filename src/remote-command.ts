import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import path from "path";
import process from "process";
import type { CommandControlPayload, CommandEventStatus } from "./protocol.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_ALLOWED_COMMANDS = ["ls", "pwd", "cat", "find", "git", "node", "npx", "npm"];
const MAX_ARGS = 128;
const MAX_ARG_LEN = 4096;
const DEFAULT_MAX_OUTPUT_CHARS = 64_000;

type CommandSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: ["ignore", "pipe", "pipe"];
};

type CommandChild = ChildProcessByStdio<null, Readable, Readable>;

export type CommandTransport = {
  sendCommand(
    requestId: string,
    status: CommandEventStatus,
    details?: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    },
  ): void;
};

export type RemoteCommandNormalized = {
  requestId: string;
  command: string;
  args: string[];
  workingDirectory: string;
  timeoutMs: number;
};

type CommandDependencies = {
  spawnFn: (command: string, args: string[], options: CommandSpawnOptions) => CommandChild;
};

function parseCsvList(value: string | undefined, fallback: string[]): Set<string> {
  if (!value || !value.trim()) {
    return new Set(fallback);
  }
  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return new Set(entries.length > 0 ? entries : fallback);
}

function parseAllowedRoots(): string[] {
  const raw = process.env.AGENT_LINK_ALLOWED_WORKDIR_ROOTS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function isUnderRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertAllowedDirectory(directory: string, allowedRoots: string[]): void {
  if (allowedRoots.length === 0) {
    return;
  }
  const resolved = path.resolve(directory);
  const allowed = allowedRoots.some((root) => isUnderRoot(resolved, root));
  if (!allowed) {
    throw new Error(
      `Requested directory '${resolved}' is outside AGENT_LINK_ALLOWED_WORKDIR_ROOTS (${allowedRoots.join(", ")}).`,
    );
  }
}

export function normalizeRemoteCommandPayload(
  payload: CommandControlPayload | undefined,
  commandAllowlist: Set<string>,
): { ok: true; value: RemoteCommandNormalized } | { ok: false; requestId?: string; error: string } {
  const requestId = typeof payload?.requestId === "string" ? payload.requestId.trim() : "";
  if (!requestId) {
    return { ok: false, error: "Missing requestId." };
  }

  const command = typeof payload?.command === "string" ? payload.command.trim() : "";
  if (!command) {
    return { ok: false, requestId, error: "Missing command." };
  }
  if (!commandAllowlist.has(command)) {
    return {
      ok: false,
      requestId,
      error: `Command \"${command}\" is not allowed by AGENT_LINK_REMOTE_COMMAND_ALLOWLIST.`,
    };
  }

  const rawArgs = Array.isArray(payload?.args) ? payload.args : [];
  const args = rawArgs
    .filter((arg): arg is string => typeof arg === "string")
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);

  if (args.length > MAX_ARGS) {
    return { ok: false, requestId, error: `Command args exceed max count (${MAX_ARGS}).` };
  }

  for (const arg of args) {
    if (arg.length > MAX_ARG_LEN) {
      return { ok: false, requestId, error: `Command arg exceeds max length (${MAX_ARG_LEN}).` };
    }
  }

  const workingDirectoryRaw =
    typeof payload?.workingDirectory === "string" ? payload.workingDirectory.trim() : "";
  const workingDirectory = path.resolve(workingDirectoryRaw || process.cwd());
  const allowedRoots = parseAllowedRoots();
  try {
    assertAllowedDirectory(workingDirectory, allowedRoots);
  } catch (error) {
    return {
      ok: false,
      requestId,
      error: error instanceof Error ? error.message : "Invalid workingDirectory.",
    };
  }

  const requestedTimeout =
    typeof payload?.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
      ? payload.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(requestedTimeout, 1), MAX_TIMEOUT_MS);

  return {
    ok: true,
    value: {
      requestId,
      command,
      args,
      workingDirectory,
      timeoutMs,
    },
  };
}

export class RemoteCommandRunner {
  private readonly deps: CommandDependencies;
  private readonly commandAllowlist: Set<string>;
  private readonly maxOutputChars: number;

  constructor(
    deps: Partial<CommandDependencies> = {},
    options: {
      commandAllowlist?: Set<string>;
      maxOutputChars?: number;
    } = {},
  ) {
    this.deps = {
      spawnFn:
        deps.spawnFn ??
        ((command: string, args: string[], spawnOptions: CommandSpawnOptions) =>
          spawn(command, args, spawnOptions) as CommandChild),
    };
    this.commandAllowlist =
      options.commandAllowlist ??
      parseCsvList(process.env.AGENT_LINK_REMOTE_COMMAND_ALLOWLIST, DEFAULT_ALLOWED_COMMANDS);

    const configuredMax = Number.parseInt(process.env.AGENT_LINK_COMMAND_MAX_OUTPUT_CHARS ?? "", 10);
    this.maxOutputChars =
      options.maxOutputChars ??
      (Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_OUTPUT_CHARS);
  }

  async run(payload: CommandControlPayload | undefined, transport: CommandTransport): Promise<void> {
    const normalized = normalizeRemoteCommandPayload(payload, this.commandAllowlist);
    if (!normalized.ok) {
      if (normalized.requestId) {
        transport.sendCommand(normalized.requestId, "error", { message: normalized.error });
      }
      return;
    }

    const request = normalized.value;
    transport.sendCommand(request.requestId, "started", {
      message: `Running command: ${request.command} ${request.args.join(" ")} (cwd=${request.workingDirectory})`,
    });

    await this.runProcess(request, transport);
  }

  private async runProcess(request: RemoteCommandNormalized, transport: CommandTransport): Promise<void> {
    await new Promise<void>((resolve) => {
      let child: CommandChild;
      try {
        child = this.deps.spawnFn(request.command, request.args, {
          cwd: request.workingDirectory,
          env: {
            ...process.env,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        transport.sendCommand(request.requestId, "error", { message: `Command process error: ${message}` });
        resolve();
        return;
      }

      let settled = false;
      let stdout = "";
      let stderr = "";

      const appendClamped = (current: string, incoming: string): string => {
        const merged = current + incoming;
        if (merged.length <= this.maxOutputChars) {
          return merged;
        }
        return merged.slice(-this.maxOutputChars);
      };

      const complete = (
        status: "completed" | "error",
        details: { exitCode?: number; message?: string } = {},
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        transport.sendCommand(request.requestId, status, {
          exitCode: details.exitCode,
          stdout,
          stderr,
          message: details.message,
        });
        resolve();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        complete("error", { message: `Command timed out after ${request.timeoutMs}ms.` });
      }, request.timeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout = appendClamped(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr = appendClamped(stderr, chunk);
      });
      child.on("error", (error) => {
        complete("error", { message: `Command process error: ${error.message}` });
      });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          complete("completed", { exitCode: 0 });
          return;
        }
        complete("error", {
          exitCode: code ?? undefined,
          message: `Command exited with code ${String(code ?? "null")} signal ${String(signal ?? "null")}.`,
        });
      });
    });
  }
}
