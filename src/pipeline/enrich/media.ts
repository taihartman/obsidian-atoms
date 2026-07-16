/**
 * Media / watchlist post-classify repair.
 * High-precision patterns only — model still owns judgment; we fill shape.
 * Never changes verdict or title (same contract as enrichPersonLinks).
 */

import type { ClassificationResult } from "../../shared/types";
import { normalizeTag, sortTags } from "../vocabulary";

/** Detect obvious watch/read media dumps. */
export function isMediaShaped(captureText: string): boolean {
  const t = (captureText ?? "").trim();
  if (!t) return false;
  // watch / watching / rewatch / to watch
  if (/\b(?:re)?watch(?:ing)?\b/i.test(t)) return true;
  if (/\b(?:movie|anime|show|series|film)\b\s*:/i.test(t)) return true;
  if (/\b(?:movie|anime|series|film)\b/i.test(t) && t.length < 120) return true;
  if (/\b(?:told me to watch|recommended(?:\s+watching)?|should watch)\b/i.test(t))
    return true;
  return false;
}

/**
 * Extract a work title from common dump patterns.
 * Returns null when no clear named work.
 */
export function extractWorkTitle(captureText: string): string | null {
  const t = (captureText ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const patterns: RegExp[] = [
    /\b(?:told me to|asked me to|wants me to)\s+watch\s+(.+)$/i,
    /\brecommended(?:\s+watching)?\s+(.+)$/i,
    /\bshould watch\s+(.+)$/i,
    /\b(?:re)?watch(?:ing)?\s+(.+)$/i,
    /\b(?:movie|anime|show|series|film)\s*:\s*(.+)$/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const raw = cleanWorkTitle(m[1]);
    if (raw && raw.length >= 2) return titleCaseWork(raw);
  }
  return null;
}

function cleanWorkTitle(raw: string): string {
  return raw
    .replace(/[.!?]+$/g, "")
    .replace(/\s+after\s+.+$/i, "")
    .replace(/\s+on\s+(netflix|hulu|crunchyroll|max|disney\+?).*$/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

/** Light title-case for multi-word works; keep short all-lowercase anime titles readable. */
export function titleCaseWork(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length) return s;
  // If already has capitals mid-string, keep as-is
  if (/[A-Z]/.test(s.slice(1))) return s;
  const small = new Set(["a", "an", "the", "of", "and", "or", "to", "in", "on"]);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Prefer an existing vault note title with the same spelling (case-insensitive). */
export function resolveWorkTitleAgainstVault(
  workTitle: string,
  noteTitles: string[],
): string {
  const want = workTitle.trim().toLowerCase();
  if (!want) return workTitle;
  const exact = noteTitles.find((t) => t.trim().toLowerCase() === want);
  if (exact) return exact.trim();
  // Contains either way (short lists)
  const contains = noteTitles.find((t) => {
    const n = t.trim().toLowerCase();
    return n.includes(want) || want.includes(n);
  });
  if (contains && contains.trim().length >= 2) return contains.trim();
  return workTitle;
}

function hasLinkTo(result: ClassificationResult, note: string): boolean {
  const want = note.trim().toLowerCase();
  return (result.links ?? []).some((l) => l.note.trim().toLowerCase() === want);
}

function mediaTagsFor(captureText: string, workTitle: string | null): string[] {
  const tags = new Set<string>(["watch", "media"]);
  const t = captureText.toLowerCase();
  if (/\bmovie\b|\bfilm\b/.test(t)) tags.add("movie");
  else if (/\banime\b|\bshow\b|\bseries\b|hero academia|season\b/.test(t))
    tags.add("show");
  else if (workTitle) tags.add("show"); // default named watch → show
  return [...tags];
}

/** True when `title` matches an existing vault note title (case-insensitive). */
export function workTitleExistsInVault(
  title: string,
  noteTitles: string[],
): boolean {
  const want = title.trim().toLowerCase();
  if (!want) return false;
  return noteTitles.some((t) => t.trim().toLowerCase() === want);
}

/**
 * Post-classify media repair. Atom-only. Never changes verdict or title.
 * Work-title links only when the vault already has that note (no empty stubs).
 */
export function enrichMediaLinks(
  captureText: string,
  result: ClassificationResult,
  noteTitles: string[] = [],
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  if (!isMediaShaped(captureText)) return result;

  let tags = [...(result.tags ?? [])];
  let links = [...(result.links ?? [])];
  let changed = false;

  const workRaw = extractWorkTitle(captureText);
  const work = workRaw
    ? resolveWorkTitleAgainstVault(workRaw, noteTitles)
    : null;
  const workInVault =
    work != null && workTitleExistsInVault(work, noteTitles) ? work : null;

  for (const t of mediaTagsFor(captureText, work)) {
    if (!tags.some((x) => normalizeTag(x) === t)) {
      tags.push(t);
      changed = true;
    }
  }
  tags = sortTags(tags);

  // Drop model-added unresolved work links (same policy as repair).
  const beforeDrop = links.length;
  links = links.filter((l) => {
    const n = (l.note ?? "").trim();
    if (!n) return false;
    // Keep non-work-ish links; drop notes that look like the extracted work but missing from vault
    if (work && n.toLowerCase() === work.toLowerCase() && !workInVault) {
      return false;
    }
    return true;
  });
  if (links.length !== beforeDrop) changed = true;

  if (workInVault && !hasLinkTo({ ...result, links }, workInVault)) {
    links = [
      ...links,
      {
        note: workInVault,
        reason: `watchlist: ${workInVault} already in the vault`,
      },
    ];
    changed = true;
  }

  if (!changed) return result;
  return { ...result, tags, links };
}
