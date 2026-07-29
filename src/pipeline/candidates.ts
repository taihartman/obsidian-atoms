/**
 * The scoreable corpus — every vault note reduced to the four fields BM25F ranks (R2).
 *
 * Built **once per run** and held in memory (KTD4). There is no persistent index: an index that
 * outlives the run is an index that can disagree with the vault, and the whole point of scoring
 * bodies is that the answer tracks what the vault actually says right now.
 *
 * The corpus is also **appendable** (KTD4a). An atom written midway through a run must be
 * available to the captures that follow it, and everything needed to score it — title, capture,
 * tags, link prose — is already in hand at that moment. `add()` is the seam U3 builds on; nothing
 * here re-reads the vault after seeding.
 *
 * Reads are counted, not assumed: `reads` is the evidence that a multi-capture run costs one read
 * per note rather than one per note per capture.
 */

import type { App, TFile } from "obsidian";
import { titleFromPath } from "./context";
import { isLinkerGenerated } from "./atomQuality";
import { extractLinkProseRegion } from "./parseLinkProse";
import { bodyAfterFrontmatter, extractCaptureBody } from "./refreshAtoms";
import { clampAtomFolder } from "./render";
import { normalizeTag } from "./vocabulary";
import type { ScoreableNote } from "./shortlist";

/**
 * Character cap on **non-atom** bodies only.
 *
 * Two reasons, both measured. Fidelity first: every recall number this branch acts on was produced
 * by `scripts/analyze-vault-shortlist.mjs`, which indexes non-atom notes as
 * `stripFrontmatter(raw).slice(0, 2000)`. Indexing more here would mean shipping a retrieval
 * behaviour nobody measured. Memory second: a long meeting note or a grown hub is the only thing
 * in a vault with no natural size bound, and the cap bounds retained non-atom text at
 * notes × 2,000 chars — about 6 MB of UTF-8 across a 3,000-note vault, against the ~24 MB the
 * harness recorded for a full-body index at that size.
 *
 * Atom captures are deliberately **not** capped. They average 123 characters (median 97; 5 of 37
 * measured atoms exceed 200), so a cap would buy no memory and could only ever cut the one piece
 * of text the product treats as sacred.
 */
export const NON_ATOM_BODY_CHARS = 2000;

/** A vault note, reduced to what BM25F scores. Satisfies `ScoreableNote`. */
export interface CandidateNote extends ScoreableNote {
  /** Vault path — how a caller dedupes candidates that are aliases of one file. */
  path: string;
  /** The linkable title: basename, or one of the file's frontmatter aliases. */
  title: string;
  /** Atom: the verbatim capture. Other note: body after frontmatter, capped. */
  body: string;
  tags: string[];
  /** The model's own reason-bearing link prose (atoms only) — weighted ×3 by `shortlist.ts`. */
  links: string[];
  isAtom: boolean;
}

/**
 * The run's candidate set. A plain in-memory list by design (KTD4) with a cheap append (KTD4a).
 */
export class CandidateCorpus {
  readonly notes: CandidateNote[] = [];
  /** Vault reads spent seeding this corpus. One per markdown file, however many captures follow. */
  reads = 0;
  /** Files listed but not openable — Obsidian Sync placeholders, or deleted mid-run. */
  unreadable = 0;

  /**
   * Append a note the run already holds in memory — an atom written earlier in this same run.
   * Never reads the vault: the caller has the capture, tags and link prose it just wrote.
   */
  add(note: CandidateNote): void {
    this.notes.push(note);
  }
}

/** Per-file tags: inline hashtags plus `frontmatter.tags` (string or list), normalised. */
export function tagsFromCache(
  cache: {
    tags?: Array<{ tag: string }>;
    frontmatter?: Record<string, unknown> | null;
  } | null,
): string[] {
  const out = new Set<string>();
  const bump = (raw: string) => {
    const t = normalizeTag(raw);
    if (t) out.add(t);
  };
  for (const entry of cache?.tags ?? []) bump(entry.tag);
  const v = cache?.frontmatter?.tags;
  if (typeof v === "string") {
    for (const part of v.split(/[,\s]+/)) bump(part);
  } else if (Array.isArray(v)) {
    for (const item of v) if (typeof item === "string") bump(item);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Every title this file can be linked by: its basename plus any frontmatter alias.
 *
 * One candidate per title, mirroring `collectLinkTargets` in `context.ts`. A person hub reachable
 * today by alias must stay reachable once a shortlist stands between the vault and the model —
 * narrowing the candidate set is how a hub silently stops being linkable.
 */
function linkTitles(path: string, frontmatter: Record<string, unknown> | null | undefined): string[] {
  const out = new Set<string>([titleFromPath(path)]);
  const aliases = frontmatter?.aliases;
  if (typeof aliases === "string" && aliases.trim()) {
    out.add(aliases.trim());
  } else if (Array.isArray(aliases)) {
    for (const a of aliases) if (typeof a === "string" && a.trim()) out.add(a.trim());
  }
  return [...out];
}

/**
 * Read every markdown file once and assemble the run's scoreable corpus.
 *
 * Unreadable files are counted and skipped, never thrown on. A Sync placeholder appears in the
 * file list but cannot be opened, and a file can be deleted between listing and reading; neither
 * is a reason to abandon a run over the notes that *are* readable.
 */
export async function buildCandidateCorpus(
  app: App,
  opts: { atomFolder: string },
): Promise<CandidateCorpus> {
  // Trailing slash: prefix-scoped, so `AtomsArchive/` is not mistaken for `Atoms/`.
  const atomPrefix = `${clampAtomFolder(opts.atomFolder)}/`;
  const corpus = new CandidateCorpus();

  for (const file of app.vault.getMarkdownFiles()) {
    let raw: string;
    corpus.reads += 1;
    try {
      raw = await app.vault.cachedRead(file);
    } catch {
      corpus.unreadable += 1;
      continue;
    }

    const cache = app.metadataCache.getFileCache(file as TFile);
    const tags = tagsFromCache(cache);
    const isAtom = file.path.startsWith(atomPrefix) && isLinkerGenerated(raw);
    const body = isAtom
      ? extractCaptureBody(raw)
      : bodyAfterFrontmatter(raw).trim().slice(0, NON_ATOM_BODY_CHARS);
    const prose = isAtom ? extractLinkProseRegion(raw) : "";
    const links = prose ? [prose] : [];

    for (const title of linkTitles(file.path, cache?.frontmatter)) {
      corpus.add({ path: file.path, title, body, tags, links, isAtom });
    }
  }

  return corpus;
}
