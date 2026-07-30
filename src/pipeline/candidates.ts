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
import {
  aliasesForFrontmatter,
  tagsForFileCache,
  titleFromPath,
  type TaggableFileCache,
} from "./context";
import { isLinkerGenerated } from "./atomQuality";
import { extractLinkProseRegion } from "./parseLinkProse";
import { bodyAfterFrontmatter, extractCaptureBody } from "./refreshAtoms";
import { clampAtomFolder } from "./render";
import { Bm25Index, type ScoreableNote } from "./shortlist";

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
  /**
   * The BM25F index over `notes`, extended by `add()` so it can never disagree with them.
   *
   * Held here rather than rebuilt per capture: tokenising the corpus is corpus-invariant work, and
   * a catch-up scores thousands of captures against it (KTD4). Replaced wholesale on `upsert`
   * (Bm25Index has no remove).
   */
  index = new Bm25Index<CandidateNote>();
  /**
   * Distinct paths in the corpus. Maintained on append because the alternative — deriving it from
   * `notes` — is an O(corpus) rebuild every time graph expansion asks whether a reached path is a
   * safe link target, which is once per capture.
   */
  readonly paths = new Set<string>();
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
    this.paths.add(note.path);
    this.index.add(note);
  }

  /**
   * Replace every corpus entry for `note.path` (and any paths in `alsoDrop`) with this note.
   *
   * Used when a refresh refiles an atom in place or renames it: the seed entry's tags/link prose
   * (or the old path after a rename) must not keep ranking against the capture that just moved.
   * Rebuilds the standing BM25 index so scores stay equivalent to a full re-seed.
   */
  upsert(note: CandidateNote, alsoDrop: readonly string[] = []): void {
    const drop = new Set<string>([note.path, ...alsoDrop]);
    const kept = this.notes.filter((n) => !drop.has(n.path));
    this.notes.length = 0;
    this.paths.clear();
    // Fresh index: Bm25Index has no remove, and a partial edit would desync df/lengthSums.
    this.index = new Bm25Index<CandidateNote>();
    for (const n of kept) this.add(n);
    this.add(note);
  }
}

/** The file's distinct tags, sorted — the shared per-file reading, deduped for the `tags` field. */
export function tagsFromCache(cache: TaggableFileCache | null): string[] {
  return [...new Set(tagsForFileCache(cache))].sort((a, b) => a.localeCompare(b));
}

/**
 * Every title this file can be linked by: its basename plus any frontmatter alias.
 *
 * One candidate per title, on the same alias reading `collectLinkTargets` uses. A person hub
 * reachable today by alias must stay reachable once a shortlist stands between the vault and the
 * model — narrowing the candidate set is how a hub silently stops being linkable.
 */
function linkTitles(path: string, frontmatter: Record<string, unknown> | null | undefined): string[] {
  return [...new Set([titleFromPath(path), ...aliasesForFrontmatter(frontmatter)])];
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
