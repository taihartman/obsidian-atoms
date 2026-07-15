/**
 * Tag vocabulary helpers (U5 / R11).
 * Active list lives in settings (data.json — syncs). Proposed tags never auto-apply.
 */

/** Strip leading # and lowercase for stable comparison. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").toLowerCase();
}

export function sortTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(normalizeTag).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function unionTags(...lists: string[][]): string[] {
  return sortTags(lists.flat());
}

/** Keep only tags that appear in the Active vocabulary (R11). */
export function filterTagsToActive(
  modelTags: string[],
  activeVocabulary: string[],
): string[] {
  const active = new Set(activeVocabulary.map(normalizeTag));
  return sortTags(modelTags.map(normalizeTag).filter((t) => active.has(t)));
}

/**
 * Merge new proposed tags into the pending list (deduped, sorted).
 * Does not touch Active.
 */
export function mergeProposedTags(
  existing: string[],
  incoming: string[],
  activeVocabulary: string[],
): string[] {
  const active = new Set(activeVocabulary.map(normalizeTag));
  const kept = existing.map(normalizeTag).filter((t) => t && !active.has(t));
  for (const raw of incoming) {
    const t = normalizeTag(raw);
    if (t && !active.has(t)) kept.push(t);
  }
  return sortTags(kept);
}

/** Approve a proposed tag → move into Active; remove from proposed. */
export function approveProposedTag(
  tag: string,
  activeVocabulary: string[],
  proposedTags: string[],
): { activeVocabulary: string[]; proposedTags: string[] } {
  const t = normalizeTag(tag);
  const active = sortTags([...activeVocabulary.map(normalizeTag), t]);
  const proposed = sortTags(
    proposedTags.map(normalizeTag).filter((x) => x && x !== t),
  );
  return { activeVocabulary: active, proposedTags: proposed };
}

/** Remove a tag from Active (does not re-add to proposed). */
export function removeActiveTag(
  tag: string,
  activeVocabulary: string[],
): string[] {
  const t = normalizeTag(tag);
  return sortTags(activeVocabulary.map(normalizeTag).filter((x) => x !== t));
}

export function addCustomActiveTag(
  tag: string,
  activeVocabulary: string[],
): string[] {
  return sortTags([...activeVocabulary.map(normalizeTag), normalizeTag(tag)]);
}

export interface TagCount {
  tag: string;
  count: number;
}

export function tagCountsSorted(
  counts: Map<string, number>,
): TagCount[] {
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag: normalizeTag(tag), count }))
    .filter((x) => x.tag)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export const DEFAULT_ACTIVE_VOCABULARY = [
  "idea",
  "question",
  "observation",
  "reference",
  "decision",
] as const;
