import { safeStorage } from "electron";
import { logger } from "./logger";

const PLAIN_PREFIX = "plain:";

export function encryptSecret(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return "enc:" + safeStorage.encryptString(plain).toString("base64");
    }
  } catch (err) {
    logger.warn("secureKeys", `safeStorage encrypt failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return PLAIN_PREFIX + plain;
}

export function decryptSecret(stored: string): string {
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
  if (!stored.startsWith("enc:")) return stored;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
    }
  } catch (err) {
    logger.warn("secureKeys", `safeStorage decrypt failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return "";
}

export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "••••";
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
