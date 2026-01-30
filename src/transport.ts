import type { LogEntry } from "./protocol.js";
import { encodeEnvelope, nowIso, type ServerControlMessage } from "./protocol.js";
import { LogBuffer } from "./log-buffer.js";
import os from "os";

export type TransportOptions = {
  serverUrl: string;
  tokenProvider: () => Promise<string>;
  clientId: string;
  logBuffer: LogBuffer;
  onControl: (message: ServerControlMessage) => void;
  onAck: (id: number) => void;
};

export interface Transport {
  connect(): Promise<void>;
  sendLog(agentId: string, stream: "stdout" | "stderr", message: string): void;
  sendStatus(agentId: string, state: "running" | "exited" | "error"): void;
  close(): void;
}

export class NoopTransport implements Transport {
  async connect(): Promise<void> {
    return undefined;
  }
  sendLog(_agentId: string, _stream: "stdout" | "stderr", _message: string): void {
    return undefined;
  }
  sendStatus(_agentId: string, _state: "running" | "exited" | "error"): void {
    return undefined;
  }
  close(): void {
    return undefined;
  }
}

export class WebSocketTransport implements Transport {
  private readonly options: TransportOptions;
  private socket: WebSocket | null = null;
  private isExplicitClose = false;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timeout | null = null;
  private pingIntervalTimer: NodeJS.Timeout | null = null;
  private readonly maxRetryDelay = 30000;
  private readonly baseRetryDelay = 1000;
  private readonly heartbeatInterval = 30000;

  constructor(options: TransportOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.isExplicitClose = false;
    await this.establishConnection();
  }

  private heartbeat() {
    if (this.pingTimeout) clearTimeout(this.pingTimeout);
    this.pingTimeout = setTimeout(() => {
      console.warn("Connection timed out (no heartbeat). Reconnecting...");
      this.socket?.close();
    }, this.heartbeatInterval + 5000);
  }

  private async establishConnection(): Promise<void> {
    const { serverUrl, tokenProvider } = this.options;
    
    let token: string;
    try {
      token = await tokenProvider();
    } catch (err) {
      console.error("Failed to fetch session token:", err);
      this.scheduleReconnect();
      return;
    }

    const url = new URL("/api/ws", serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);

    return new Promise<void>((resolve, reject) => {
      if (this.socket) {
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.onmessage = null;
        this.socket.onopen = null;
        this.socket.close();
      }

      console.log(`Connecting to ${url.toString()}...`);
      const socket = new WebSocket(url.toString());
      this.socket = socket;

      const onOpen = () => {
        console.log("WebSocket connected.");
        this.retryCount = 0;
        this.heartbeat();
        this.startPingInterval();
        
        this.socket?.send(
          encodeEnvelope({
            type: "hello",
            clientId: this.options.clientId,
            ts: nowIso(),
            payload: { device: os.hostname(), platform: os.platform() },
          })
        );
        
        socket.onclose = this.handleClose.bind(this);
        socket.onerror = (error) => {
           console.error("WebSocket error:", error);
        };
        resolve();
      };

      const onFail = (err: any) => {
         console.error("WebSocket connection failed to open.");
         reject(new Error("WebSocket connection failed"));
      };

      socket.onopen = onOpen;
      socket.onerror = onFail;
      
      socket.onmessage = (event) => {
        this.heartbeat();
        const rawData = event.data;
        const data = typeof rawData === "string" ? rawData : rawData.toString();
        
        if (data === "pong") return;
        if (data === "ping") {
          this.socket?.send("pong");
          return;
        }

        if (!data) return;
        try {
          const message = JSON.parse(data);
          if (message.type === "control") {
            this.options.onControl(message as ServerControlMessage);
          } else if (message.type === "ping") {
            this.socket?.send("pong");
          } else if (message.type === "ack" && typeof message.id === "number") {
            this.options.onAck(message.id);
          }
        } catch (err) {
          // ignore malformed
        }
      };
    });
  }

  private handleClose() {
    if (this.isExplicitClose) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    this.stopPingInterval();
    const delay = Math.min(this.baseRetryDelay * Math.pow(1.5, this.retryCount), this.maxRetryDelay);
    console.log(`Reconnecting in ${delay}ms... (Attempt ${this.retryCount + 1})`);
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.establishConnection().catch(() => this.scheduleReconnect());
    }, delay);
  }

  sendLog(agentId: string, stream: "stdout" | "stderr", message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: "log",
        sessionId: agentId,
        payload: { stream, message },
      })
    );
  }

  sendStatus(agentId: string, state: "running" | "exited" | "error"): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: "status",
        sessionId: agentId,
        payload: { state },
      })
    );
  }

  close(): void {
    this.isExplicitClose = true;
    this.stopPingInterval();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimeout) clearTimeout(this.pingTimeout);
    this.socket?.close();
  }

  private startPingInterval() {
    this.stopPingInterval();
    this.pingIntervalTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send("ping");
      }
    }, 10000);
  }

  private stopPingInterval() {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = null;
    }
  }
}