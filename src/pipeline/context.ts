import type { App, TFile } from "obsidian";
import type {
  Capture,
  ClassificationLink,
  VaultContext,
} from "../shared/types";
import { buildCandidateCorpus, type CandidateCorpus, type CandidateNote } from "./candidates";
import {
  discoverPersonHubs,
  personHubTitles,
  type PersonHub,
} from "./enrich/people";
import { pathInSafetyDenylist } from "./hubQualify";
import {
  buildLinkGraph,
  expandFromSeeds,
  EXPANSION_SEEDS,
  EXPANSION_SLOTS,
  type LinkGraph,
} from "./expand";
import { formatLinkProse } from "./render";
import {
  eligibleTags,
  normalizeTag,
  sortTags,
  unionTags,
} from "./vocabulary";

/** Shortlist size when nothing configures it (KTD6). */
export const DEFAULT_SHORTLIST_K = 400;

/** Smallest shortlist a *typed* value may ask for. Zero is reachable in code, never from input. */
export const MIN_SHORTLIST_K = 1;

/**
 * Coerce an untrusted shortlist size into one the pipeline can run (R8).
 *
 * Nothing at all — blank field, letters, `NaN`, a `data.json` key nothing reads any more —
 * resolves to the default rather than to zero, because a silent zero would hand
 * classify an empty note list and look exactly like a vault with nothing in it. A number below the
 * floor (0, negative) clamps up instead; fractions round down. There is no ceiling: a large value
 * simply scores the whole corpus, which is where this pipeline started.
 */
export function clampShortlistSize(raw: unknown): number {
  const text =
    typeof raw === "number"
      ? String(raw)
      : typeof raw === "string"
        ? raw.trim()
        : "";
  if (!text) return DEFAULT_SHORTLIST_K;
  const n = Number(text);
  if (!Number.isFinite(n)) return DEFAULT_SHORTLIST_K;
  return Math.max(MIN_SHORTLIST_K, Math.floor(n));
}

/**
 * Graph expansion when nothing configures it (R7).
 *
 * On, because the default caller is daily filing, which is the only path it helps. A catch-up
 * routes through the same provider and must pass `expandGraph: false`: its reach is 0% by
 * construction (KTD7), so leaving it on there would spend a walk to add nothing.
 */
export const DEFAULT_GRAPH_EXPANSION = true;

/**
 * How a catch-up subdivides its captures (U5).
 *
 * Calendar units, never capture counts. Reachability — whether an atom written for January is
 * offered to a February capture — is set by the chunk's *duration* against the gap in days between
 * a capture and the note it wants to link; a "200 captures per chunk" rule conflates that with how
 * densely the user happened to write. Measured on the real 811-link corpus: monthly recovers 71% of
 * the in-run links a frozen list loses and costs $18.81, weekly 79% at $23.18, today's frozen list
 * 0% at $30.79.
 */
export type ChunkGranularity = "month" | "week";

/**
 * Chunk size when nothing configures it.
 *
 * Monthly, because it is the only strategy costed that beats today's behaviour on **both** axes at
 * once — cheaper *and* strictly better recall. Weekly buys the last 8 points for $4.37; per-capture
 * shortlisting was the worst option costed ($52.26), because it forfeits the shared prefix entirely.
 */
export const DEFAULT_CHUNK_GRANULARITY: ChunkGranularity = "month";

/** Leading `YYYY-MM-DD` of a date-ish string (daily-note basenames, `created:` frontmatter). */
function parseYmd(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const m = (value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * The chunk a date belongs to, or null when the string carries no usable date.
 *
 * Weeks are ISO-8601 (Monday start, week 1 contains the year's first Thursday) so a chunk boundary
 * never depends on the machine's locale — the same vault must chunk identically on every device.
 */
export function chunkKeyForDate(
  date: string | null | undefined,
  granularity: ChunkGranularity = DEFAULT_CHUNK_GRANULARITY,
): string | null {
  const ymd = parseYmd(date);
  if (!ymd) return null;
  if (granularity === "month") {
    return `${ymd.y}-${String(ymd.m).padStart(2, "0")}`;
  }
  const utc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  // Shift to the Thursday of this ISO week; its calendar year is the ISO week-numbering year.
  const dow = (utc.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  utc.setUTCDate(utc.getUTCDate() - dow + 3);
  const isoYear = utc.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  const week =
    1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** One chunk of a catch-up: a calendar key and the items that fall in it, in their original order. */
export interface Chunk<T> {
  key: string;
  items: T[];
}

/** The key an item with no parseable date is filed under when nothing else can claim it. */
export const UNDATED_CHUNK_KEY = "undated";

/**
 * Group items into calendar chunks, oldest first.
 *
 * **Undated items join their nearest dated neighbour** — the last dated item before them, or the
 * first dated item after them when they lead the list. They do not get a chunk of their own, for
 * two reasons. A lone "undated" bucket has no position in the chronological sweep, so there is no
 * correct moment to resolve it; and a capture whose daily filename is malformed is still, in
 * practice, sitting between two dated ones, so its neighbours' shortlist is a better guess than an
 * arbitrary union of every other malformed capture in the vault. Only when *nothing* in the list
 * carries a date does a single `undated` chunk exist — which is exactly one shared prefix, the
 * cheapest shape available for a set with no chronology at all.
 */
export function groupIntoChunks<T>(
  items: readonly T[],
  dateOf: (item: T) => string | null | undefined,
  granularity: ChunkGranularity = DEFAULT_CHUNK_GRANULARITY,
): Array<Chunk<T>> {
  const keys = items.map((it) => chunkKeyForDate(dateOf(it), granularity));

  // Carry the last seen key forward, then the first seen key backward over any leading gap.
  let carried: string | null = null;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]) carried = keys[i]!;
    else keys[i] = carried;
  }
  const firstDated = keys.find((k) => k !== null) ?? UNDATED_CHUNK_KEY;
  for (let i = 0; i < keys.length; i++) {
    if (!keys[i]) keys[i] = firstDated;
  }

  const byKey = new Map<string, T[]>();
  for (let i = 0; i < items.length; i++) {
    const key = keys[i]!;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(items[i]!);
    else byKey.set(key, [items[i]!]);
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, group]) => ({ key, items: group }));
}

/** What the two retrieval settings mean to a run. One mapping, so no call site invents its own. */
export interface ShortlistRunOptions {
  shortlistK: number;
  expandGraph: boolean;
}

/**
 * The run options every daily-filing caller uses (R7, R8).
 *
 * Both were once settings and are now constants: the studied defaults are what the pipeline is
 * tuned for, and a stale `shortlistSize` / `expandLinkedNotes` left in an existing `data.json` is
 * read by nothing (KTD8). Callers that genuinely differ — a catch-up, which must pass
 * `expandGraph: false` — still build `ShortlistRunOptions` themselves.
 */
export function shortlistOptionsFromSettings(): ShortlistRunOptions {
  return {
    shortlistK: DEFAULT_SHORTLIST_K,
    expandGraph: DEFAULT_GRAPH_EXPANSION,
  };
}

/** One selected note, with the score it earned against this capture. */
export interface ShortlistCandidate {
  /** Vault path — the identity a note is deduped by. */
  path: string;
  /** The title the model links by: basename, or the alias that matched. */
  title: string;
  score: number;
}

/** Counts only — never capture text, never titles. Safe to log (R6, U8). */
export interface ShortlistStats {
  /** Scoreable entries in the run's corpus (one per linkable title). */
  corpusSize: number;
  /** Entries that shared at least one term with the capture. */
  matched: number;
  /** Entries that scored an absolute zero. */
  zeroScoring: number;
  /** Distinct notes actually returned, expansion slots included. */
  returned: number;
  k: number;
  /**
   * Notes appended by graph expansion. **Absent** when expansion is off — a run with the setting
   * disabled returns exactly the bytes it returned before expansion existed.
   */
  expanded?: number;
}

/**
 * The whole diagnostic payload: numbers and one on/off word. No field can hold a string the user
 * wrote (R6). Every value here is derived arithmetic — nothing is copied from a capture or a note.
 */
export interface ShortlistDiagnostics {
  /** Configured shortlist size for this run. */
  k: number;
  /** Scoreable entries in the corpus. */
  corpusSize: number;
  /** Entries that shared at least one term with the capture. */
  matched: number;
  /** Entries BM25 could never reach — the number graph expansion exists to dent. */
  zeroScoring: number;
  /** Notes handed to classify, expansion slots included. */
  returned: number;
  /** Scored notes only — `returned` minus whatever expansion appended. */
  scored: number;
  expansion: "on" | "off";
  /** Shortlist entries the walk started from. 0 when expansion is off. */
  seeds: number;
  /** Expansion slots filled. 0 when expansion is off. */
  slotsUsed: number;
  /** Expansion slots available. 0 when expansion is off. */
  slotLimit: number;
}

/**
 * Counts a run can safely emit (R6).
 *
 * Built from `ShortlistStats` alone, which is a bag of numbers — so this function has no path to
 * capture text or note titles even if a future caller wanted one. That is the point: the redaction
 * is structural, not a discipline anyone has to remember at the log line.
 */
export function shortlistDiagnostics(stats: ShortlistStats): ShortlistDiagnostics {
  const on = stats.expanded !== undefined;
  const slotsUsed = stats.expanded ?? 0;
  const scored = stats.returned - slotsUsed;
  return {
    k: stats.k,
    corpusSize: stats.corpusSize,
    matched: stats.matched,
    zeroScoring: stats.zeroScoring,
    returned: stats.returned,
    scored,
    expansion: on ? "on" : "off",
    seeds: on ? Math.min(scored, EXPANSION_SEEDS) : 0,
    slotsUsed,
    slotLimit: on ? EXPANSION_SLOTS : 0,
  };
}

/**
 * Emit the counts. No-ops in production Community builds, exactly like `logClassifyOutcome`.
 *
 * Takes `stats`, not the `ShortlistContext` that carries them, so the titles are not even in scope.
 */
/** Dev diagnostics hook — no-op (Community plugin scan forbids console). */
export function logShortlistDiagnostics(
  _label: string,
  _stats: ShortlistStats,
): void {
  void _label;
  void _stats;
}

/** What a run needs to walk the vault graph. Built once per run, alongside the corpus. */
export interface GraphExpansion {
  graph: LinkGraph;
  /** Person-hub paths — reachable, never traversed through. One definition, from `enrich/people`. */
  hubPaths: ReadonlySet<string>;
}

/**
 * A `VaultContext` whose `titles` are this capture's shortlist, in score order.
 *
 * Everything else — tags, vocabulary, person hubs — is the run's static context, unchanged.
 * Hubs stay in their own field precisely so shortlisting a capture can never make one unlinkable.
 */
export interface ShortlistContext extends VaultContext {
  shortlist: ShortlistCandidate[];
  stats: ShortlistStats;
}

/**
 * The shortlist seam (R3). Every classify path resolves its context through this one call, so
 * retrieval can change without any caller learning how ranking works.
 */
export interface ContextProvider {
  getCandidates(capture: Capture | string): Promise<ShortlistContext>;
}

/** Capture text, however the caller holds it. */
function captureText(capture: Capture | string): string {
  return typeof capture === "string" ? capture : capture.text;
}

/** Note title for linking: basename without extension. */
export function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/**
 * Collect link targets from paths — basenames, sorted (no timestamps).
 */
export function collectTitles(paths: string[]): string[] {
  const titles = paths.map(titleFromPath);
  return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b));
}

/**
 * The trimmed aliases a file declares, in frontmatter order.
 *
 * The single definition of "what counts as an alias" — Obsidian accepts either a bare string or a
 * list, and every place that must keep a hub linkable (the run's title list, the scoreable corpus,
 * person-hub discovery) has to agree on that reading or a hub goes quietly missing from one of them.
 * Blanks and non-strings are dropped; nothing else is filtered, so callers own their own deduping.
 */
export function aliasesForFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] {
  const out: string[] = [];
  const aliases = frontmatter?.aliases;
  if (typeof aliases === "string" && aliases.trim()) {
    out.push(aliases.trim());
  } else if (Array.isArray(aliases)) {
    for (const a of aliases) {
      if (typeof a === "string" && a.trim()) out.push(a.trim());
    }
  }
  return out;
}

/**
 * Basenames + frontmatter aliases so person hubs (e.g. Alex/) stay linkable.
 * Deterministic sort for stable cache prefixes.
 */
export function collectLinkTargets(
  files: Array<{
    path: string;
    cache: { frontmatter?: Record<string, unknown> | null } | null;
  }>,
): string[] {
  const out = new Set<string>();
  for (const f of files) {
    out.add(titleFromPath(f.path));
    for (const a of aliasesForFrontmatter(f.cache?.frontmatter)) out.add(a);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** A file cache, reduced to the two places a tag can hide. */
export interface TaggableFileCache {
  tags?: Array<{ tag: string }>;
  frontmatter?: Record<string, unknown> | null;
}

/**
 * One file's tag **occurrences**, normalised, in cache order: inline hashtags then `frontmatter.tags`
 * (string or list). The documented fallback path — never undocumented `metadataCache.getTags()`.
 *
 * Occurrences, not a set: the settings screen ranks tags by "N use(s)", so a tag written twice in
 * one note counts twice. Callers that want the distinct tags of a file dedupe what comes back.
 */
export function tagsForFileCache(cache: TaggableFileCache | null | undefined): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const t = normalizeTag(raw);
    if (t) out.push(t);
  };
  for (const entry of cache?.tags ?? []) push(entry.tag);
  const v = cache?.frontmatter?.tags;
  if (typeof v === "string") {
    for (const part of v.split(/[,\s]+/)) push(part);
  } else if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") push(item);
    }
  }
  return out;
}

/** How often each tag is used across the vault, for the "found in your vault" ranking. */
export function aggregateTagsFromFileCaches(
  files: Array<{ path: string; cache: TaggableFileCache | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const t of tagsForFileCache(f.cache)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

export function buildVaultContext(opts: {
  titles: string[];
  vaultTags: string[];
  activeVocabulary: string[];
  personHubs?: string[];
  personHubDetails?: VaultContext["personHubDetails"];
  listHubDetails?: VaultContext["listHubDetails"];
}): VaultContext {
  const titles = [...opts.titles].sort((a, b) => a.localeCompare(b));
  // Eligible = structural (person/preferences/…) ∪ user Active
  const vocabulary = eligibleTags(opts.activeVocabulary);
  // Union of vault tags + eligible vocabulary for the prompt tag list (U4).
  const tags = unionTags(opts.vaultTags, vocabulary);
  const personHubs = [...(opts.personHubs ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );
  const personHubDetails = opts.personHubDetails ?? [];
  const listHubDetails = opts.listHubDetails ?? [];
  return {
    titles,
    tags,
    vocabulary,
    personHubs,
    personHubDetails,
    listHubDetails,
  };
}

/** Max list hubs in classify context (KTD6). */
export const LIST_HUB_CONTEXT_TOP_N = 40;

/**
 * One processing run's context: the static vault context plus the scoreable corpus, held for
 * exactly as long as the run and no longer (KTD4/KTD4a).
 *
 * The run is a **separate object from the provider** on purpose. A provider that lazily cached a
 * corpus for the plugin's lifetime would serve a second Process the first one's stale vault — the
 * bug this seam exists to fix — and no amount of care at the call sites would make that visible.
 * Here the corpus has nowhere to hide: it is reachable only through the handle `beginRun()` handed
 * out, so a caller who forgets `end()` merely holds memory a little longer than needed, and the
 * *next* run still re-reads the vault because it is a different object.
 */
export class ContextRun implements ContextProvider {
  private corpus: CandidateCorpus | null;

  constructor(
    /** Tags, vocabulary and person hubs — computed once, identical for every capture in the run. */
    private readonly staticContext: VaultContext,
    corpus: CandidateCorpus,
    readonly k: number,
    /** Graph reach for this run, or null when the setting is off (R7). */
    private readonly expansion: GraphExpansion | null = null,
  ) {
    this.corpus = corpus;
  }

  /**
   * The run's static context — tags, vocabulary, person hubs, and the *full* title list.
   *
   * Callers need it for the run-level work that is not per-capture: deriving the person hubs a
   * whole run enriches against, and projecting hubs at the end. Never pass it to classify; that is
   * what `getCandidates()` is for.
   */
  get vaultContext(): VaultContext {
    return this.staticContext;
  }

  /** Scoreable entries currently in the corpus, including atoms appended mid-run. */
  get corpusSize(): number {
    return this.corpus?.notes.length ?? 0;
  }

  /**
   * The top `k` notes for this capture, best first.
   *
   * Dedupe sits **between** ranking and the cap, not before or after: a note reachable by both its
   * basename and an alias is two candidates in the corpus (so either spelling can match) but must
   * occupy one shortlist slot, and deduping after slicing would silently return fewer than `k`.
   * The surviving title is whichever spelling scored highest — the one the capture actually used.
   */
  async getCandidates(capture: Capture | string): Promise<ShortlistContext> {
    const corpus = this.corpus;
    if (!corpus) {
      throw new Error("[atoms] context run has ended — begin a new run to score captures");
    }
    // Scores against the run's standing index: only the query is tokenised here (KTD4). Zero is an
    // absolute miss, so the same filter `rankShortlist` applies drops those before the cap.
    const ranked = corpus.index.rank(captureText(capture)).filter((n) => n.score > 0);

    const seen = new Set<string>();
    const shortlist: ShortlistCandidate[] = [];
    // Cap checked before the push, not after, so k=0 returns nothing rather than one.
    for (const n of ranked) {
      if (shortlist.length >= this.k) break;
      if (seen.has(n.path)) continue;
      seen.add(n.path);
      shortlist.push({ path: n.path, title: n.title, score: n.score });
    }

    const expanded = this.expand(corpus, shortlist);

    return {
      ...this.staticContext,
      // Deliberately not re-sorted: score order is the product of this unit, and U7 exists because
      // re-sorting alphabetically downstream throws it away.
      titles: shortlist.map((c) => c.title),
      shortlist,
      stats: {
        corpusSize: corpus.notes.length,
        matched: ranked.length,
        zeroScoring: corpus.notes.length - ranked.length,
        returned: shortlist.length,
        k: this.k,
        ...(expanded === null ? {} : { expanded }),
      },
    };
  }

  /**
   * One shortlist for a whole chunk: the **union** of its captures' shortlists (U5).
   *
   * A catch-up cannot afford a shortlist per capture — measured, that is the most expensive strategy
   * there is, because the note-title block changes on every request and so can never be read back
   * from cache. A chunk instead resolves once and every capture in it is sent the *same* bytes.
   *
   * Union, not "score the concatenated text": concatenating lets one long capture's vocabulary
   * dominate BM25 and starve a short one of its own best match, whereas a union guarantees every
   * capture still sees at least the notes its own shortlist would have contained. The price is a
   * larger title block — bounded by the atoms per chunk, and paid once for the chunk rather than
   * once per capture.
   *
   * Order is by best score across the chunk, so U7's "the device already ranked these" contract
   * survives; ties break on title so the bytes are stable across devices and reruns.
   */
  async getChunkCandidates(
    captures: ReadonlyArray<Capture | string>,
  ): Promise<ShortlistContext> {
    if (!this.corpus) {
      throw new Error("[atoms] context run has ended — begin a new run to score captures");
    }
    const per = await Promise.all(captures.map((c) => this.getCandidates(c)));
    if (per.length === 1) return per[0]!;

    const best = new Map<string, ShortlistCandidate>();
    const scoredPaths = new Set<string>();
    const reachedPaths = new Set<string>();
    let matched = 0;
    let anyExpansion = false;

    for (const ctx of per) {
      const expanded = ctx.stats.expanded;
      if (expanded !== undefined) anyExpansion = true;
      // `expand()` appends its reached notes, so they are exactly the tail of the shortlist.
      const scoredCount = ctx.shortlist.length - (expanded ?? 0);
      matched = Math.max(matched, ctx.stats.matched);
      ctx.shortlist.forEach((cand, i) => {
        (i < scoredCount ? scoredPaths : reachedPaths).add(cand.path);
        const prev = best.get(cand.path);
        if (!prev || cand.score > prev.score) best.set(cand.path, cand);
      });
    }

    const shortlist = [...best.values()].sort(
      (a, b) => b.score - a.score || a.title.localeCompare(b.title),
    );
    const corpusSize = per[0]?.stats.corpusSize ?? this.corpusSize;
    // Reached by the walk and never scored by any capture in the chunk.
    let expandedOnly = 0;
    for (const p of reachedPaths) if (!scoredPaths.has(p)) expandedOnly += 1;

    return {
      ...this.staticContext,
      titles: shortlist.map((c) => c.title),
      shortlist,
      stats: {
        corpusSize,
        matched,
        zeroScoring: corpusSize - matched,
        returned: shortlist.length,
        k: this.k,
        ...(anyExpansion ? { expanded: expandedOnly } : {}),
      },
    };
  }

  /**
   * Append the hub-blocked 2-hop neighbours of the top seeds, in place. Returns how many were
   * added, or null when expansion is off — which is what keeps the off case byte-identical.
   *
   * Expansion slots sit **on top of** `k`, not inside it. `k` caps what BM25 scored; a reached note
   * scored zero by definition, so charging it against the scored budget would evict a real match to
   * make room for a guess. The slot count is what bounds the cost instead.
   */
  private expand(corpus: CandidateCorpus, shortlist: ShortlistCandidate[]): number | null {
    if (!this.expansion) return null;

    const reached = expandFromSeeds(
      shortlist.map((c) => c.path),
      {
        graph: this.expansion.graph,
        hubPaths: this.expansion.hubPaths,
        // `resolvedLinks` also points at attachments and at notes this run could not read; only a
        // note in the corpus is a link target the model can safely be offered.
        accept: (path) => corpus.paths.has(path),
      },
    );

    for (const path of reached) {
      // Basename, never an alias: it is the one title every corpus entry for a path carries.
      shortlist.push({ path, title: titleFromPath(path), score: 0 });
    }
    return reached.length;
  }

  /**
   * Make an atom this run just wrote scoreable by the captures that follow it (KTD4a).
   *
   * Never re-reads the vault: the caller already holds the verbatim capture, the tags and the link
   * prose it wrote a moment ago.
   */
  addAtom(atom: {
    path: string;
    title: string;
    body: string;
    tags?: string[];
    links?: string[];
    /** Drop these paths when replacing (refresh rename: old path + new path). */
    replacePaths?: readonly string[];
  }): void {
    const note: CandidateNote = {
      path: atom.path,
      title: atom.title,
      body: atom.body,
      tags: atom.tags ?? [],
      links: atom.links ?? [],
      isAtom: true,
    };
    if (!this.corpus) return;
    if (atom.replacePaths?.length) {
      this.corpus.upsert(note, atom.replacePaths);
    } else {
      this.corpus.add(note);
    }
  }

  /**
   * Index an atom this run just wrote, straight from the classification that produced it.
   *
   * The single place a write path — daily Process, chunked backfill, refresh — turns a result into
   * a corpus entry. Three copies of this had already drifted on how they spell "no link prose", and
   * the prose indexed here has to be the prose written to disk or a later capture is ranked against
   * a note the vault does not contain.
   */
  addWrittenAtom(atom: {
    path: string;
    title: string;
    /** The verbatim capture — the body BM25 scores. */
    body: string;
    tags?: string[] | null;
    links?: ClassificationLink[] | null;
    /** When set, replace any prior entries for these paths (refresh refile / rename). */
    replacePaths?: readonly string[];
  }): void {
    const prose = formatLinkProse(atom.links ?? []);
    this.addAtom({
      path: atom.path,
      title: atom.title,
      body: atom.body,
      tags: atom.tags ?? [],
      links: prose ? [prose] : [],
      replacePaths: atom.replacePaths,
    });
  }

  /** Release the corpus. Idempotent; scoring afterwards is a caller bug and throws. */
  end(): void {
    this.corpus = null;
  }
}

/**
 * v1 ContextProvider: every markdown title + every vault tag.
 * Reads metadataCache synchronously; no index, no embeddings.
 */
export class MetadataContextProvider {
  constructor(
    private readonly app: App,
    private readonly getActiveVocabulary: () => string[],
  ) {}

  /**
   * Open a run: read the vault once, build the static context once, and hand back the only handle
   * to both. The provider itself keeps nothing, which is what makes the run boundary real.
   */
  async beginRun(opts?: {
    atomFolder?: string;
    /** Shortlist size — the same field name `ShortlistRunOptions` uses, so callers can spread it. */
    shortlistK?: number;
    /** Graph expansion (R7). Daily filing wants it on; a catch-up must pass false — see KTD7. */
    expandGraph?: boolean;
  }): Promise<ContextRun> {
    const corpus = await buildCandidateCorpus(this.app, {
      atomFolder: opts?.atomFolder ?? "",
    });
    const k = opts?.shortlistK ?? DEFAULT_SHORTLIST_K;
    const { context, hubs } = this.buildContextAndHubs();
    const expansion = (opts?.expandGraph ?? DEFAULT_GRAPH_EXPANSION)
      ? {
          graph: buildLinkGraph(this.app.metadataCache.resolvedLinks),
          hubPaths: new Set(hubs.map((h) => h.path)),
        }
      : null;
    return new ContextRun(context, corpus, k, expansion);
  }

  buildContext(): VaultContext {
    return this.buildContextAndHubs().context;
  }

  /**
   * The static context plus the hubs it was derived from.
   *
   * Expansion needs hub *paths* and the context keeps only titles, and discovery is a full pass
   * over every file cache — so a run reads it once and both callers share that pass.
   */
  private buildContextAndHubs(): { context: VaultContext; hubs: PersonHub[] } {
    const files = this.app.vault.getMarkdownFiles();
    const caches = files.map((f: TFile) => ({
      path: f.path,
      cache: this.app.metadataCache.getFileCache(f),
    }));
    const titles = collectLinkTargets(caches);
    const counts = aggregateTagsFromFileCaches(caches);
    const vaultTags = sortTags([...counts.keys()]);
    const hubs: PersonHub[] = discoverPersonHubs(caches);
    const personPaths = new Set(hubs.map((h) => h.path));
    const listHubDetails: VaultContext["listHubDetails"] = [];
    for (const { path, cache } of caches) {
      if (personPaths.has(path)) continue;
      if (pathInSafetyDenylist(path)) continue;
      const sections = sectionsFromCache(cache);
      if (!sections.length) continue;
      const title = path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
      listHubDetails.push({
        canonicalTitle: title,
        matchKeys: [title],
        sections,
      });
    }
    // Pin media soft-title hubs first (KTD6), then alphabetical fill to cap.
    const softPin = new Set(["movies", "shows", "watchlist", "films"]);
    listHubDetails.sort((a, b) => {
      const ap = softPin.has(a.canonicalTitle.toLowerCase()) ? 0 : 1;
      const bp = softPin.has(b.canonicalTitle.toLowerCase()) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.canonicalTitle.localeCompare(b.canonicalTitle);
    });
    if (listHubDetails.length > LIST_HUB_CONTEXT_TOP_N) {
      listHubDetails.length = LIST_HUB_CONTEXT_TOP_N;
    }
    const context = buildVaultContext({
      titles,
      vaultTags,
      activeVocabulary: this.getActiveVocabulary(),
      personHubs: personHubTitles(hubs),
      personHubDetails: hubs.map((h) => {
        const file = files.find((f) => f.path === h.path);
        const cache = file
          ? this.app.metadataCache.getFileCache(file)
          : undefined;
        return {
          canonicalTitle: h.canonicalTitle,
          matchKeys: h.matchKeys,
          sections: sectionsFromCache(cache),
        };
      }),
      listHubDetails,
    });
    return { context, hubs };
  }
}

/** H2 headings from Obsidian metadata cache. */
export function sectionsFromCache(
  cache: { headings?: { heading: string; level: number }[] } | null | undefined,
): string[] {
  const heads = cache?.headings ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of heads) {
    if (h.level !== 2) continue;
    const t = (h.heading ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function formatHubDetailLines(
  details: Array<{ canonicalTitle: string; sections?: string[] }>,
): string {
  return details
    .map((d) => {
      const name = d.canonicalTitle;
      const secs = d.sections ?? [];
      if (!secs.length) return `- ${name}`;
      const sub = secs.map((s) => `  - ${s}`).join("\n");
      return `- ${name}\n${sub}`;
    })
    .join("\n");
}

/** Shared person-hub list for stable prefix + classify user message. */
export function formatPersonHubsForContext(context: VaultContext): string {
  const details = context.personHubDetails ?? [];
  if (details.length) return formatHubDetailLines(details);
  if (context.personHubs?.length) {
    return context.personHubs.map((t) => `- ${t}`).join("\n");
  }
  return "(none)";
}

/** Joins the two context blocks back into one message. Part of block A's bytes when split. */
export const CONTEXT_BLOCK_SEPARATOR = "\n\n";

/**
 * Block A — vocabulary, vault tags, person hubs. Genuinely byte-stable within a run, so this is
 * the block that carries `cache_control`.
 *
 * The note titles deliberately live in block B: they are this capture's shortlist, they change on
 * every capture, and a cache breakpoint drawn after them would be written once per capture and read
 * back never — strictly worse than no breakpoint at all, since cache writes cost a premium.
 */
export function buildContextPrefixBlock(context: VaultContext): string {
  const vocab = context.vocabulary.length
    ? context.vocabulary.map((t) => `#${t.replace(/^#/, "")}`).join(" ")
    : "(none)";
  const tags = context.tags.length
    ? context.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")
    : "(none)";
  const personHubs = formatPersonHubsForContext(context);
  const listHubs = formatListHubsForContext(context);
  return [
    "## Vault context (stable prefix — do not include timestamps or run IDs)",
    "",
    "### Active vocabulary",
    vocab,
    "",
    "### Tags present in vault",
    tags,
    "",
    "### Person hubs (from your vault — prefer linking these exact titles)",
    personHubs,
    "",
    "### List hubs (notes with ## sections — link + hub_section when capture fits)",
    listHubs,
  ].join("\n");
}

/** List hub titles + indented H2s for classify context (R9). */
export function formatListHubsForContext(context: VaultContext): string {
  const details = context.listHubDetails ?? [];
  if (!details.length) return "(none)";
  return formatHubDetailLines(details);
}

/** Block B — the capture's shortlisted titles, in score order. Volatile; never cached. */
export function buildTitlesBlock(context: VaultContext): string {
  const titles = context.titles.length
    ? context.titles.map((t) => `- ${t}`).join("\n")
    : "(empty vault)";
  return ["### Note titles", titles].join("\n");
}

/**
 * The bytes that must stay identical across the captures of one run for a cache read to happen —
 * block A, and only block A. Same renderer `buildMessagesRequest` uses, not a parallel copy.
 */
export function renderStablePrefix(context: VaultContext): string {
  return buildContextPrefixBlock(context);
}
