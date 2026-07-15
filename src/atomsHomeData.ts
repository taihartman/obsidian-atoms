/**
 * Pure data for Atoms home view: library rows + pending helpers.
 */

export interface AtomLibraryEntry {
  path: string;
  title: string;
  sourceDay: string | null;
  linkChips: string[];
  mtime: number;
}

export interface AtomFileInput {
  path: string;
  mtime: number;
  content: string;
}

const GENERATED_BY_RE = /^generated-by:\s*linker\s*$/m;
const SOURCE_RE = /^source:\s*["']?\[\[([^\]]+)\]\]["']?\s*$/m;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;

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

export function parseAtomLibraryEntry(
  path: string,
  content: string,
  mtime: number,
): AtomLibraryEntry {
  const title = titleFromAtomPath(path);
  const body = bodyAfterFrontmatter(content);
  return {
    path,
    title,
    sourceDay: extractSourceDay(content),
    linkChips: extractLinkChips(body, title),
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
  return entries.filter((e) => e.linkChips.length > 0);
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
