import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { WebSocketTransport } from "../src/transport.js";
import { LogBuffer } from "../src/log-buffer.js";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
        if (this.onopen) this.onopen();
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code: 1000, reason: "Normal closure" });
  }

  simulateClose(code = 1006) {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) this.onclose({ code, reason: "Abnormal" });
  }
}

(global as any).WebSocket = MockWebSocket;

let transport: WebSocketTransport | null = null;

describe("WebSocketTransport", () => {
  afterEach(() => {
    if (transport) {
      transport.close();
      transport = null;
    }
    MockWebSocket.instances = [];
  });

  it("should connect and send hello", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const logBuffer = new LogBuffer();
    transport = new WebSocketTransport({
      serverUrl: "http://localhost:3000",
      tokenProvider: async () => "abc",
      clientId: "client1",
      logBuffer,
      onControl: () => {},
      onAck: () => {},
    });

    const connectPromise = transport.connect();
    t.mock.timers.tick(15);
    await connectPromise;

    assert.strictEqual(MockWebSocket.instances.length, 1);
    const ws = MockWebSocket.instances[0];
    assert.match(ws.url, /token=abc/);
    assert.match(ws.url, /\/api\/ws/);
    
    const hello = JSON.parse(ws.sentMessages[0]);
    assert.strictEqual(hello.type, "hello");
  });

  it("should send log in specified format", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const logBuffer = new LogBuffer();
    transport = new WebSocketTransport({
      serverUrl: "http://localhost:3000",
      tokenProvider: async () => "abc",
      clientId: "client1",
      logBuffer,
      onControl: () => {},
      onAck: () => {},
    });

    const connectPromise = transport.connect();
    t.mock.timers.tick(15);
    await connectPromise;
    
    transport.sendLog("agent-1", "stdout", "hello world");
    
    const ws = MockWebSocket.instances[0];
    const logMsg = JSON.parse(ws.sentMessages[1]); // 0 is hello
    assert.strictEqual(logMsg.type, "log");
    assert.strictEqual(logMsg.sessionId, "agent-1");
    assert.strictEqual(logMsg.payload.stream, "stdout");
    assert.strictEqual(logMsg.payload.message, "hello world");
  });

  it("should respond to ping literal with pong literal", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const logBuffer = new LogBuffer();
    transport = new WebSocketTransport({
      serverUrl: "http://localhost:3000",
      tokenProvider: async () => "abc",
      clientId: "client1",
      logBuffer,
      onControl: () => {},
      onAck: () => {},
    });

    const connectPromise = transport.connect();
    t.mock.timers.tick(15);
    await connectPromise;
    const ws = MockWebSocket.instances[0];
    
    if (ws.onmessage) {
      ws.onmessage({ data: "ping" });
    }

    assert.strictEqual(ws.sentMessages.includes("pong"), true);
  });
});