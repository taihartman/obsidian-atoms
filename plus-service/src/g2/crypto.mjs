import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decryptMirrorField } from "../mirror/crypto.mjs";

const ENCRYPTED_PREFIX = "g2e";
const PLAINTEXT_PREFIX = "g2p:";

function keyBytes(value) {
  const raw = String(value || "");
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

function aadBytes({ account, artifact, row }) {
  const parts = [account, artifact, row].map((value) => String(value || ""));
  if (parts.some((value) => !value || value.includes("\0"))) throw new Error("g2_encryption_aad_required");
  return Buffer.from(parts.join("\0"), "utf8");
}

function defaultKeys() {
  return {
    currentKey: process.env.G2_DATA_KEY_CURRENT || "",
    currentVersion: process.env.G2_DATA_KEY_CURRENT_VERSION || "k1",
    previousKey: process.env.G2_DATA_KEY_PREVIOUS || "",
    previousVersion: process.env.G2_DATA_KEY_PREVIOUS_VERSION || "",
  };
}

function production() {
  return [process.env.ATOMS_PLUS_ENV, process.env.NODE_ENV]
    .some((value) => ["prod", "production"].includes(String(value || "").toLowerCase()));
}

export function encryptG2Artifact(plaintext, aad, keys = defaultKeys()) {
  const key = keyBytes(keys.currentKey);
  const version = String(keys.currentVersion || "");
  if (!key || !/^[A-Za-z0-9._-]{1,32}$/.test(version)) {
    if (production()) throw new Error("G2_DATA_KEY_CURRENT required in production");
    return PLAINTEXT_PREFIX + String(plaintext ?? "");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadBytes(aad));
  const encrypted = Buffer.concat([cipher.update(String(plaintext ?? ""), "utf8"), cipher.final()]);
  return `${ENCRYPTED_PREFIX}:${version}:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

export function decryptG2Artifact(stored, aad, keys = defaultKeys()) {
  const value = String(stored ?? "");
  if (value.startsWith(PLAINTEXT_PREFIX)) {
    if (production()) throw new Error("g2_plaintext_forbidden");
    return value.slice(PLAINTEXT_PREFIX.length);
  }
  const match = /^g2e:([A-Za-z0-9._-]{1,32}):([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) throw new Error("g2_ciphertext_invalid");
  const candidates = [
    [String(keys.currentVersion || ""), keyBytes(keys.currentKey)],
    [String(keys.previousVersion || ""), keyBytes(keys.previousKey)],
  ];
  const key = candidates.find(([version, bytes]) => version === match[1] && bytes)?.[1];
  if (!key) throw new Error("g2_encryption_key_unavailable");
  const packed = Buffer.from(match[2], "base64url");
  if (packed.toString("base64url") !== match[2]) throw new Error("g2_ciphertext_invalid");
  if (packed.length < 28) throw new Error("g2_ciphertext_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
  decipher.setAAD(aadBytes(aad));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

/** Reads pre-U8 encrypted rows during additive rotation; plaintext remains forbidden in production. */
export function decryptG2ArtifactOrLegacy(stored, aad, keys = defaultKeys()) {
  const value = String(stored ?? "");
  if (value.startsWith("g2e:") || value.startsWith(PLAINTEXT_PREFIX)) return decryptG2Artifact(value, aad, keys);
  if (value.startsWith("plain:") && production()) throw new Error("g2_plaintext_forbidden");
  return decryptMirrorField(value);
}
