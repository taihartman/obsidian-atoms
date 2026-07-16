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

/**
 * Path segments that **boost** hub score (not exclusive gates).
 * High: Social/, People/. Mild: Personal notes/ (never a free pass alone).
 */
export const PERSON_HUB_BOOST_SEGMENTS = {
  social: "/Social/",
  people: "/People/",
  personalNotes: "/Personal notes/",
} as const;

/** @deprecated alias — prefer PERSON_HUB_BOOST_SEGMENTS / pathHasBoostSegment */
export const PERSON_HUB_PATH_SEGMENTS = [
  PERSON_HUB_BOOST_SEGMENTS.social,
  PERSON_HUB_BOOST_SEGMENTS.people,
  PERSON_HUB_BOOST_SEGMENTS.personalNotes,
] as const;

/** Max hubs sent to the model + repair (score-ranked). */
export const PERSON_HUB_TOP_N = 40;

/**
 * Minimum score to enter the hub set unless under Social/People or tagged #person.
 * Blocks single-word topics like Cooking.md at vault root (base 1 + single-word 2 = 3).
 */
export const PERSON_HUB_MIN_SCORE = 4;

/**
 * Folder path prefixes / segments that never contribute hubs.
 * Dot-prefixed segments (vault configDir and other hidden folders) are
 * denied separately in pathInDenylistFolder — never hardcode `.obsidian`.
 */
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

function pathNorm(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.includes("/") ? normalized : `/${normalized}`;
}

/** True if path sits under any boost segment (Social / People / Personal notes). */
export function pathHasBoostSegment(path: string): boolean {
  const withSlashes = pathNorm(path);
  for (const seg of Object.values(PERSON_HUB_BOOST_SEGMENTS)) {
    if (withSlashes.includes(seg)) return true;
    if (path.startsWith(seg.slice(1))) return true;
  }
  return false;
}

/** @deprecated use pathHasBoostSegment */
export const pathHasAllowlistSegment = pathHasBoostSegment;

export function pathHasSocialBoost(path: string): boolean {
  const n = pathNorm(path);
  return (
    n.includes(PERSON_HUB_BOOST_SEGMENTS.social) ||
    path.startsWith("Social/")
  );
}

export function pathHasPeopleBoost(path: string): boolean {
  const n = pathNorm(path);
  return (
    n.includes(PERSON_HUB_BOOST_SEGMENTS.people) ||
    path.startsWith("People/")
  );
}

export function pathHasPersonalNotesBoost(path: string): boolean {
  const n = pathNorm(path);
  return (
    n.includes(PERSON_HUB_BOOST_SEGMENTS.personalNotes) ||
    path.startsWith("Personal notes/")
  );
}

/** Frontmatter tags include structural #person (string | string[]). */
export function frontmatterHasPersonTag(
  cache: { frontmatter?: Record<string, unknown> | null } | null | undefined,
): boolean {
  const fm = cache?.frontmatter;
  if (!fm || !("tags" in fm)) return false;
  const v = fm.tags;
  const check = (raw: string) => normalizeTag(raw) === "person";
  if (typeof v === "string") {
    return v.split(/[,\s]+/).some(check);
  }
  if (Array.isArray(v)) {
    return v.some((item) => typeof item === "string" && check(item));
  }
  return false;
}

/**
 * Score a person-like candidate. Higher = more likely a real person hub.
 * Pure — used by discovery and unit tests.
 */
export function scorePersonHubCandidate(opts: {
  path: string;
  title: string;
  hasPersonTag: boolean;
}): number {
  const { path, title, hasPersonTag } = opts;
  let score = 1; // base person-like
  if (pathHasSocialBoost(path)) score += 10;
  if (pathHasPeopleBoost(path)) score += 8;
  if (pathHasPersonalNotesBoost(path)) score += 1;
  if (hasPersonTag) score += 5;
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) score += 2;
  if (words.length >= 3) score -= 2;
  return score;
}

/** Whether score + path/tag signals clear the discovery floor. */
export function meetsPersonHubThreshold(opts: {
  score: number;
  path: string;
  hasPersonTag: boolean;
}): boolean {
  if (opts.hasPersonTag) return true;
  if (pathHasSocialBoost(opts.path) || pathHasPeopleBoost(opts.path)) {
    return true;
  }
  return opts.score >= PERSON_HUB_MIN_SCORE;
}

export function pathInDenylistFolder(path: string): boolean {
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    // Vault configDir is user-configurable (not always `.obsidian`).
    if (part.startsWith(".")) return true;
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
 * Discover person hubs: denylist + person-like basename, then **score → threshold → top N**.
 * Path segments boost rank (Social/People high); they are not exclusive gates.
 * On basename collision, keep the higher-scoring path.
 */
export function discoverPersonHubs(files: PersonHubFile[]): PersonHub[] {
  type Candidate = PersonHub & { score: number };
  const byCanonical = new Map<string, Candidate>();

  for (const f of files) {
    const path = f.path.replace(/\\/g, "/");
    if (!path.toLowerCase().endsWith(".md")) continue;
    if (pathInDenylistFolder(path)) continue;

    const canonicalTitle = basenameTitle(path);
    if (!isPersonLikeBasename(canonicalTitle)) continue;

    const hasPersonTag = frontmatterHasPersonTag(f.cache ?? null);
    const score = scorePersonHubCandidate({
      path,
      title: canonicalTitle,
      hasPersonTag,
    });
    if (!meetsPersonHubThreshold({ score, path, hasPersonTag })) continue;

    const matchKeys = uniqueKeys([
      canonicalTitle,
      ...aliasesFromCache(f.cache ?? null),
    ]);

    const existing = byCanonical.get(canonicalTitle.toLowerCase());
    if (existing) {
      if (score > existing.score) {
        byCanonical.set(canonicalTitle.toLowerCase(), {
          canonicalTitle,
          matchKeys,
          path,
          score,
        });
      }
      continue;
    }

    byCanonical.set(canonicalTitle.toLowerCase(), {
      canonicalTitle,
      matchKeys,
      path,
      score,
    });
  }

  return [...byCanonical.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.canonicalTitle.localeCompare(b.canonicalTitle);
    })
    .slice(0, PERSON_HUB_TOP_N)
    .map(({ score: _s, ...hub }) => hub)
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
