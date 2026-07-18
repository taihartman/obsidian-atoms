/**
 * Pure data for Atoms home view: library rows + pending helpers.
 */

import {
  CURRENT_ATOMS_QUALITY,
  isEligibleForUpdate,
} from "../pipeline/atomQuality";
import { isPolishableContent } from "../pipeline/refreshAtoms";
import { parseCaptures } from "../pipeline/parse";
import { resolveCreatedField } from "../pipeline/render";

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
  /**
   * Sort + relative-time clock for Recents.
   * Prefer frontmatter `created` (not file mtime) so Update notes does not
   * make every row say “5m ago”.
   */
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

const CREATED_RE = /^created:\s*(.+)$/m;

/**
 * Parse atom `created` frontmatter to epoch ms.
 * Accepts `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm(:ss)?` (local wall clock).
 */
export function parseCreatedMs(content: string): number | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(CREATED_RE);
  if (!m?.[1]) return null;
  const raw = m[1].trim().replace(/^["']|["']$/g, "");
  const dayOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayOnly) {
    const y = Number(dayOnly[1]);
    const mo = Number(dayOnly[2]);
    const d = Number(dayOnly[3]);
    if (!y || !mo || !d) return null;
    return new Date(y, mo - 1, d, 12, 0, 0, 0).getTime();
  }
  const withTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (withTime) {
    const y = Number(withTime[1]);
    const mo = Number(withTime[2]);
    const d = Number(withTime[3]);
    const h = Number(withTime[4]);
    const mi = Number(withTime[5]);
    const s = Number(withTime[6] ?? 0);
    return new Date(y, mo - 1, d, h, mi, s, 0).getTime();
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Library sort/display clock: `created` → source day noon → file mtime.
 * Update notes must not reshuffle Recents via file mtime.
 */
export function libraryTimeMs(content: string, fileMtimeMs: number): number {
  const created = parseCreatedMs(content);
  if (created != null && Number.isFinite(created)) return created;
  const day = extractSourceDay(content);
  if (day && /^\d{4}-\d{2}-\d{2}/.test(day)) {
    const y = Number(day.slice(0, 4));
    const mo = Number(day.slice(5, 7));
    const d = Number(day.slice(8, 10));
    if (y && mo && d) return new Date(y, mo - 1, d, 12, 0, 0, 0).getTime();
  }
  return fileMtimeMs;
}

/** True when `created` is day-only (needs within-day order backfill). */
export function isDayOnlyCreated(content: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(CREATED_RE);
  if (!m?.[1]) return false;
  const raw = m[1].trim().replace(/^["']|["']$/g, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

/**
 * Capture text first line from atom body (before link-prose blank line).
 * Used to body-match the source daily — not the ↳ marker title.
 */
export function atomCaptureFirstLine(content: string): string {
  const body = bodyAfterFrontmatter(content);
  const capturePart = (body.split(/\n\n/)[0] ?? body).trimEnd();
  return (capturePart.split("\n")[0] ?? "").trim();
}

/** Rewrite only the `created:` frontmatter line; body untouched. */
export function rewriteCreatedFrontmatter(
  content: string,
  created: string,
): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  const fm = content.slice(0, end + 4);
  const rest = content.slice(end + 4);
  if (!CREATED_RE.test(fm)) return content;
  const nextFm = fm.replace(CREATED_RE, `created: ${created}`);
  return nextFm + rest;
}

/**
 * If atom has day-only `created`, re-stamp from source daily bullet position
 * (body match). Null when no change or no unique match.
 */
export function planCreatedOrderBackfill(
  atomContent: string,
  dailyContent: string,
  dailyDate: string,
): { content: string; created: string } | null {
  if (!isDayOnlyCreated(atomContent)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dailyDate)) return null;
  const needle = atomCaptureFirstLine(atomContent);
  if (!needle) return null;

  const caps = parseCaptures(dailyContent);
  const matches = caps.filter(
    (c) => (c.text.split("\n")[0] ?? "").trim() === needle,
  );
  if (matches.length !== 1) return null;
  const cap = matches[0]!;
  const created = resolveCreatedField(
    dailyDate,
    cap.timestamp,
    cap.startLine,
  );
  const content = rewriteCreatedFrontmatter(atomContent, created);
  if (content === atomContent) return null;
  return { content, created };
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
    mtime: libraryTimeMs(content, mtime),
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

/** Count linker atoms with atoms-quality missing or below CURRENT (batch cap separate). */
export function countEligibleUpdateNotes(
  contents: string[],
  current: number = CURRENT_ATOMS_QUALITY,
): number {
  let n = 0;
  for (const c of contents) {
    if (isEligibleForUpdate(c, current)) n += 1;
  }
  return n;
}

/**
 * Work remaining for Update strip: refile debt (q < CURRENT) + polishable links.
 * Does not double-count for display when both — total = refile + polishable.
 */
export function countUpdateWorkRemaining(
  entries: Array<{ content: string; title: string }>,
  current: number = CURRENT_ATOMS_QUALITY,
): { refile: number; polishable: number; total: number } {
  let refile = 0;
  let polishable = 0;
  for (const e of entries) {
    if (isEligibleForUpdate(e.content, current)) refile += 1;
    if (isPolishableContent(e.content, e.title)) polishable += 1;
  }
  return { refile, polishable, total: refile + polishable };
}

/** Strip copy for Update notes (product strings). */
export function updateNotesStripCopy(eligibleCount: number): {
  title: string;
  body: string;
  button: string;
} {
  const n = Math.max(0, eligibleCount);
  return {
    title: "Filing got smarter",
    body:
      n === 0
        ? "Older notes can use the new linking."
        : n === 1
          ? "Update 1 older note to match? Titles and links may improve. Your original text stays the same."
          : n >= 50
            ? "Older notes can use the new linking. We’ll start with the ones that matter most."
            : `Update ${n} older notes to match? Titles and links may improve. Your original text stays the same.`,
    button: "Update",
  };
}

export type UpdateConfirmOpts = {
  /** AI refile slots this pass (≤ batch limit). */
  refileBatch: number;
  /** Free polish candidates (may exceed batch). */
  polishable: number;
};

export function updateNotesConfirmCopy(
  batchCountOrOpts: number | UpdateConfirmOpts,
): string {
  if (typeof batchCountOrOpts === "number") {
    const n = Math.max(0, batchCountOrOpts);
    return `Update ${n} note${n === 1 ? "" : "s"} to the newer filing quality? Titles and links may change. Your original capture text will not. Uses your Anthropic key.`;
  }
  const refile = Math.max(0, batchCountOrOpts.refileBatch);
  const polish = Math.max(0, batchCountOrOpts.polishable);
  if (refile <= 0 && polish <= 0) {
    return "Nothing needs a refresh right now.";
  }
  if (refile <= 0) {
    return polish === 1
      ? "Clean up link wording on 1 note? Free — no API key. Your original capture text will not change."
      : `Clean up link wording on older notes (about ${polish})? Free — no API key. Your original capture text will not change.`;
  }
  if (polish <= 0) {
    return `Update ${refile} note${refile === 1 ? "" : "s"} with the same AI as filing? Titles and links may change. Your original capture text will not. Uses your Anthropic key.`;
  }
  return `We’ll clean up weak link wording for free, then refresh up to ${refile} note${refile === 1 ? "" : "s"} with the same AI as filing. Titles and links may change. Your original capture text will not. Uses your Anthropic key.`;
}

/** True when this device will file past captures without a Process tap. */
export function isAutomaticFilingReady(snap: {
  enabled: boolean;
  egressAcked: boolean;
  hasKey: boolean;
}): boolean {
  return snap.enabled && snap.egressAcked && snap.hasKey;
}

/** Home wait-surface story when past captures remain (automatic filing UX). */
export type FilingHeroMode = "need_key" | "enable_auto" | "auto_on" | "auto_running";

export type FilingHeroCopy = {
  mode: FilingHeroMode;
  eyebrow: string;
  title: string;
  body: string;
  /** Primary button label (null = no primary). */
  primaryLabel: string | null;
  primaryAction: "open_settings" | "enable_auto" | "process" | null;
  secondaryLabel: string | null;
  secondaryAction: "preview" | "process" | null;
};

/**
 * Pure: how the wait card should speak when pastUnprocessed > 0.
 * Returns null when there is no past queue (caller uses calm home).
 */
export function filingHeroCopy(input: {
  pastUnprocessed: number;
  hasKey: boolean;
  autoEnabled: boolean;
  egressAcked: boolean;
  inFlight?: boolean;
}): FilingHeroCopy | null {
  if (input.pastUnprocessed <= 0) return null;

  const n = input.pastUnprocessed;
  const countLabel =
    n === 1 ? "One past capture waiting" : `${n} past captures waiting`;

  if (!input.hasKey) {
    return {
      mode: "need_key",
      eyebrow: "Ready",
      title: countLabel,
      body: "Add an API key on this phone so Atoms can file them. Today’s note is never auto-touched.",
      primaryLabel: "Open settings",
      primaryAction: "open_settings",
      secondaryLabel: null,
      secondaryAction: null,
    };
  }

  const autoOn = input.autoEnabled && input.egressAcked;
  if (input.inFlight && autoOn) {
    return {
      mode: "auto_running",
      eyebrow: "Filing",
      title: "Filing past thoughts…",
      body: "Automatic filing is running. You can keep browsing — nothing needs a tap.",
      primaryLabel: null,
      primaryAction: null,
      secondaryLabel: "Process now",
      secondaryAction: "process",
    };
  }

  if (!autoOn) {
    return {
      mode: "enable_auto",
      eyebrow: "Ready",
      title: countLabel,
      body: "Turn on automatic filing so past days file when you open Obsidian. Or Process now.",
      primaryLabel: "Turn on automatic filing",
      primaryAction: "enable_auto",
      secondaryLabel: "Process",
      secondaryAction: "process",
    };
  }

  return {
    mode: "auto_on",
    eyebrow: "Automatic",
    title: countLabel,
    body: "Automatic filing is on for this device. Past days file when you open Obsidian — Process only if you want them sooner.",
    primaryLabel: "Process now",
    primaryAction: "process",
    secondaryLabel: "Preview",
    secondaryAction: "preview",
  };
}

/**
 * Relative time label for library rows (en-US-ish, compact).
 * `whenMs` should be libraryTimeMs (created), not raw file mtime after Update.
 */
export function formatRelativeTime(whenMs: number, nowMs: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - whenMs) / 1000));
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yest.";
  if (day < 7) return `${day}d`;
  return new Date(whenMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Also about strip copy — no em dashes. */
export const ALSO_ABOUT_BODY_NOTE =
  "Each note keeps its own body. This view only gathers titles.";

export function alsoAboutStripLabel(entityLabel: string, otherCount: number): string {
  const label = (entityLabel ?? "").trim() || "related";
  const n = Math.max(0, otherCount);
  return `Also about ${label} · ${n}`;
}

export type AlsoAboutStripModel = {
  label: string;
  otherCount: number;
  stripText: string;
};

export function buildAlsoAboutStripModel(
  entityLabel: string,
  otherCount: number,
): AlsoAboutStripModel | null {
  if (otherCount < 1) return null;
  const label = (entityLabel ?? "").trim();
  if (!label) return null;
  return {
    label,
    otherCount,
    stripText: alsoAboutStripLabel(label, otherCount),
  };
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
