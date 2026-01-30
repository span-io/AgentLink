import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR =
  process.env.REMOTE_AGENT_CLIENT_HOME ??
  path.join(os.homedir(), ".remote-agent-client");

const KEY_FILE = path.join(CONFIG_DIR, "master.key");

function getMasterKey(): Buffer {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE);
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key);
  try {
    fs.chmodSync(KEY_FILE, 0o600);
  } catch (error) {
    console.warn("Failed to set secure permissions on master key:", error);
  }
  return key;
}

export function encrypt(text: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(text: string): string {
  const parts = text.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
