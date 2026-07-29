import type { App, TFile } from "obsidian";
import type { Capture, VaultContext } from "../shared/types";
import { buildCandidateCorpus, type CandidateCorpus, type CandidateNote } from "./candidates";
import {
  discoverPersonHubs,
  personHubTitles,
  type PersonHub,
} from "./enrich/people";
import { buildLinkGraph, expandFromSeeds, type LinkGraph } from "./expand";
import { rankShortlist } from "./shortlist";
import {
  eligibleTags,
  normalizeTag,
  sortTags,
  unionTags,
} from "./vocabulary";

/** Shortlist size when nothing configures it (KTD6). U8 wires the setting. */
export const DEFAULT_SHORTLIST_K = 400;

/**
 * Graph expansion when nothing configures it (R7). U8 wires the setting.
 *
 * On, because the default caller is daily filing, which is the only path it helps. A catch-up
 * routes through the same provider and must pass `expandGraph: false`: its reach is 0% by
 * construction (KTD7), so leaving it on there would spend a walk to add nothing.
 */
export const DEFAULT_GRAPH_EXPANSION = true;

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
    const aliases = f.cache?.frontmatter?.aliases;
    if (typeof aliases === "string" && aliases.trim()) {
      out.add(aliases.trim());
    } else if (Array.isArray(aliases)) {
      for (const a of aliases) {
        if (typeof a === "string" && a.trim()) out.add(a.trim());
      }
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Tag-count aggregation via the documented fallback path:
 * per-file `tags` cache entries + frontmatter.tags (string | string[]).
 * Does not use undocumented `metadataCache.getTags()`.
 */
export function aggregateTagsFromFileCaches(
  files: Array<{
    path: string;
    cache: {
      tags?: Array<{ tag: string }>;
      frontmatter?: Record<string, unknown> | null;
    } | null;
  }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  };

  for (const f of files) {
    const cache = f.cache;
    if (!cache) continue;
    for (const entry of cache.tags ?? []) {
      bump(entry.tag);
    }
    const fm = cache.frontmatter;
    if (fm && "tags" in fm) {
      const v = fm.tags;
      if (typeof v === "string") {
        for (const part of v.split(/[,\s]+/)) bump(part);
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") bump(item);
        }
      }
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
  return { titles, tags, vocabulary, personHubs, personHubDetails };
}

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
    const ranked = rankShortlist(captureText(capture), corpus.notes, Number.POSITIVE_INFINITY);

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
   * Append the hub-blocked 2-hop neighbours of the top seeds, in place. Returns how many were
   * added, or null when expansion is off — which is what keeps the off case byte-identical.
   *
   * Expansion slots sit **on top of** `k`, not inside it. `k` caps what BM25 scored; a reached note
   * scored zero by definition, so charging it against the scored budget would evict a real match to
   * make room for a guess. The slot count is what bounds the cost instead.
   */
  private expand(corpus: CandidateCorpus, shortlist: ShortlistCandidate[]): number | null {
    if (!this.expansion) return null;

    const corpusPaths = new Set(corpus.notes.map((n) => n.path));
    const reached = expandFromSeeds(
      shortlist.map((c) => c.path),
      {
        graph: this.expansion.graph,
        hubPaths: this.expansion.hubPaths,
        // `resolvedLinks` also points at attachments and at notes this run could not read; only a
        // note in the corpus is a link target the model can safely be offered.
        accept: (path) => corpusPaths.has(path),
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
  }): void {
    const note: CandidateNote = {
      path: atom.path,
      title: atom.title,
      body: atom.body,
      tags: atom.tags ?? [],
      links: atom.links ?? [],
      isAtom: true,
    };
    this.corpus?.add(note);
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
    k?: number;
    /** Graph expansion (R7). Daily filing wants it on; a catch-up must pass false — see KTD7. */
    expandGraph?: boolean;
  }): Promise<ContextRun> {
    const corpus = await buildCandidateCorpus(this.app, {
      atomFolder: opts?.atomFolder ?? "",
    });
    const k = opts?.k ?? DEFAULT_SHORTLIST_K;
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

/** Shared person-hub list for stable prefix + classify user message. */
export function formatPersonHubsForContext(context: VaultContext): string {
  const details = context.personHubDetails ?? [];
  if (details.length) {
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
  ].join("\n");
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
