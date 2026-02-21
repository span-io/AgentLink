import { describe, it } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import {
  BootstrapRunner,
  normalizeBootstrapPayload,
  parseCsvList,
  sanitizeBootstrapEnv,
} from "../src/bootstrap.js";

class MockStream extends EventEmitter {
  setEncoding(_encoding: string): void {
    return;
  }
}

class MockChild extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.emit("exit", null, "SIGKILL");
    return true;
  }
}

describe("bootstrap helpers", () => {
  it("rejects commands outside allowlist", () => {
    const result = normalizeBootstrapPayload(
      {
        runId: "run-1",
        workingDirectory: "/tmp/project",
        command: "bash",
      },
      new Set(["npx"]),
      new Set(["CI"]),
    );

    assert.strictEqual(result.ok, false);
    if (result.ok) {
      assert.fail("expected normalization failure");
    }
    assert.match(result.error, /not allowed/i);
  });

  it("sanitizes env to allowlisted keys", () => {
    const env = sanitizeBootstrapEnv(
      {
        CI: "1",
        OPENAI_API_KEY: "secret",
        NODE_ENV: " production ",
      },
      new Set(["CI", "NODE_ENV"]),
    );

    assert.deepStrictEqual(env, {
      CI: "1",
      NODE_ENV: "production",
    });
  });

  it("parses csv lists with fallback", () => {
    assert.deepStrictEqual(
      Array.from(parseCsvList("npx,npm", ["npx"])).sort(),
      ["npm", "npx"],
    );
    assert.deepStrictEqual(Array.from(parseCsvList("", ["npx"])), ["npx"]);
  });
});

describe("BootstrapRunner", () => {
  it("prevents concurrent bootstrap runs", async () => {
    const events: Array<{ runId: string; status: string; message?: string }> = [];
    const transport = {
      sendBootstrap(runId: string, status: string, message?: string) {
        events.push({ runId, status, message });
      },
    };

    const firstChild = new MockChild();
    const runner = new BootstrapRunner(
      {
        mkdirFn: async () => {
          return;
        },
        spawnFn: () => firstChild as any,
      },
      {
        commandAllowlist: new Set(["npx"]),
        envAllowlist: new Set(["CI"]),
      },
    );

    const firstRun = runner.run(
      {
        runId: "run-1",
        workingDirectory: "/tmp/project",
        command: "npx",
        args: ["-y", "create-next-app@latest"],
      },
      transport,
    );

    await Promise.resolve();

    await runner.run(
      {
        runId: "run-2",
        workingDirectory: "/tmp/project",
        command: "npx",
      },
      transport,
    );

    firstChild.emit("exit", 0, null);
    await firstRun;

    const blocked = events.find((event) => event.runId === "run-2" && event.status === "error");
    assert.ok(blocked);
    assert.match(blocked?.message ?? "", /already running/i);
  });

  it("emits started and complete for successful run", async () => {
    const events: Array<{ runId: string; status: string; message?: string }> = [];
    const transport = {
      sendBootstrap(runId: string, status: string, message?: string) {
        events.push({ runId, status, message });
      },
    };

    const runner = new BootstrapRunner(
      {
        mkdirFn: async () => {
          return;
        },
        spawnFn: () => {
          const child = new MockChild();
          setImmediate(() => {
            child.stdout.emit("data", "booting\n");
            child.emit("exit", 0, null);
          });
          return child as any;
        },
      },
      {
        commandAllowlist: new Set(["npx"]),
        envAllowlist: new Set(["CI"]),
      },
    );

    await runner.run(
      {
        runId: "run-3",
        workingDirectory: "/tmp/project",
        command: "npx",
      },
      transport,
    );

    assert.ok(events.some((event) => event.runId === "run-3" && event.status === "started"));
    assert.ok(events.some((event) => event.runId === "run-3" && event.status === "log"));
    assert.ok(events.some((event) => event.runId === "run-3" && event.status === "complete"));
  });
});
