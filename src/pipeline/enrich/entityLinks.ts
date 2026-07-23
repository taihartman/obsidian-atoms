/**
 * Trip / list / project entity reinforce — link-if-exists only.
 * Never changes verdict or title. Exact vault title match (no contains).
 * Also rescues packing/trip list dumps from noise → atom.
 */

import type { ClassificationResult } from "../../shared/types";
import { shortTitleFromCapture } from "./ideaRescue";
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
  if (/\blist\b/i.test(t) && /[,;]|\n\s*[-*]|\b\d+[.)]/.test(t)) return true;
  if (isKeepableListDump(t)) return true;
  return false;
}

/**
 * Numbered / multi-item checklists the user would want back (docs, errands with
 * several parts) — not one-line "buy milk".
 */
export function isKeepableListDump(captureText: string): boolean {
  const t = (captureText ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 24 || t.length > 600) return false;
  // Numbered checklist: 1. … 2. …
  if (/\b1[.)]\s+\S/.test(t) && /\b2[.)]\s+\S/.test(t)) return true;
  // Topic + several comma items (documents, need, bring, checklist, …)
  const commas = (t.match(/,/g) ?? []).length;
  if (
    commas >= 2 &&
    t.length >= 36 &&
    /\b(documents?|docs|checklist|need|bring|pack|items?|papers?|id\b|receipt|paypal|passport)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Suggest hub title when user has not created one yet.
 * e.g. "pack X for Yosemite packing" → "Yosemite packing"
 */
export function suggestEntityHubLabel(text: string): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  let m = t.match(/\bfor\s+([A-Za-z][\w' -]{1,40}?)\s+packing\b/i);
  if (m?.[1]) {
    const core = m[1].trim();
    if (core.length >= 2 && !isSoftEntityKey(core)) {
      return `${titleCaseWords(core)} packing`;
    }
  }

  m = t.match(/\b([A-Za-z][\w' -]{2,30}?)\s+packing\b/i);
  if (m?.[1]) {
    const core = m[1].trim();
    if (
      !/^(my|the|a|an|our|this|their|some)$/i.test(core) &&
      !isSoftEntityKey(core) &&
      !isSoftEntityKey(`${core} packing`)
    ) {
      return `${titleCaseWords(core)} packing`;
    }
  }

  m = t.match(
    /\b(?:for|on)\s+(?:the\s+)?([A-Za-z][\w' -]{2,30}?)\s+trip\b/i,
  );
  if (m?.[1]) {
    const core = m[1].trim();
    if (
      !/^(the|a|an|this|our|my|camping|road)$/i.test(core) &&
      !isSoftEntityKey(core)
    ) {
      return `${titleCaseWords(core)} packing`;
    }
  }

  return null;
}

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Soft-rescue packing/trip/document list dumps the model marks noise.
 * Prefer atom so invite + Also about can fire.
 */
export function rescueEntityListCapture(
  captureText: string,
  result: ClassificationResult,
): ClassificationResult {
  if (result.verdict === "atom") return result;
  if (result.verdict !== "task" && result.verdict !== "noise") return result;
  const t = captureText.trim();
  if (t.length < 12) return result;
  const keepableList = isKeepableListDump(t);
  if (!isEntityShaped(captureText) && !keepableList) return result;
  if (
    !keepableList &&
    !/\bpack/i.test(t) &&
    !/\btrip\b/i.test(t) &&
    !/\blist\b/i.test(t)
  ) {
    return result;
  }

  const title = shortTitleFromCapture(captureText);
  const tags = [...(result.tags ?? [])];
  if (!tags.some((x) => x.toLowerCase() === "list")) tags.push("list");

  return {
    ...result,
    verdict: "atom",
    title,
    tags,
    links: [...(result.links ?? [])],
  };
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
  // Rescue packing dumps before link reinforce
  let r = rescueEntityListCapture(captureText, result);
  if (r.verdict !== "atom") return r;
  if (!isEntityShaped(captureText)) return r;

  const titles = findExactEntityTitlesInCapture(captureText, noteTitles);
  // Also try suggested hub label if it already exists as a vault title
  const suggested = suggestEntityHubLabel(captureText);
  if (suggested && workTitleExistsInVault(suggested, noteTitles)) {
    const exact = exactVaultTitle(suggested, noteTitles);
    if (exact && !titles.some((t) => t.toLowerCase() === exact.toLowerCase())) {
      titles.push(exact);
    }
  }
  if (!titles.length) return r;

  let links = [...(r.links ?? [])];
  let changed = false;
  for (const title of titles) {
    if (isSoftEntityKey(title)) continue;
    if (hasLinkTo({ ...r, links }, title)) continue;
    links = [
      ...links,
      {
        note: title,
        reason: `belongs with [[${title}]]`,
      },
    ];
    changed = true;
  }
  if (!changed) return r;
  return { ...r, links };
}
