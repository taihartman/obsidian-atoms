import type { App, TFile } from "obsidian";
import type { Capture, VaultContext } from "./types";
import { normalizeTag, sortTags, unionTags } from "./vocabulary";

/**
 * Swappable shortlist seam (KTD6). v1 returns the full title/tag universe;
 * a future BM25 stage only changes this one function.
 */
export interface ContextProvider {
  getCandidates(capture: Capture | string): Promise<{
    titles: string[];
    tags: string[];
  }>;
}

/** Note title for linking: basename without extension. */
export function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/**
 * Collect titles from paths — sorted for byte-stable prefixes (no timestamps).
 */
export function collectTitles(paths: string[]): string[] {
  const titles = paths.map(titleFromPath);
  return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b));
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
}): VaultContext {
  const titles = [...opts.titles].sort((a, b) => a.localeCompare(b));
  const vocabulary = sortTags(opts.activeVocabulary.map(normalizeTag).filter(Boolean));
  // Union of vault tags + Active vocabulary for the prompt tag list (U4).
  const tags = unionTags(opts.vaultTags, vocabulary);
  return { titles, tags, vocabulary };
}

/**
 * v1 ContextProvider: every markdown title + every vault tag.
 * Reads metadataCache synchronously; no index, no embeddings.
 */
export class MetadataContextProvider implements ContextProvider {
  constructor(
    private readonly app: App,
    private readonly getActiveVocabulary: () => string[],
  ) {}

  async getCandidates(
    _capture: Capture | string,
  ): Promise<{ titles: string[]; tags: string[] }> {
    const ctx = this.buildContext();
    return { titles: ctx.titles, tags: ctx.tags };
  }

  buildContext(): VaultContext {
    const files = this.app.vault.getMarkdownFiles();
    const titles = collectTitles(files.map((f: TFile) => f.path));
    const caches = files.map((f: TFile) => ({
      path: f.path,
      cache: this.app.metadataCache.getFileCache(f),
    }));
    const counts = aggregateTagsFromFileCaches(caches);
    const vaultTags = sortTags([...counts.keys()]);
    return buildVaultContext({
      titles,
      vaultTags,
      activeVocabulary: this.getActiveVocabulary(),
    });
  }
}

/** Stable rendered prefix bytes for cache-hit prerequisite (U4 verification). */
export function renderStablePrefix(context: VaultContext): string {
  // Same layout as classify.buildContextUserMessage — keep in sync intentionally
  // via importing that function in callers that need the exact API string.
  const vocab = context.vocabulary.length
    ? context.vocabulary.map((t) => `#${t}`).join(" ")
    : "(none)";
  const tags = context.tags.length
    ? context.tags.map((t) => `#${t}`).join(" ")
    : "(none)";
  const titles = context.titles.length
    ? context.titles.map((t) => `- ${t}`).join("\n")
    : "(empty vault)";
  return [
    "## Vault context (stable prefix — do not include timestamps or run IDs)",
    "",
    "### Active vocabulary",
    vocab,
    "",
    "### Tags present in vault",
    tags,
    "",
    "### Note titles",
    titles,
  ].join("\n");
}
