/**
 * Hub-blocked 2-hop graph expansion — reach for the notes BM25 cannot score (R7, KTD7).
 *
 * A zero-score miss is **absolute**: the capture and the note share no term, so widening `k` can
 * never recover it. The graph can. Walking out from the notes BM25 *did* find reaches a meaningful
 * share of those misses, because a note the user linked to a scored note is related by the user's
 * own hand rather than by vocabulary overlap.
 *
 * **Hubs are reached, never traversed through.** A person hub touches everything, so a path *via*
 * one is evidence that the hub exists, not that two notes are related — one popular hub would
 * otherwise drag the whole vault into the shortlist. A hub may still be *reached* and appear as a
 * candidate; what is forbidden is continuing outward from it. This module does not decide what a
 * hub is: the caller passes the paths, so the plugin keeps exactly one definition of "hub"
 * (`discoverPersonHubs` in `enrich/people.ts`).
 *
 * **This is for daily filing only, and does nothing for backfill.** In a catch-up the only edges
 * that exist are atom → pre-existing hub: links between the atoms of the run are written *during*
 * the run and are not in the graph yet, and the one hop that is available lands on a hub, where
 * traversal stops. Hub-blocked reach in that shape is 0% by construction, so a catch-up path must
 * not turn this on and claim a win from it. `test/expand.test.ts` asserts the zero rather than
 * assuming it.
 *
 * What the mechanism buys on a real daily is deliberately **not** stated as a number here. The reach
 * measurement is trustworthy; the recall figure that accompanied it came off a corpus whose recall
 * moved on padding alone. R7 puts expansion behind a setting so the contribution gets measured in
 * the wild instead of asserted in a comment.
 *
 * Pure: no Obsidian imports. The caller adapts `metadataCache.resolvedLinks` via `buildLinkGraph`.
 */

/** Seeds to walk out from — the studied count. Deeper seeds are weak matches; their neighbours worse. */
export const EXPANSION_SEEDS = 25;

/** Reserved slots expansion may add on top of the scored shortlist, at the studied seed count. */
export const EXPANSION_SLOTS = 32;

/** Hops walked. Two: at three the frontier is the vault, hub-blocked or not. */
export const EXPANSION_HOPS = 2;

/** Undirected adjacency over vault paths. */
export type LinkGraph = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Adapt Obsidian's `resolvedLinks` (source path → target path → count) into undirected adjacency.
 *
 * Undirected on purpose: a note that links *to* a seed is related to it exactly as much as one the
 * seed links to, and Obsidian only indexes the outbound direction.
 *
 * Only *resolved* links are edges. An unresolved wikilink points at a note that does not exist, so
 * it is not a candidate anyway. Links written earlier in this same run are absent until Obsidian
 * reindexes — expansion reaches the vault as it stood when the run began, which is the same
 * conservative footing the corpus is built on.
 */
export function buildLinkGraph(
  resolvedLinks: Record<string, Record<string, number>> | undefined | null,
): LinkGraph {
  const graph = new Map<string, Set<string>>();
  const edge = (a: string, b: string) => {
    let set = graph.get(a);
    if (!set) graph.set(a, (set = new Set<string>()));
    set.add(b);
  };
  for (const [source, targets] of Object.entries(resolvedLinks ?? {})) {
    for (const target of Object.keys(targets ?? {})) {
      if (target === source) continue;
      edge(source, target);
      edge(target, source);
    }
  }
  return graph;
}

export interface ExpandOptions {
  graph: LinkGraph;
  /** Paths that may be reached but never expanded through. */
  hubPaths: ReadonlySet<string>;
  /** Keep a reached path as a candidate. Traversal still passes through a rejected one. */
  accept?: (path: string) => boolean;
  seedLimit?: number;
  slots?: number;
}

/**
 * Paths reached within two hops of the seeds, best-first, capped at `slots`.
 *
 * Order is breadth-first from the seeds in score order, so a one-hop neighbour of the best-scoring
 * seed outranks a two-hop neighbour of the worst — the only ordering signal expansion has, since a
 * reached note has no score by definition.
 *
 * `seedPaths` is the whole shortlist, not just the seeds: everything already shortlisted is marked
 * seen so expansion never returns a note the model was going to be shown anyway. Only the first
 * `seedLimit` of them are walked out from.
 */
export function expandFromSeeds(
  seedPaths: readonly string[],
  { graph, hubPaths, accept, seedLimit = EXPANSION_SEEDS, slots = EXPANSION_SLOTS }: ExpandOptions,
): string[] {
  if (slots <= 0 || seedLimit <= 0) return [];

  const seen = new Set<string>(seedPaths);
  const reached: string[] = [];
  let frontier: string[] = seedPaths.slice(0, seedLimit);

  for (let hop = 1; hop <= EXPANSION_HOPS && frontier.length; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      if (hubPaths.has(node)) continue; // reachable, but not a road (KTD7)
      for (const neighbour of graph.get(node) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
        if (accept && !accept(neighbour)) continue;
        reached.push(neighbour);
        // Full is full: nothing further out can displace what breadth-first already chose.
        if (reached.length >= slots) return reached;
      }
    }
    frontier = next;
  }
  return reached;
}
