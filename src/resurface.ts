/**
 * Zero-guilt resurfacing stream — multi-cue recall for the second brain.
 *
 * Cues (priority):
 * 0. mind-change — hard supersession pair (revises / contradicts)
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

export type ResurfaceCue =
  | "mind-change"
  | "on-this-day"
  | "connected"
  | "quiet";

export type SupersessionRelation = "revises" | "contradicts";

/** Hard supersession edge from atom body link prose (R16 / KTD9). */
export type SupersessionEdge = {
  /** Title of the other atom in the pair */
  peerTitle: string;
  relation: SupersessionRelation;
  /**
   * From the scanned atom's POV: outbound = this atom revises/contradicts peer;
   * inbound is reconstructed when the peer is the new claim.
   */
  direction: "outbound" | "inbound";
};

export type ResurfaceCandidate = {
  path: string;
  title: string;
  bodySnippet: string;
  /** YYYY-MM-DD memory day when known */
  matchDate: string;
  cue: ResurfaceCue;
  mtime?: number;
  /** mind-change: newer claim title */
  laterTitle?: string;
  /** mind-change: newer claim path */
  laterPath?: string;
  /** mind-change: relation token */
  relation?: SupersessionRelation;
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
/** Device-local: calendar day (YYYY-MM-DD) when a mind-change hero was last shown. */
export const LS_MIND_CHANGE_DAY = "atoms-mind-change-day-v1";
/** Device-local: pair keys throttled after Open / Next / Not a mind-change. */
export const LS_MIND_CHANGE_PAIR_THROTTLE = "atoms-mind-change-pair-throttle-v1";

/**
 * Hard supersession: reason text names revises/contradicts with a wikilink.
 * Generic "relates" does not qualify (Belief OS product law).
 */
const SUPERSESSION_EDGE_RE =
  /\b(revises|contradicts)\b[^\n[]{0,80}\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/gi;
const SUPERSESSION_EDGE_RE_FLIP =
  /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\][^\n.]{0,40}\b(revises|contradicts)\b/gi;

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

/** Normalize peer title for path/map keys. */
export function normalizePeerTitle(raw: string): string {
  return (raw ?? "").replace(/\.md$/i, "").trim();
}

/**
 * Extract hard supersession edges from atom body (including link-prose paragraph).
 * Outbound only — peer may or may not exist in the vault.
 */
export function extractSupersessionEdges(content: string): SupersessionEdge[] {
  const body = bodyAfterFrontmatter(content);
  const out: SupersessionEdge[] = [];
  const seen = new Set<string>();

  const push = (relation: string, peerRaw: string) => {
    const rel = relation.toLowerCase();
    if (rel !== "revises" && rel !== "contradicts") return;
    const peerTitle = normalizePeerTitle(peerRaw);
    if (!peerTitle) return;
    const key = `${rel}|${peerTitle.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      peerTitle,
      relation: rel as SupersessionRelation,
      direction: "outbound",
    });
  };

  SUPERSESSION_EDGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SUPERSESSION_EDGE_RE.exec(body)) !== null) {
    push(m[1]!, m[2]!);
  }
  SUPERSESSION_EDGE_RE_FLIP.lastIndex = 0;
  while ((m = SUPERSESSION_EDGE_RE_FLIP.exec(body)) !== null) {
    push(m[2]!, m[1]!);
  }
  return out;
}

/** Stable pair key for throttle (order-independent titles). */
export function mindChangePairKey(pathA: string, pathB: string): string {
  return [pathA, pathB].sort().join("::");
}

/**
 * Mind-change candidates: newer atom has outbound revises/contradicts to an older atom file.
 * Hero shows the *old* body's snippet (rot defense).
 */
export function listMindChangeCandidates(
  indexed: IndexedAtom[],
  atomFolder: string,
): ResurfaceCandidate[] {
  const byTitle = new Map<string, IndexedAtom>();
  for (const a of indexed) {
    byTitle.set(a.title.toLowerCase(), a);
  }

  const out: ResurfaceCandidate[] = [];
  const seenPairs = new Set<string>();

  for (const newer of indexed) {
    const edges = extractSupersessionEdges(newer.content);
    for (const e of edges) {
      const older = byTitle.get(e.peerTitle.toLowerCase());
      if (!older) continue;
      if (older.path === newer.path) continue;
      // Prefer older memory day / mtime for "old" when titles differ
      const pair = mindChangePairKey(older.path, newer.path);
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);

      out.push({
        path: older.path,
        title: older.title,
        bodySnippet: older.bodySnippet,
        matchDate: older.matchDate || "",
        cue: "mind-change",
        mtime: newer.mtime,
        laterTitle: newer.title,
        laterPath: newer.path,
        relation: e.relation,
      });
    }
  }

  out.sort(
    (a, b) =>
      (b.mtime ?? 0) - (a.mtime ?? 0) || a.title.localeCompare(b.title),
  );
  // atomFolder reserved for future path checks
  void atomFolder;
  return out;
}

/** Citator chips for home open of one atom (inbound + outbound hard edges). */
export function citatorChipsForAtom(
  atom: IndexedAtom,
  indexed: IndexedAtom[],
): Array<{ label: string; peerPath: string; peerTitle: string }> {
  const byTitle = new Map<string, IndexedAtom>();
  for (const a of indexed) {
    byTitle.set(a.title.toLowerCase(), a);
  }
  const chips: Array<{ label: string; peerPath: string; peerTitle: string }> =
    [];
  const seen = new Set<string>();

  for (const e of extractSupersessionEdges(atom.content)) {
    const peer = byTitle.get(e.peerTitle.toLowerCase());
    if (!peer) continue;
    const key = `out|${e.relation}|${peer.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verb =
      e.relation === "revises" ? "Revises" : "Contradicts";
    chips.push({
      label: `${verb} · ${peer.title}`,
      peerPath: peer.path,
      peerTitle: peer.title,
    });
  }

  // Inbound: other atoms that revise/contradict this title
  for (const other of indexed) {
    if (other.path === atom.path) continue;
    for (const e of extractSupersessionEdges(other.content)) {
      if (e.peerTitle.toLowerCase() !== atom.title.toLowerCase()) continue;
      const key = `in|${e.relation}|${other.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const verb =
        e.relation === "revises" ? "Revised by" : "Contradicted by";
      chips.push({
        label: `${verb} · ${other.title}`,
        peerPath: other.path,
        peerTitle: other.title,
      });
    }
  }
  return chips;
}

export function mindChangeDayKey(todayYmd: string): string {
  return todayYmd;
}

export function mindChangeAlreadyShownToday(
  storedDay: string | null | undefined,
  todayYmd: string,
): boolean {
  return (storedDay ?? "").trim() === todayYmd;
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
 * Full stream pool in priority order
 * (mind-change → on-this-day → connected → quiet), de-duped by path.
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

  const mindChange = listMindChangeCandidates(indexed, atomFolder);
  const onThisDay = listOnThisDayCandidates(files, todayYmd, atomFolder);
  const seeds = recentSeedPaths(indexed, 5);
  const connected = listConnectedCandidates(indexed, seeds);
  const quiet = listQuietCandidates(indexed, {
    now: opts?.now,
    recentSeedPaths: seeds,
  });

  const seen = new Set<string>();
  const out: ResurfaceCandidate[] = [];
  // Mind-change uses old path; still de-dupe so same path doesn't also appear lower
  for (const c of [...mindChange, ...onThisDay, ...connected, ...quiet]) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    out.push(c);
  }
  return out;
}

export type PickResurfaceOpts = {
  skipPaths?: Iterable<string>;
  throttle?: ResurfaceThrottleMap;
  now?: number;
  throttleDays?: number;
  /** When set and equal to today, skip further mind-change heroes (1/day). */
  mindChangeDayShown?: string | null;
  todayYmd?: string;
  /** Pair keys throttled after recovery / open / next */
  pairThrottle?: ResurfaceThrottleMap;
};

/** First candidate not in skipPaths and not throttled. */
export function pickResurface(
  candidates: ResurfaceCandidate[],
  skipPaths: Iterable<string> = [],
  throttle: ResurfaceThrottleMap = {},
  now: number = Date.now(),
  throttleDays: number = RESURFACE_THROTTLE_DAYS,
  opts?: PickResurfaceOpts,
): ResurfaceCandidate | null {
  const skip = new Set(opts?.skipPaths ?? skipPaths);
  const thr = opts?.throttle ?? throttle;
  const tNow = opts?.now ?? now;
  const days = opts?.throttleDays ?? throttleDays;
  const today = opts?.todayYmd ?? calendarDateToday();
  const mindDone = mindChangeAlreadyShownToday(
    opts?.mindChangeDayShown,
    today,
  );
  const pairThr = opts?.pairThrottle ?? {};

  for (const c of candidates) {
    if (skip.has(c.path)) continue;
    if (isThrottled(c.path, thr, tNow, days)) continue;
    if (c.cue === "mind-change") {
      if (mindDone) continue;
      if (c.laterPath) {
        const pk = mindChangePairKey(c.path, c.laterPath);
        if (isThrottled(pk, pairThr, tNow, days)) continue;
      }
    }
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

/** Human cue labels — calm, Journal/For You tone (not ALL CAPS system chrome). */
export function cueLabel(cue: ResurfaceCue): string {
  if (cue === "mind-change") return "Mind change";
  if (cue === "on-this-day") return "On this day";
  if (cue === "connected") return "Related to something recent";
  if (cue === "quiet") return "Worth meeting again";
  return "For you";
}

/** Later-line copy for mind-change hero. */
export function mindChangeLaterLine(
  laterTitle: string,
  relation: SupersessionRelation = "revises",
): string {
  const verb = relation === "contradicts" ? "contradicts" : "revises";
  return `Later you wrote ${laterTitle} · ${verb}`;
}

/** Friendly date for meta: “Jul 15, 2024” */
export function formatCueDate(ymd: string): string {
  const m = (ymd ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mi = Number(m[2]) - 1;
  const mon = months[mi] ?? m[2];
  return `${mon} ${Number(m[3])}, ${m[1]}`;
}
