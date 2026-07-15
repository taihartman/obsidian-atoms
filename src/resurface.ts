/**
 * Pure helpers for zero-guilt resurfacing (Phase 1: on-this-day stream).
 */

import {
  bodyAfterFrontmatter,
  isGeneratedAtomContent,
  isUnderAtomFolder,
  titleFromAtomPath,
  extractSourceDay,
} from "./atomsHomeData";

export type ResurfaceCue = "on-this-day";

export type ResurfaceCandidate = {
  path: string;
  title: string;
  bodySnippet: string;
  /** YYYY-MM-DD used for the on-this-day match */
  matchDate: string;
  cue: ResurfaceCue;
};

const CREATED_RE = /^created:\s*["']?(\d{4}-\d{2}-\d{2})/m;

/** Local calendar date YYYY-MM-DD. */
export function calendarDateToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** MM-DD from YYYY-MM-DD (or null if not a plain date prefix). */
export function monthDayKey(ymd: string): string | null {
  const m = (ymd ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[2]}-${m[3]}`;
}

/** `created:` frontmatter day (date part only). */
export function extractCreatedDay(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(CREATED_RE);
  return m?.[1] ?? null;
}

/**
 * Prefer source daily date; fall back to created.
 * Returns YYYY-MM-DD or null.
 */
export function atomMemoryDay(content: string): string | null {
  const source = extractSourceDay(content);
  if (source && /^\d{4}-\d{2}-\d{2}/.test(source)) {
    return source.slice(0, 10);
  }
  return extractCreatedDay(content);
}

/**
 * True when atom's memory day shares MM-DD with today but is not today
 * (anniversary / prior year, or earlier same year is ok as long as full date differs).
 */
export function isOnThisDayMatch(
  atomDay: string,
  todayYmd: string,
): boolean {
  const a = monthDayKey(atomDay);
  const t = monthDayKey(todayYmd);
  if (!a || !t) return false;
  if (a !== t) return false;
  // Exclude atoms from "today" itself
  return atomDay.slice(0, 10) !== todayYmd.slice(0, 10);
}

/** First meaningful body line, single-line, truncated. */
export function bodySnippet(body: string, max = 140): string {
  const lines = (body ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const one = (lines[0] ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "…";
  if (one.length <= max) return one;
  return one.slice(0, max - 1) + "…";
}

export function candidateFromAtomFile(
  path: string,
  content: string,
  todayYmd: string,
  atomFolder: string,
): ResurfaceCandidate | null {
  if (!path.toLowerCase().endsWith(".md")) return null;
  if (!isUnderAtomFolder(path, atomFolder)) return null;
  if (!isGeneratedAtomContent(content)) return null;
  const day = atomMemoryDay(content);
  if (!day || !isOnThisDayMatch(day, todayYmd)) return null;
  const body = bodyAfterFrontmatter(content);
  const snip = bodySnippet(body);
  if (snip === "…") return null;
  return {
    path,
    title: titleFromAtomPath(path),
    bodySnippet: snip,
    matchDate: day.slice(0, 10),
    cue: "on-this-day",
  };
}

export function listOnThisDayCandidates(
  files: Array<{ path: string; content: string }>,
  todayYmd: string,
  atomFolder: string,
): ResurfaceCandidate[] {
  const out: ResurfaceCandidate[] = [];
  for (const f of files) {
    const c = candidateFromAtomFile(f.path, f.content, todayYmd, atomFolder);
    if (c) out.push(c);
  }
  // Stable-ish: older matchDate first (deeper past), then title
  out.sort(
    (a, b) =>
      a.matchDate.localeCompare(b.matchDate) || a.title.localeCompare(b.title),
  );
  return out;
}

/** First candidate not in skipPaths. */
export function pickResurface(
  candidates: ResurfaceCandidate[],
  skipPaths: Iterable<string> = [],
): ResurfaceCandidate | null {
  const skip = new Set(skipPaths);
  for (const c of candidates) {
    if (!skip.has(c.path)) return c;
  }
  return null;
}

export function cueLabel(cue: ResurfaceCue): string {
  if (cue === "on-this-day") return "On this day";
  return "From the brain";
}
