/**
 * Trip / list / project entity reinforce — link-if-exists only.
 * Never changes verdict or title. Exact vault title match (no contains).
 */

import type { ClassificationResult } from "../../shared/types";
import { isSoftEntityKey } from "../softKeys";
import { workTitleExistsInVault } from "./media";

/** High-precision packing / trip / list / project shape. Prefer under-match. */
export function isEntityShaped(captureText: string): boolean {
  const t = (captureText ?? "").trim();
  if (!t || t.length > 400) return false;
  if (/\bpack(?:ing)?\b/i.test(t)) return true;
  if (/\bpacking\s+list\b/i.test(t)) return true;
  if (/\bfor\s+(?:the\s+)?(?:trip|hike|camp(?:ing)?|yosemite|travel)\b/i.test(t))
    return true;
  if (/\btrip\s+to\b/i.test(t)) return true;
  if (/\b(?:project|ship|build|launch)\b/i.test(t) && t.length < 200) return true;
  if (/\blist\b/i.test(t) && /[,;]|\n\s*[-*]/.test(t)) return true;
  return false;
}

function hasLinkTo(result: ClassificationResult, note: string): boolean {
  const want = note.trim().toLowerCase();
  return (result.links ?? []).some((l) => l.note.trim().toLowerCase() === want);
}

/**
 * Exact case-insensitive match to a vault title; returns vault casing.
 * No contains-resolve (short tokens must not latch longer titles).
 */
export function exactVaultTitle(
  candidate: string,
  noteTitles: string[],
): string | null {
  const want = candidate.trim().toLowerCase();
  if (!want || want.length < 2) return null;
  const hit = noteTitles.find((t) => t.trim().toLowerCase() === want);
  return hit ? hit.trim() : null;
}

/**
 * Prefer longer vault titles that appear as substrings of the capture
 * (whole-word-ish), exact title match only against the vault list.
 */
export function findExactEntityTitlesInCapture(
  captureText: string,
  noteTitles: string[],
): string[] {
  const text = (captureText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: { title: string; len: number }[] = [];
  for (const raw of noteTitles) {
    const title = raw.trim();
    if (!title || title.length < 3) continue;
    if (isSoftEntityKey(title)) continue;
    const t = title.toLowerCase();
    if (!lower.includes(t)) continue;
    // Boundary-ish: not mid-word when single token
    const re = new RegExp(
      `(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
      "i",
    );
    if (!re.test(text)) continue;
    if (!workTitleExistsInVault(title, noteTitles)) continue;
    hits.push({ title, len: title.length });
  }
  hits.sort((a, b) => b.len - a.len);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    const k = h.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h.title);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Post-classify entity reinforce. Atom-only. Never changes verdict or title.
 */
export function enrichEntityLinks(
  captureText: string,
  result: ClassificationResult,
  noteTitles: string[] = [],
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  if (!isEntityShaped(captureText)) return result;

  const titles = findExactEntityTitlesInCapture(captureText, noteTitles);
  if (!titles.length) return result;

  let links = [...(result.links ?? [])];
  let changed = false;
  for (const title of titles) {
    if (isSoftEntityKey(title)) continue;
    if (hasLinkTo({ ...result, links }, title)) continue;
    links = [
      ...links,
      {
        note: title,
        reason: `belongs with [[${title}]]`,
      },
    ];
    changed = true;
  }
  if (!changed) return result;
  return { ...result, links };
}
