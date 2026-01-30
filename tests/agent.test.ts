import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findAgentsOnPath, resolveAgentBinary } from "../src/agent.js";

function makeExecutable(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\necho ok\n", "utf8");
  fs.chmodSync(file, 0o755);
  return file;
}

test("findAgentsOnPath discovers supported binaries", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ra-client-"));
  makeExecutable(tmp, "codex");
  makeExecutable(tmp, "claude");

  const originalPath = process.env.PATH;
  process.env.PATH = `${tmp}${path.delimiter}${originalPath ?? ""}`;

  const agents = findAgentsOnPath();
  const names = agents.map((agent) => agent.name);

  assert.ok(names.includes("codex"));
  assert.ok(names.includes("claude"));

  process.env.PATH = originalPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("resolveAgentBinary honors explicit path and name", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ra-client-"));
  const binary = makeExecutable(tmp, "gemini");

  const explicit = resolveAgentBinary(binary);
  assert.ok(explicit);
  assert.equal(explicit?.path, binary);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tmp}${path.delimiter}${originalPath ?? ""}`;

  const byName = resolveAgentBinary("gemini");
  assert.ok(byName);
  assert.equal(byName?.name, "gemini");

  process.env.PATH = originalPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});
