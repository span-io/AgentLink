export type ClientEnvelope = {
  type:
    | "hello"
    | "auth"
    | "log"
    | "status"
    | "ack"
    | "control"
    | "bootstrap"
    | "preflight"
    | "error"
    | "ping"
    | "pong";
  sessionId?: string;
  clientId?: string;
  seq?: number;
  ts?: string;
  payload?: unknown;
};

export type BootstrapControlPayload = {
  runId?: string;
  workingDirectory?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type FileCheckControlPayload = {
  runId?: string;
  workingDirectory?: string;
  filePath?: string;
};

export type ControlPayload = {
  prompt?: string;
  args?: string[];
  model?: string;
  name?: string;
} & Partial<BootstrapControlPayload> & Partial<FileCheckControlPayload>;

export type ServerControlMessage = {
  type: "control";
  action: "spawn" | "start" | "stop" | "stdin" | "prompt" | "ping" | "bootstrap" | "check_file";
  agentId?: string;
  data?: string;
  payload?: ControlPayload;
};

export type BootstrapEventStatus = "started" | "log" | "complete" | "error";
export type PreflightEventStatus = "complete" | "error";

export type LogEntry = {
  id: number;
  at: string;
  stream: "stdout" | "stderr";
  message: string;
};

export function encodeEnvelope(envelope: ClientEnvelope): string {
  return JSON.stringify(envelope);
}

export function nowIso(): string {
  return new Date().toISOString();
}
