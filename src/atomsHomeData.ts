/**
 * Pure data for Atoms home view: library rows + pending helpers.
 */

/** Home-row chip role — person (warm) vs work/media (cool). */
export type LinkChipRole = "person" | "work";

export type DisplayLinkChip = {
  label: string;
  role: LinkChipRole;
};

export interface AtomLibraryEntry {
  path: string;
  title: string;
  sourceDay: string | null;
  /** All body wikilinks (resurface / graph). */
  linkChips: string[];
  /** Home display: max 2, typed person|work, model order. */
  displayChips: DisplayLinkChip[];
  mtime: number;
}

export interface AtomFileInput {
  path: string;
  mtime: number;
  content: string;
}

/** Max chips on a library row (home-v2). */
export const HOME_CHIP_MAX = 2;

const GENERATED_BY_RE = /^generated-by:\s*linker\s*$/m;
const SOURCE_RE = /^source:\s*["']?\[\[([^\]]+)\]\]["']?\s*$/m;
const TAGS_LINE_RE = /^tags:\s*$/m;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
const DATE_TITLE_RE = /^\d{4}-\d{2}-\d{2}/;
const JUNK_TITLES = new Set([
  "user link",
  "untitled",
  "index",
  "home",
  "tags",
]);

/** Basename without .md */
export function titleFromAtomPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

export function isUnderAtomFolder(path: string, atomFolder: string): boolean {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  return path === folder || path.startsWith(`${folder}/`);
}

/** Prefer files stamped by our writer (KTD-V3). */
export function isGeneratedAtomContent(content: string): boolean {
  // Frontmatter block only
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 400) : content.slice(0, end + 4);
  return GENERATED_BY_RE.test(fm);
}

export function extractSourceDay(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(SOURCE_RE);
  if (!m?.[1]) return null;
  const name = m[1].trim();
  // Daily basenames are often YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(name)) return name.slice(0, 10);
  return name;
}

/** Body after frontmatter (or full content if none). */
export function bodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\s*\n/, "");
}

/**
 * Wikilinks in body; exclude self-title; dedupe case-insensitively; preserve first casing.
 */
export function extractLinkChips(body: string, selfTitle: string): string[] {
  const self = selfTitle.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const note = (m[1] ?? "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (key === self) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/** Tags from frontmatter list (for chip typing hints). */
export function extractFrontmatterTags(content: string): string[] {
  if (!content.startsWith("---")) return [];
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const tags: string[] = [];
  const lines = fm.split(/\r?\n/);
  let inTags = false;
  for (const line of lines) {
    if (/^tags:\s*\[\]\s*$/.test(line)) return [];
    if (/^tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        tags.push(item[1]!.trim().replace(/^#/, "").toLowerCase());
        continue;
      }
      if (/^\w/.test(line)) break;
    }
  }
  return tags;
}

/**
 * "Ning is the strong Asian guy…" → "Ning" for a glance chip.
 * Full claim title still lives in the note / backlinks.
 */
export function personNameFromClaimTitle(note: string): string | null {
  const n = note.trim();
  if (!n) return null;
  // Name is/was/has/'s …
  const m = n.match(
    /^([A-Za-z][A-Za-z'-]{1,24})(?:\s+([A-Za-z][A-Za-z'-]{1,24}))?\s+(is|was|has|'s)\b/i,
  );
  if (m) {
    return m[2] ? `${m[1]} ${m[2]}` : m[1]!;
  }
  return null;
}

function isPersonContext(contextBefore: string, tags: string[]): boolean {
  const ctx = (contextBefore ?? "").toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  return (
    tagSet.has("person") ||
    /\b(person|people|friend|about |preference about|matched|told me|recommended|hub|relates to this note about)\b/.test(
      ctx,
    )
  );
}

function isMediaContext(contextBefore: string, tags: string[]): boolean {
  const ctx = (contextBefore ?? "").toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  return (
    tagSet.has("watch") ||
    tagSet.has("show") ||
    tagSet.has("movie") ||
    tagSet.has("media") ||
    /\b(media work|watch|show|movie|anime|film|series|listen|read)\b/.test(ctx)
  );
}

/**
 * Coarse role for home chips from surrounding reason prose + tags.
 * Returns null = demote (related claim / junk / date) — not shown on home.
 * Long person-claim titles are handled in extractDisplayLinkChips via short name.
 */
export function classifyLinkRole(
  note: string,
  contextBefore: string,
  tags: string[] = [],
): LinkChipRole | null {
  const n = note.trim();
  const key = n.toLowerCase();
  if (!n) return null;
  if (DATE_TITLE_RE.test(n)) return null;
  if (JUNK_TITLES.has(key)) return null;

  const mediaCtx = isMediaContext(contextBefore, tags);
  const personCtx = isPersonContext(contextBefore, tags);
  const long = n.length > 32 || n.split(/\s+/).length > 4;

  if (long) {
    // Long titles are not full chips — person short-name handled by caller
    return null;
  }

  if (mediaCtx && !personCtx) return "work";
  if (personCtx && !mediaCtx) return "person";
  if (mediaCtx && personCtx) {
    if (n.split(/\s+/).length <= 2 && !/\b(the|a|an)\b/i.test(n))
      return "person";
    return "work";
  }

  if (n.split(/\s+/).length <= 2) return "person";
  return "work";
}

/**
 * Home chips: model/body order, type person|work only, max HOME_CHIP_MAX.
 * Long claim titles usually demoted — except person claims shortened to a name
 * (Sherry → [[Ning is the strong…]] shows as chip "Ning").
 */
export function extractDisplayLinkChips(
  body: string,
  selfTitle: string,
  tags: string[] = [],
  max: number = HOME_CHIP_MAX,
): DisplayLinkChip[] {
  const self = selfTitle.trim().toLowerCase();
  const seen = new Set<string>();
  const out: DisplayLinkChip[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const note = (m[1] ?? "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (key === self) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, (m.index ?? 0) - 100);
    const contextBefore = body.slice(start, m.index ?? 0);
    const role = classifyLinkRole(note, contextBefore, tags);
    if (role) {
      out.push({ label: note, role });
    } else {
      // Person-claim atom titles: surface short name when context is social
      const short = personNameFromClaimTitle(note);
      if (
        short &&
        short.toLowerCase() !== self &&
        isPersonContext(contextBefore, tags)
      ) {
        const sk = short.toLowerCase();
        if (!seen.has(`person:${sk}`)) {
          seen.add(`person:${sk}`);
          out.push({ label: short, role: "person" });
        }
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

export function parseAtomLibraryEntry(
  path: string,
  content: string,
  mtime: number,
): AtomLibraryEntry {
  const title = titleFromAtomPath(path);
  const body = bodyAfterFrontmatter(content);
  const tags = extractFrontmatterTags(content);
  return {
    path,
    title,
    sourceDay: extractSourceDay(content),
    linkChips: extractLinkChips(body, title),
    displayChips: extractDisplayLinkChips(body, title, tags),
    mtime,
  };
}

export function listAtomLibraryEntries(
  files: AtomFileInput[],
  atomFolder: string,
  opts?: { max?: number; requireGeneratedBy?: boolean },
): AtomLibraryEntry[] {
  const max = opts?.max ?? 100;
  const requireGenerated = opts?.requireGeneratedBy !== false;
  const entries: AtomLibraryEntry[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".md")) continue;
    if (!isUnderAtomFolder(f.path, atomFolder)) continue;
    if (requireGenerated && !isGeneratedAtomContent(f.content)) continue;
    entries.push(parseAtomLibraryEntry(f.path, f.content, f.mtime));
  }
  entries.sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title));
  return entries.slice(0, max);
}

export function filterLinkedOnly(entries: AtomLibraryEntry[]): AtomLibraryEntry[] {
  // "Linked" = has a home-surfaceable person/work chip (not demoted claims)
  return entries.filter((e) => e.displayChips.length > 0);
}

export function shouldShowWaitCard(unprocessedCount: number): boolean {
  return unprocessedCount > 0;
}

/** Relative time label for library rows (en-US-ish, compact). */
export function formatRelativeTime(mtimeMs: number, nowMs: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000));
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yest.";
  if (day < 7) return `${day}d`;
  return new Date(mtimeMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function queuePeekTexts(
  notes: Array<{ unprocessed: Array<{ text: string }>; date: string }>,
  max = 3,
): Array<{ text: string; date: string }> {
  const out: Array<{ text: string; date: string }> = [];
  for (const n of notes) {
    for (const c of n.unprocessed) {
      out.push({
        text: c.text.split("\n")[0]?.slice(0, 120) ?? "",
        date: n.date,
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}
