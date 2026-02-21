import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  RemoteCommandRunner,
  normalizeRemoteCommandPayload,
} from "../src/remote-command.js";

test("normalizeRemoteCommandPayload rejects missing requestId", () => {
  const result = normalizeRemoteCommandPayload(
    {
      command: "pwd",
      args: [],
      workingDirectory: "/tmp",
    },
    new Set(["pwd"]),
  );

  assert.equal(result.ok, false);
});

test("RemoteCommandRunner emits started and completed for successful command", async () => {
  const events: Array<{ requestId: string; status: string; details?: unknown }> = [];

  const runner = new RemoteCommandRunner(
    {
      spawnFn: () => {
        const child = new EventEmitter() as unknown as {
          stdout: EventEmitter;
          stderr: EventEmitter;
          on: (event: string, listener: (...args: unknown[]) => void) => void;
          kill: (_signal: string) => void;
        };

        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        (child.stdout as any).setEncoding = () => undefined;
        (child.stderr as any).setEncoding = () => undefined;
        child.kill = () => undefined;

        queueMicrotask(() => {
          child.stdout.emit("data", "ok\n");
          (child as unknown as EventEmitter).emit("exit", 0, null);
        });

        return child as any;
      },
    },
    { commandAllowlist: new Set(["pwd"]) },
  );

  await runner.run(
    {
      requestId: "req-1",
      command: "pwd",
      args: [],
      workingDirectory: "/tmp",
    },
    {
      sendCommand: (requestId, status, details) => {
        events.push({ requestId, status, details });
      },
    },
  );

  assert.equal(events.length, 2);
  assert.equal(events[0]?.status, "started");
  assert.equal(events[1]?.status, "completed");
  assert.equal((events[1]?.details as { stdout?: string })?.stdout, "ok\n");
});

test("RemoteCommandRunner emits error for disallowed command", async () => {
  const events: Array<{ requestId: string; status: string; details?: { message?: string } }> = [];

  const runner = new RemoteCommandRunner({}, { commandAllowlist: new Set(["pwd"]) });

  await runner.run(
    {
      requestId: "req-2",
      command: "rm",
      args: ["-rf", "/"],
      workingDirectory: "/tmp",
    },
    {
      sendCommand: (requestId, status, details) => {
        events.push({ requestId, status, details });
      },
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, "error");
  assert.match(events[0]?.details?.message ?? "", /not allowed/i);
});
