/**
 * Per-capture Preview cache (U4 / R14b).
 * Key = hash(captureText + modelId + qualityStamp). Free re-open; re-classify only on miss.
 */

import type { ClassificationResult } from "../shared/types";

export type PreviewCacheEntry = {
  key: string;
  result: ClassificationResult;
  storedAt: number;
};

export type PreviewCacheStore = {
  version: 1;
  entries: PreviewCacheEntry[];
};

export const LS_PREVIEW_CACHE = "atoms-preview-cache-v1";
export const PREVIEW_CACHE_MAX = 200;

/** FNV-1a 32-bit hex — small, sync, good enough for cache keys. */
export function fingerprintPreviewKey(
  captureText: string,
  modelId: string,
  qualityStamp: string | number,
): string {
  const input = `${qualityStamp}\n${modelId}\n${captureText}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function emptyPreviewCache(): PreviewCacheStore {
  return { version: 1, entries: [] };
}

export function parsePreviewCache(raw: unknown): PreviewCacheStore {
  if (!raw) return emptyPreviewCache();
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return emptyPreviewCache();
    }
  }
  if (!obj || typeof obj !== "object") return emptyPreviewCache();
  const o = obj as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.entries)) return emptyPreviewCache();
  const entries: PreviewCacheEntry[] = [];
  for (const e of o.entries) {
    if (!e || typeof e !== "object") continue;
    const row = e as Record<string, unknown>;
    if (typeof row.key !== "string" || !row.result || typeof row.result !== "object")
      continue;
    const result = row.result as ClassificationResult;
    if (!result.verdict) continue;
    entries.push({
      key: row.key,
      result,
      storedAt: typeof row.storedAt === "number" ? row.storedAt : 0,
    });
  }
  return { version: 1, entries };
}

export function lookupPreviewCache(
  store: PreviewCacheStore,
  key: string,
): ClassificationResult | null {
  const hit = store.entries.find((e) => e.key === key);
  return hit ? hit.result : null;
}

export function putPreviewCache(
  store: PreviewCacheStore,
  key: string,
  result: ClassificationResult,
  now = Date.now(),
): PreviewCacheStore {
  const rest = store.entries.filter((e) => e.key !== key);
  const next = [{ key, result, storedAt: now }, ...rest].slice(
    0,
    PREVIEW_CACHE_MAX,
  );
  return { version: 1, entries: next };
}

export function serializePreviewCache(store: PreviewCacheStore): string {
  return JSON.stringify(store);
}
