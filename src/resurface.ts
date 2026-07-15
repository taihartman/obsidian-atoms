/**
 * Zero-guilt resurfacing stream — multi-cue recall for the second brain.
 *
 * Cues (priority):
 * 1. on-this-day — calendar / episodic
 * 2. connected  — associative (shared links with recent atoms)
 * 3. quiet      — spacing (older / less recently touched)
 */

import {
  bodyAfterFrontmatter,
  extractLinkChips,
  extractSourceDay,
  isGeneratedAtomContent,
  isUnderAtomFolder,
  titleFromAtomPath,
} from "./atomsHomeData";

export type ResurfaceCue = "on-this-day" | "connected" | "quiet";

export type ResurfaceCandidate = {
  path: string;
  title: string;
  bodySnippet: string;
  /** YYYY-MM-DD memory day when known */
  matchDate: string;
  cue: ResurfaceCue;
  mtime?: number;
};

export type AtomFileForResurface = {
  path: string;
  content: string;
  mtime?: number;
};

/** Device-local throttle map: path → lastShown epoch ms */
export type ResurfaceThrottleMap = Record<string, number>;

export const RESURFACE_THROTTLE_DAYS = 7;
export const LS_RESURFACE_THROTTLE = "atoms-resurface-throttle-v1";

const CREATED_RE = /^created:\s*["']?(\d{4}-\d{2}-\d{2})/m;
const MS_DAY = 24 * 60 * 60 * 1000;

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
 * True when atom's memory day shares MM-DD with today but is not today.
 */
export function isOnThisDayMatch(
  atomDay: string,
  todayYmd: string,
): boolean {
  const a = monthDayKey(atomDay);
  const t = monthDayKey(todayYmd);
  if (!a || !t) return false;
  if (a !== t) return false;
  return atomDay.slice(0, 10) !== todayYmd.slice(0, 10);
}

/** First meaningful body line, single-line, truncated. */
export function bodySnippet(body: string, max = 140): string {
  const lines = (body ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  // Skip pure link-prose trailing paragraphs if first line empty — already handled
  const one = (lines[0] ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "…";
  if (one.length <= max) return one;
  return one.slice(0, max - 1) + "…";
}

export type IndexedAtom = {
  path: string;
  title: string;
  bodySnippet: string;
  matchDate: string;
  mtime: number;
  linkChips: string[];
  content: string;
};

export function indexAtomFile(
  path: string,
  content: string,
  atomFolder: string,
  mtime = 0,
): IndexedAtom | null {
  if (!path.toLowerCase().endsWith(".md")) return null;
  if (!isUnderAtomFolder(path, atomFolder)) return null;
  if (!isGeneratedAtomContent(content)) return null;
  const title = titleFromAtomPath(path);
  const body = bodyAfterFrontmatter(content);
  const snip = bodySnippet(body);
  if (snip === "…") return null;
  const day = atomMemoryDay(content) ?? "";
  return {
    path,
    title,
    bodySnippet: snip,
    matchDate: day,
    mtime,
    linkChips: extractLinkChips(body, title),
    content,
  };
}

export function candidateFromAtomFile(
  path: string,
  content: string,
  todayYmd: string,
  atomFolder: string,
): ResurfaceCandidate | null {
  const idx = indexAtomFile(path, content, atomFolder);
  if (!idx) return null;
  if (!idx.matchDate || !isOnThisDayMatch(idx.matchDate, todayYmd)) return null;
  return {
    path: idx.path,
    title: idx.title,
    bodySnippet: idx.bodySnippet,
    matchDate: idx.matchDate,
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
  out.sort(
    (a, b) =>
      a.matchDate.localeCompare(b.matchDate) || a.title.localeCompare(b.title),
  );
  return out;
}

/**
 * Recent seeds: freshest atoms by mtime. Keep the set small so other atoms
 * can still match as "connected" (associative cue).
 */
export function recentSeedPaths(
  indexed: IndexedAtom[],
  n = 3,
): Set<string> {
  if (indexed.length <= 1) return new Set();
  const sorted = [...indexed].sort((a, b) => b.mtime - a.mtime);
  // Prefer a thin seed set: at most n, and leave ≥2 non-seeds when possible
  const maxSeeds =
    indexed.length <= 4 ? 1 : Math.min(n, indexed.length - 2);
  const take = Math.max(1, maxSeeds);
  return new Set(sorted.slice(0, take).map((a) => a.path));
}

/**
 * Associative cue: shares a link chip with a recent seed, or chip matches a seed title.
 */
export function listConnectedCandidates(
  indexed: IndexedAtom[],
  seedPaths: Set<string>,
): ResurfaceCandidate[] {
  if (!seedPaths.size) return [];
  const seeds = indexed.filter((a) => seedPaths.has(a.path));
  const seedTitles = new Set(seeds.map((s) => s.title.toLowerCase()));
  const seedChips = new Set(
    seeds.flatMap((s) => s.linkChips.map((c) => c.toLowerCase())),
  );

  const out: ResurfaceCandidate[] = [];
  for (const a of indexed) {
    if (seedPaths.has(a.path)) continue;
    const chips = a.linkChips.map((c) => c.toLowerCase());
    const titleL = a.title.toLowerCase();
    const hit =
      chips.some((c) => seedChips.has(c) || seedTitles.has(c)) ||
      [...seedChips].some((c) => c === titleL) ||
      seeds.some((s) =>
        s.linkChips.some((c) => c.toLowerCase() === titleL),
      );
    if (!hit) continue;
    out.push({
      path: a.path,
      title: a.title,
      bodySnippet: a.bodySnippet,
      matchDate: a.matchDate || "",
      cue: "connected",
      mtime: a.mtime,
    });
  }
  out.sort(
    (a, b) =>
      (b.mtime ?? 0) - (a.mtime ?? 0) || a.title.localeCompare(b.title),
  );
  return out;
}

/**
 * Spacing cue: older mtime first among non-recent seeds.
 * Prefer atoms with memory day older than `minAgeDays` when dated.
 */
export function listQuietCandidates(
  indexed: IndexedAtom[],
  opts?: { now?: number; minAgeDays?: number; recentSeedPaths?: Set<string> },
): ResurfaceCandidate[] {
  const now = opts?.now ?? Date.now();
  const minAgeDays = opts?.minAgeDays ?? 14;
  const recent = opts?.recentSeedPaths ?? new Set<string>();
  const cutoff = now - minAgeDays * MS_DAY;

  const out: ResurfaceCandidate[] = [];
  for (const a of indexed) {
    if (recent.has(a.path)) continue;
    // Prefer aged mtime; still allow undated old files
    if (a.mtime > 0 && a.mtime > cutoff) continue;
    out.push({
      path: a.path,
      title: a.title,
      bodySnippet: a.bodySnippet,
      matchDate: a.matchDate || "",
      cue: "quiet",
      mtime: a.mtime,
    });
  }
  out.sort(
    (a, b) =>
      (a.mtime ?? 0) - (b.mtime ?? 0) || a.title.localeCompare(b.title),
  );
  return out;
}

/**
 * Full stream pool in priority order (on-this-day → connected → quiet), de-duped by path.
 */
export function listResurfaceCandidates(
  files: AtomFileForResurface[],
  todayYmd: string,
  atomFolder: string,
  opts?: { now?: number },
): ResurfaceCandidate[] {
  const indexed: IndexedAtom[] = [];
  for (const f of files) {
    const idx = indexAtomFile(f.path, f.content, atomFolder, f.mtime ?? 0);
    if (idx) indexed.push(idx);
  }

  const onThisDay = listOnThisDayCandidates(files, todayYmd, atomFolder);
  const seeds = recentSeedPaths(indexed, 5);
  const connected = listConnectedCandidates(indexed, seeds);
  const quiet = listQuietCandidates(indexed, {
    now: opts?.now,
    recentSeedPaths: seeds,
  });

  const seen = new Set<string>();
  const out: ResurfaceCandidate[] = [];
  for (const c of [...onThisDay, ...connected, ...quiet]) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    out.push(c);
  }
  return out;
}

/** First candidate not in skipPaths and not throttled. */
export function pickResurface(
  candidates: ResurfaceCandidate[],
  skipPaths: Iterable<string> = [],
  throttle: ResurfaceThrottleMap = {},
  now: number = Date.now(),
  throttleDays: number = RESURFACE_THROTTLE_DAYS,
): ResurfaceCandidate | null {
  const skip = new Set(skipPaths);
  for (const c of candidates) {
    if (skip.has(c.path)) continue;
    if (isThrottled(c.path, throttle, now, throttleDays)) continue;
    return c;
  }
  return null;
}

export function isThrottled(
  path: string,
  throttle: ResurfaceThrottleMap,
  now: number = Date.now(),
  days: number = RESURFACE_THROTTLE_DAYS,
): boolean {
  const t = throttle[path];
  if (t == null) return false;
  return now - t < days * MS_DAY;
}

export function markResurfaceShown(
  path: string,
  throttle: ResurfaceThrottleMap,
  now: number = Date.now(),
): ResurfaceThrottleMap {
  return { ...throttle, [path]: now };
}

/** Drop entries older than keepDays. */
export function pruneThrottle(
  throttle: ResurfaceThrottleMap,
  now: number = Date.now(),
  keepDays = 60,
): ResurfaceThrottleMap {
  const cutoff = now - keepDays * MS_DAY;
  const next: ResurfaceThrottleMap = {};
  for (const [k, v] of Object.entries(throttle)) {
    if (v >= cutoff) next[k] = v;
  }
  return next;
}

export function parseThrottleJson(raw: string | null | undefined): ResurfaceThrottleMap {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: ResurfaceThrottleMap = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeThrottle(map: ResurfaceThrottleMap): string {
  return JSON.stringify(map);
}

export function cueLabel(cue: ResurfaceCue): string {
  if (cue === "on-this-day") return "On this day";
  if (cue === "connected") return "Connected to recent";
  if (cue === "quiet") return "From a while ago";
  return "From the brain";
}
