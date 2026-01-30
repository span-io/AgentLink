import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ra-client-config-"));
process.env.REMOTE_AGENT_CLIENT_HOME = tmpHome;

// Import after env override so config picks up the temp home.
const { loadConfig, saveConfig } = await import("../src/config.js");

test("config saves and loads client id", () => {
  const config = loadConfig();
  assert.ok(config.clientId);

  config.serverUrl = "https://example.test";
  saveConfig(config);

  const loaded = loadConfig();
  assert.equal(loaded.clientId, config.clientId);
  assert.equal(loaded.serverUrl, "https://example.test");
});

test("config file exists after save", () => {
  const config = loadConfig();
  saveConfig(config);

  const configFile = path.join(tmpHome, "config.json");
  assert.ok(fs.existsSync(configFile));
});

process.on("exit", () => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
