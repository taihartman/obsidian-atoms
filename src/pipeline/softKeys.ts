/**
 * Soft entity / index buckets — never form a surfaceable orbit alone,
 * and never create connected kinship by shared chip alone.
 */

const SOFT: readonly string[] = [
  "people",
  "camping",
  "travel",
  "movies",
  "shows",
  "watchlist",
  "index",
  "social",
  "tags",
  "home",
  "archive",
  "templates",
  "app ideas",
  "projects",
];

/** Lowercase soft bucket titles (shared orbits + connected resurface). */
export const SOFT_ENTITY_KEYS: ReadonlySet<string> = new Set(SOFT);

export function isSoftEntityKey(title: string): boolean {
  const k = (title ?? "").trim().toLowerCase();
  if (!k) return false;
  return SOFT_ENTITY_KEYS.has(k);
}

/** Daily note basename YYYY-MM-DD — never an orbit hub. */
export function isDailyBasenameKey(title: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test((title ?? "").trim());
}
