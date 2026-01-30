export type ClientEnvelope = {
  type:
    | "hello"
    | "auth"
    | "log"
    | "status"
    | "ack"
    | "control"
    | "error"
    | "ping"
    | "pong";
  clientId: string;
  sessionId?: string; // This will be the agentId from the server
  seq?: number;
  ts: string;
  payload?: any;
};

export type ServerControlMessage = {
  type: "control";
  action: "spawn" | "start" | "stop" | "stdin" | "prompt" | "ping";
  agentId?: string;
  data?: string;
  payload?: {
    prompt?: string;
    args?: string[];
    model?: string;
    name?: string;
  };
};

export type LogEntry = {
  id: number;
  at: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
};

export function encodeEnvelope(envelope: ClientEnvelope): string {
  return JSON.stringify(envelope);
}

export function nowIso(): string {
  return new Date().toISOString();
}