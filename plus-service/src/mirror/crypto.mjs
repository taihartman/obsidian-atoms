/**
 * App-level AES-256-GCM for atom mirror bodies (KTD10b).
 * Key: ATOMS_ASK_MIRROR_KEY = 64 hex chars (32 bytes) or any string (scrypt-derived).
 * Without key: plaintext with "plain:" prefix (tests / local only).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

const PREFIX_V1 = "v1:";
const PREFIX_PLAIN = "plain:";

function resolveKey() {
  const raw = process.env.ATOMS_ASK_MIRROR_KEY || "";
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return scryptSync(raw, "atoms-ask-mirror-v1", 32);
}

/**
 * @param {string} plaintext
 * @returns {string}
 */
export function encryptMirrorField(plaintext) {
  const text = plaintext ?? "";
  const key = resolveKey();
  if (!key) return PREFIX_PLAIN + text;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX_V1 +
    Buffer.concat([iv, tag, enc]).toString("base64url")
  );
}

/**
 * @param {string} stored
 * @returns {string}
 */
export function decryptMirrorField(stored) {
  if (stored == null || stored === "") return "";
  if (stored.startsWith(PREFIX_PLAIN)) return stored.slice(PREFIX_PLAIN.length);
  if (!stored.startsWith(PREFIX_V1)) return stored;
  const key = resolveKey();
  if (!key) {
    throw new Error("ATOMS_ASK_MIRROR_KEY required to decrypt mirror field");
  }
  const buf = Buffer.from(stored.slice(PREFIX_V1.length), "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Stable content hash over plaintext fields (skip if unchanged). */
export function contentHash(parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(String(p ?? ""), "utf8");
  h.update("\0");
  return h.digest("hex");
}
