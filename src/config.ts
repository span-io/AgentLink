import fs from "fs";
import os from "os";
import path from "path";
import { encrypt, decrypt } from "./crypto-utils.js";

export type ClientConfig = {
  clientId: string;
  serverUrl?: string;
  refreshToken?: string;
  agentBinary?: string;
  // stored on disk only
  encryptedRefreshToken?: string;
};

const CONFIG_DIR =
  process.env.REMOTE_AGENT_CLIENT_HOME ??
  path.join(os.homedir(), ".remote-agent-client");

const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function newClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `client-${Date.now().toString(36)}`;
}

export function loadConfig(): ClientConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const config = JSON.parse(raw) as ClientConfig;
    
    if (config.encryptedRefreshToken && !config.refreshToken) {
      try {
        config.refreshToken = decrypt(config.encryptedRefreshToken);
      } catch (err) {
        console.warn("Failed to decrypt refresh token:", err);
      }
    }
    
    return config;
  } catch {
    return { clientId: newClientId() };
  }
}

export function saveConfig(config: ClientConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  
  const toSave = { ...config };
  if (toSave.refreshToken) {
    try {
      toSave.encryptedRefreshToken = encrypt(toSave.refreshToken);
      delete toSave.refreshToken;
    } catch (err) {
      console.warn("Failed to encrypt refresh token:", err);
    }
  }
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), "utf8");
}
