/**
 * Tag vocabulary helpers (U5 / R11).
 * Active list lives in settings (data.json — syncs). Proposed tags never auto-apply.
 *
 * Structural tags are always eligible for apply even if the user never curated
 * a list — so people/preferences "just work" without setup (tasteful defaults).
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

/**
 * Always-on product vocabulary — not open-ended AI tags.
 * Safe to auto-apply when the model chooses them.
 */
export const STRUCTURAL_TAGS = [
  "person",
  "preferences",
  "relationship",
  // Media / list dumps — always eligible so old Active lists still get smart tags
  "watch",
  "movie",
  "show",
  "media",
  "list",
] as const;

/** Tags the model may apply: structural ∪ user Active. */
export function eligibleTags(activeVocabulary: string[]): string[] {
  return unionTags([...STRUCTURAL_TAGS], activeVocabulary);
}

/** Keep only tags that are eligible (structural ∪ Active) — R11 with smart defaults. */
export function filterTagsToActive(
  modelTags: string[],
  activeVocabulary: string[],
): string[] {
  const allowed = new Set(eligibleTags(activeVocabulary));
  return sortTags(modelTags.map(normalizeTag).filter((t) => allowed.has(t)));
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

/**
 * Longest tag the user may type. Active tags are not just a label on a note — `eligibleTags()`
 * hands them to the classify prompt, so an unbounded field is an unbounded prompt. 48 characters
 * fits any real tag (`project-alpha-migration-2026` is 28) and refuses a pasted paragraph.
 */
export const MAX_CUSTOM_TAG_LENGTH = 48;

/**
 * Letters, then letters / digits / `-` `_` `/`, in any script. Deliberately narrower than what
 * Obsidian itself renders: emoji and punctuation are legal in a vault tag but end up quoted into
 * the classify prompt, and a leading digit is not a tag Obsidian accepts either.
 */
const CUSTOM_TAG_SHAPE = /^\p{L}[\p{L}\p{N}_\-/]*$/u;

export type CustomTagCheck =
  | { ok: true; tag: string }
  | { ok: false; reason: string };

/**
 * Whether a typed tag may enter Active, and what to tell the user when it may not.
 *
 * Separate from `normalizeTag`, which many callers rely on to be a pure lowercase-and-strip and
 * which must keep accepting whatever a vault or a model already produced. This is the gate on
 * the one path where a human types something new.
 */
export function checkCustomTag(raw: string): CustomTagCheck {
  const tag = normalizeTag(raw);
  if (!tag) {
    return { ok: false, reason: "Type a tag first. Letters, then letters, numbers, - _ or /." };
  }
  if (tag.length > MAX_CUSTOM_TAG_LENGTH) {
    return {
      ok: false,
      reason: `That tag is ${tag.length} characters. Keep it under ${MAX_CUSTOM_TAG_LENGTH}.`,
    };
  }
  if (!CUSTOM_TAG_SHAPE.test(tag)) {
    return {
      ok: false,
      reason: `“${tag}” is not a usable tag. Start with a letter, then letters, numbers, - _ or /.`,
    };
  }
  return { ok: true, tag };
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
  "person",
  "preferences",
  "relationship",
] as const;
