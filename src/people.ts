/**
 * Vault-aware person hubs: deterministic discovery + post-classify repair.
 * Paths stay local; model payload only sees canonical titles.
 */

import type { ClassificationResult } from "./types";
import { normalizeTag, sortTags } from "./vocabulary";

function basenameTitle(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

export type PersonHubFile = {
  path: string;
  cache?: { frontmatter?: Record<string, unknown> | null } | null;
};

export type PersonHub = {
  /** Preferred links[].note (markdown basename). */
  canonicalTitle: string;
  /** Basename + aliases used for capture matching. */
  matchKeys: string[];
  /** Source vault path — never sent to the model. */
  path: string;
};

/** Path segment allowlist (KTD-P3). Case-sensitive on segment names as in plan. */
export const PERSON_HUB_PATH_SEGMENTS = [
  "/Social/",
  "/People/",
  "/Personal notes/",
] as const;

/** Folder path prefixes / segments that never contribute hubs. */
export const PERSON_HUB_DENY_FOLDER_PARTS = [
  "Atoms",
  "Quick Notes",
  "Daily",
  "Excalidraw",
  "Templates",
  "Projects",
  "Plans",
  "Tags",
  "Archive",
  "Recipes",
  ".obsidian",
] as const;

export const PERSON_HUB_DENY_TITLES = new Set(
  [
    "Untitled",
    "Vault",
    "CLAUDE",
    "People",
    "Social",
    "Index",
    "Home",
    "README",
    "Tags",
    "Templates",
    "Archive",
    "Daily",
    "Atoms",
  ].map((t) => t.toLowerCase()),
);

export function pathHasAllowlistSegment(path: string): boolean {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Also match "Personal notes/" at start without leading slash variants
  const withSlashes = normalized.includes("/")
    ? normalized
    : `/${normalized}`;
  for (const seg of PERSON_HUB_PATH_SEGMENTS) {
    if (withSlashes.includes(seg)) return true;
    // Root-level "Personal notes/Tin.md"
    if (path.startsWith(seg.slice(1))) return true;
  }
  return false;
}

export function pathInDenylistFolder(path: string): boolean {
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    if (
      PERSON_HUB_DENY_FOLDER_PARTS.some(
        (d) => d.toLowerCase() === part.toLowerCase(),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Conservative person-like basename (1–3 words, capital start, not acronym/date). */
export function isPersonLikeBasename(title: string): boolean {
  const t = title.trim();
  if (!t || PERSON_HUB_DENY_TITLES.has(t.toLowerCase())) return false;
  if (/^\d{4}([-/]\d{2}){1,2}/.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  // All-caps acronyms (2+ letters)
  if (/^[A-Z]{2,}$/.test(t.replace(/\s+/g, ""))) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  const first = words[0]!;
  if (!/^[A-ZÀ-ÖØ-Þ]/.test(first)) return false;
  // Reject pure lowercase multi-word topics
  if (words.every((w) => w === w.toLowerCase())) return false;
  return true;
}

/** Same alias extraction shape as collectLinkTargets. */
export function aliasesFromCache(
  cache: { frontmatter?: Record<string, unknown> | null } | null | undefined,
): string[] {
  const out: string[] = [];
  const aliases = cache?.frontmatter?.aliases;
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
 * Discover person hubs under allowlisted paths only (KTD-P3).
 * On basename collision, prefer allowlisted path order; skip ambiguous auto-repair
 * by keeping first preferred and not merging match keys across different files.
 */
export function discoverPersonHubs(files: PersonHubFile[]): PersonHub[] {
  type Candidate = PersonHub & { rank: number };
  const byCanonical = new Map<string, Candidate>();

  for (const f of files) {
    const path = f.path.replace(/\\/g, "/");
    if (!path.toLowerCase().endsWith(".md")) continue;
    if (pathInDenylistFolder(path)) continue;
    if (!pathHasAllowlistSegment(path)) continue;

    const canonicalTitle = basenameTitle(path);
    if (!isPersonLikeBasename(canonicalTitle)) continue;

    const matchKeys = uniqueKeys([
      canonicalTitle,
      ...aliasesFromCache(f.cache ?? null),
    ]);

    // Prefer deeper Social/People paths over generic Personal notes when colliding
    let rank = 0;
    if (path.includes("/Social/")) rank += 3;
    if (path.includes("/People/")) rank += 2;
    if (path.includes("/Personal notes/") || path.startsWith("Personal notes/"))
      rank += 1;

    const existing = byCanonical.get(canonicalTitle.toLowerCase());
    if (existing) {
      if (rank > existing.rank) {
        byCanonical.set(canonicalTitle.toLowerCase(), {
          canonicalTitle,
          matchKeys,
          path,
          rank,
        });
      }
      // Same basename, different path, equal/lower rank: leave existing; ambiguous skip is rare
      continue;
    }

    byCanonical.set(canonicalTitle.toLowerCase(), {
      canonicalTitle,
      matchKeys,
      path,
      rank,
    });
  }

  return [...byCanonical.values()]
    .map(({ rank: _r, ...hub }) => hub)
    .sort((a, b) => a.canonicalTitle.localeCompare(b.canonicalTitle));
}

export function personHubTitles(hubs: PersonHub[]): string[] {
  return hubs.map((h) => h.canonicalTitle).sort((a, b) => a.localeCompare(b));
}

function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const t = k.trim();
    if (!t) continue;
    const low = t.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(t);
  }
  // Longest first for matching
  return out.sort((a, b) => b.length - a.length);
}

const PREFERENCE_OR_RELATION_RE =
  /\b(likes?|liked|prefers?|preferred|favorite|favourite|hates?|hated|always|never|usually|tends? to|enjoys?|dislikes?|loves?|loves?d)\b/i;

const STRUCTURAL_PERSON_TAGS = new Set(["person", "preferences", "relationship"]);

function hasStructuralPersonSignal(result: ClassificationResult): boolean {
  return (result.tags ?? []).some((t) =>
    STRUCTURAL_PERSON_TAGS.has(normalizeTag(t)),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match hub key in capture with word boundaries; allow possessive 's / ’s. */
export function captureMentionsKey(captureText: string, key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(k)}(?:['’]s)?(?![\\p{L}\\p{N}_])`,
    "iu",
  );
  return pattern.test(captureText);
}

function personShaped(captureText: string, result: ClassificationResult): boolean {
  if (hasStructuralPersonSignal(result)) return true;
  if (PREFERENCE_OR_RELATION_RE.test(captureText)) return true;
  // Title-centric claim: atom title mentions a capitalised name-like token already
  // handled via match; require preference/structural above for bare co-occurrence.
  // Conservative: if title is non-empty and looks like a person claim (contains "prefer"/"like" etc.)
  if (result.title && PREFERENCE_OR_RELATION_RE.test(result.title)) return true;
  return false;
}

function linkTargetsHub(
  result: ClassificationResult,
  canonicalTitle: string,
): boolean {
  const want = canonicalTitle.toLowerCase();
  return (result.links ?? []).some((l) => l.note.trim().toLowerCase() === want);
}

/**
 * Post-classify repair (KTD-P1, P4, P5). Never changes verdict or title.
 */
export function enrichPersonLinks(
  captureText: string,
  result: ClassificationResult,
  hubs: PersonHub[],
): ClassificationResult {
  if (!hubs.length) return result;
  if (result.verdict !== "atom") return result;
  if (!personShaped(captureText, result)) return result;

  let tags = [...(result.tags ?? [])];
  let links = [...(result.links ?? [])];
  let changed = false;

  // Process hubs by longest match key overall to reduce partial collisions
  const ordered = [...hubs].sort((a, b) => {
    const la = Math.max(0, ...a.matchKeys.map((k) => k.length));
    const lb = Math.max(0, ...b.matchKeys.map((k) => k.length));
    return lb - la;
  });

  for (const hub of ordered) {
    const matchedKey = hub.matchKeys.find((k) =>
      captureMentionsKey(captureText, k),
    );
    if (!matchedKey) continue;
    if (linkTargetsHub({ ...result, links }, hub.canonicalTitle)) {
      // still ensure #person if linked
      if (!tags.some((t) => normalizeTag(t) === "person")) {
        tags = sortTags([...tags, "person"]);
        changed = true;
      }
      continue;
    }

    const reason =
      matchedKey.toLowerCase() === hub.canonicalTitle.toLowerCase()
        ? `preference or claim about [[${hub.canonicalTitle}]]`
        : `about [[${hub.canonicalTitle}]] (matched “${matchedKey}”)`;

    links = [
      ...links,
      {
        note: hub.canonicalTitle,
        reason,
      },
    ];
    if (!tags.some((t) => normalizeTag(t) === "person")) {
      tags = sortTags([...tags, "person"]);
    }
    changed = true;
  }

  if (!changed) return result;
  return {
    ...result,
    tags,
    links,
  };
}

/** Build PersonHub[] from title list only (tests / when full files unavailable). */
export function hubsFromTitles(
  titles: string[],
  matchKeyMap?: Record<string, string[]>,
): PersonHub[] {
  return titles
    .map((canonicalTitle) => ({
      canonicalTitle,
      matchKeys: uniqueKeys([
        canonicalTitle,
        ...(matchKeyMap?.[canonicalTitle] ?? []),
      ]),
      path: `${canonicalTitle}.md`,
    }))
    .sort((a, b) => a.canonicalTitle.localeCompare(b.canonicalTitle));
}
