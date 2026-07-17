/**
 * Pure closed-neighborhood set + Global Graph search query for Open atom graph.
 */

import {
  isGeneratedAtomContent,
  isUnderAtomFolder,
} from "../home/atomsHomeData";

/** Soft caps for stock Graph search box (KTD5). */
export const GRAPH_QUERY_MAX_CHARS = 3000;
export const GRAPH_QUERY_MAX_TERMS = 80;

const SOURCE_RE = /^source:\s*["']?\[\[([^\]]+)\]\]["']?\s*$/m;

export type AtomFileLike = { path: string; content: string };

export type GraphQueryResult = {
  query: string;
  mode: "exact" | "capped";
  /** External (non-atom-folder) paths dropped by cap. */
  omittedExternal: number;
};

/** Note name from atom frontmatter `source: "[[…]]"` (basename, no path). */
export function parseSourceNoteName(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(SOURCE_RE);
  const name = m?.[1]?.trim();
  return name || null;
}

/**
 * Drop outbound target when it is only the FM source stamp, not a body link.
 * If `sourceTargetPath` is null, returns outbound unchanged.
 */
export function filterSourceOnlyOutbound(
  outboundPaths: string[],
  sourceTargetPath: string | null | undefined,
  bodyOutboundPaths: string[],
): string[] {
  if (!sourceTargetPath) return [...outboundPaths];
  const body = new Set(bodyOutboundPaths);
  return outboundPaths.filter(
    (p) => p !== sourceTargetPath || body.has(p),
  );
}

/** Linker atoms under atom folder (library stamp rule). */
export function collectAtomSeedPaths(
  files: AtomFileLike[],
  atomFolder: string,
): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!isUnderAtomFolder(f.path, atomFolder)) continue;
    if (!isGeneratedAtomContent(f.content)) continue;
    out.push(f.path);
  }
  return out.sort();
}

/**
 * Closed neighborhood: seeds ∪ 1-hop (filtered outbound + inbound).
 * Paths are opaque strings; caller resolves files.
 */
export function buildClosedNeighborhood(opts: {
  seedPaths: string[];
  outboundBySeed: Record<string, string[]>;
  bodyOutboundBySeed: Record<string, string[]>;
  sourceTargetBySeed: Record<string, string | null | undefined>;
  inboundBySeed: Record<string, string[]>;
}): string[] {
  const S = new Set<string>();
  for (const seed of opts.seedPaths) {
    S.add(seed);
    const filtered = filterSourceOnlyOutbound(
      opts.outboundBySeed[seed] ?? [],
      opts.sourceTargetBySeed[seed],
      opts.bodyOutboundBySeed[seed] ?? [],
    );
    for (const p of filtered) S.add(p);
    for (const p of opts.inboundBySeed[seed] ?? []) S.add(p);
  }
  return [...S].sort();
}

function pathTerm(p: string): string {
  return `path:"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Prefer exact OR of every path in S. On size cap: `path:atomFolder` plus as many
 * external neighbors as fit; report omitted external count.
 */
export function toGraphSearchQuery(
  paths: string[],
  atomFolder: string,
  opts?: { maxChars?: number; maxTerms?: number },
): GraphQueryResult {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  const unique = [...new Set(paths.filter(Boolean))].sort();
  const maxChars = opts?.maxChars ?? GRAPH_QUERY_MAX_CHARS;
  const maxTerms = opts?.maxTerms ?? GRAPH_QUERY_MAX_TERMS;

  if (unique.length === 0) {
    return { query: pathTerm(folder), mode: "capped", omittedExternal: 0 };
  }

  const exact = unique.map(pathTerm).join(" OR ");
  if (unique.length <= maxTerms && exact.length <= maxChars) {
    return { query: exact, mode: "exact", omittedExternal: 0 };
  }

  const external = unique.filter((p) => !isUnderAtomFolder(p, folder));
  const parts: string[] = [pathTerm(folder)];
  let q = parts[0]!;
  let includedExt = 0;
  for (const p of external) {
    const next = `${q} OR ${pathTerm(p)}`;
    if (parts.length + 1 > maxTerms || next.length > maxChars) break;
    parts.push(pathTerm(p));
    q = next;
    includedExt++;
  }
  return {
    query: parts.join(" OR "),
    mode: "capped",
    omittedExternal: Math.max(0, external.length - includedExt),
  };
}

/** Folder-only fallback query (filter apply failure). */
export function atomFolderGraphQuery(atomFolder: string): string {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  return pathTerm(folder);
}
