import { spawn } from "child_process";

// Types adapted for Client
export type AgentSpec = {
  id: string;
  name: string;
  model: string;
};

export type SpawnConfig = {
  agent: AgentSpec;
  prompt: string;
  optionsArgs?: string[];
  executablePath?: string;
};

export type SpawnedProcess = {
  child: ReturnType<typeof spawn>;
  pid: number | null;
  startedAt: string;
  command: string;
  args: string[];
  promptMode: "args" | "stdin";
};

const DEFAULT_CODEX_ARGS = "exec --skip-git-repo-check";
const DEFAULT_GEMINI_ARGS = "";
const DEFAULT_GEMINI_PROMPT_FLAG = "-p";
const DEFAULT_PROMPT_FLAG = "";
const DEFAULT_TTY_MODE = "auto";
const DEFAULT_TTY_TERM = "dumb";

function splitArgs(raw: string): string[] {
  return raw.trim() === "" ? [] : raw.trim().split(/\s+/g);
}

function shellQuote(value: string): string {
  // Simple single-quote wrapping for display purposes
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildCommand(
  { agent, prompt, optionsArgs = [], executablePath }: SpawnConfig,
  promptModeOverride?: "args" | "stdin",
): { command: string; args: string[]; promptMode: "args" | "stdin" } {
  // 1. Gemini Models
  if (agent.model.startsWith("gemini-")) {
    const command = executablePath ?? process.env.GEMINI_BIN ?? "gemini";
    const rawArgs = process.env.GEMINI_ARGS ?? DEFAULT_GEMINI_ARGS;
    const promptFlag = process.env.GEMINI_PROMPT_FLAG ?? DEFAULT_GEMINI_PROMPT_FLAG;
    const args = splitArgs(rawArgs);

    if (optionsArgs.length > 0) {
      args.push(...optionsArgs);
    }

    if (!args.includes("--model") && !args.includes("-m")) {
      args.push("--model", agent.model);
    }

    if (!args.includes("--approval-mode")) {
      args.push("--approval-mode", "auto_edit");
    }

    args.push(promptFlag, prompt);
    return { command, args, promptMode: "args" };
  }

  // 2. Claude Models
  if (agent.model.startsWith("claude-")) {
    const command = executablePath ?? process.env.CLAUDE_BIN ?? "claude";
    const args = ["-p", prompt, "--model", agent.model];
    return { command, args, promptMode: "args" };
  }

  // 3. Generic Codex/Other Models
  const command = executablePath ?? process.env.CODEX_BIN ?? "codex";
  const rawArgs = process.env.CODEX_ARGS ?? DEFAULT_CODEX_ARGS;
  const promptFlag = process.env.CODEX_PROMPT_FLAG ?? DEFAULT_PROMPT_FLAG;
  
  // Determine Prompt Mode
  const envPromptMode =
    process.env.CODEX_PROMPT_MODE === "stdin" ? "stdin" : "args";
  const promptMode = promptModeOverride ?? envPromptMode;
  
  const extraArgs = optionsArgs.filter((arg) => arg.trim() !== "");
  const args = splitArgs(rawArgs);

  if (promptMode === "args") {
    if (extraArgs.length) {
      args.push(...extraArgs);
    }

    if (!args.includes("--model") && !args.includes("-m")) {
      args.push("--model", agent.model);
    }

    // Handle {prompt} placeholder or append
    const placeholderIndex = args.findIndex((arg) => arg.includes("{prompt}"));
    if (placeholderIndex >= 0) {
      args[placeholderIndex] = args[placeholderIndex].replace("{prompt}", prompt);
    } else {
      if (promptFlag) {
        args.push(promptFlag);
      }
      args.push(prompt);
    }

    return { command, args, promptMode: "args" };
  }

  // Stdin Mode
  if (promptMode === "stdin") {
    if (extraArgs.length) {
      args.push(...extraArgs);
    }
    if (!args.includes("--model") && !args.includes("-m")) {
      args.push("--model", agent.model);
    }
  }

  return { command, args, promptMode };
}

export function spawnAgentProcess(config: SpawnConfig): SpawnedProcess {
  const { agent, optionsArgs = [] } = config;
  const startedAt = new Date().toISOString();
  const isCodexModel =
    !agent.model.startsWith("gemini-") && !agent.model.startsWith("claude-");
  const sanitizedOptions = agent.model.startsWith("claude-")
    ? []
    : optionsArgs;

  const spawnWithMode = (promptModeOverride?: "args" | "stdin"): SpawnedProcess => {
    const { command, args, promptMode } = buildCommand(
      { ...config, optionsArgs: sanitizedOptions },
      promptModeOverride,
    );
    
    const ttyMode = process.env.CODEX_TTY_MODE ?? DEFAULT_TTY_MODE;
    const hasExec = args.includes("exec");
    const useScriptWrapper =
      ttyMode === "script" || (ttyMode === "auto" && hasExec);
    const ttyTerm = process.env.CODEX_TTY_TERM ?? DEFAULT_TTY_TERM;
    const defaultCwd = process.cwd(); // Client uses current working dir
    const workingDir = process.env.CODEX_CWD ?? defaultCwd;
    
    // For logging/display
    const commandString = [command, ...args].map(shellQuote).join(" ");
    const platform = process.platform;
    const canUseScript =
      useScriptWrapper && platform !== "win32";
    const finalCommand = canUseScript ? "script" : command;
    const finalArgs = canUseScript
      ? platform === "darwin"
        // BSD script: no -c, use "script -q /dev/null sh -c <command>"
        ? ["-q", "/dev/null", "sh", "-c", commandString]
        // GNU script: "script -q -c <command> /dev/null"
        : ["-q", "-c", commandString, "/dev/null"]
      : args;

    const child = spawn(finalCommand, finalArgs, {
      stdio: [promptMode === "stdin" ? "pipe" : "ignore", "pipe", "pipe"],
      cwd: workingDir,
      env: {
        ...process.env,
        CODEX_AGENT_ID: agent.id,
        CODEX_AGENT_NAME: agent.name,
        CODEX_AGENT_MODEL: agent.model,
        ...(useScriptWrapper ? { TERM: ttyTerm } : {}),
      }
    });

    if (promptMode === "stdin") {
      child.stdin?.write(config.prompt);
      child.stdin?.end();
    }

    return {
      child,
      pid: child.pid ?? null,
      startedAt,
      command: finalCommand,
      args: finalArgs,
      promptMode
    };
  };

  try {
    return spawnWithMode();
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : null;
    if (code === "E2BIG" && isCodexModel) {
      console.warn("Spawn args exceeded system limits; retrying via stdin.");
      return spawnWithMode("stdin");
    }
    throw error;
  }
}
