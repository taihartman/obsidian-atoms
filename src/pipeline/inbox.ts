import { type App, TFile } from "obsidian";
import { isEmptyCaptureText, parseCaptures } from "./parse";
import { ensureDailyForDate, FutureDailyNoteError } from "./daily";

/**
 * Capture inbox — the phone's capture target.
 *
 * Obsidian's "Capture to Daily Note" Shortcuts action cannot create today's
 * daily, so the first capture of any day fails when the file is missing
 * (upstream, unfixed across 1.11.5–1.12.7). The Shortcut instead appends to a
 * note that never rotates by date, and the drain routes each stamped line into
 * the daily for the date it was *captured*.
 *
 * WIRE CONTRACT — the constants below are baked into every deployed iOS
 * Shortcut. The Shortcuts action binds its bookmark reference at configuration
 * time, so changing the folder or note name silently breaks capture for every
 * installed shortcut until each user re-points it by hand. Treat these with the
 * same care as CAPTURE_SHORTCUT_VERSION in src/settings/captureShortcut.ts.
 */
export const ATOMS_SYSTEM_FOLDER = "Atoms System";
export const INBOX_NOTE_PATH = `${ATOMS_SYSTEM_FOLDER}/Inbox.md`;
export const INBOX_BOOKMARK_TITLE = "Atoms Inbox";

/**
 * Filed sentinel. Deliberately outside the daily note's `<!--linker-->` family:
 * teaching parse.ts about this marker would change how every daily parses, and
 * that parser is the correctness core the whole pipeline rests on.
 */
export const INBOX_FILED_MARKER = "<!--atoms:filed-->";

const INBOX_FILED_RE = /^\s*<!--atoms:filed-->\s*$/;

/** Top-level bullet at column 0 (capture start), mirroring parse.ts. */
const TOP_LEVEL_BULLET_RE = /^- (.*)$/;

/**
 * Leading ISO 8601 local datetime with an explicit offset, written by the
 * Shortcut at capture time. Seconds optional; `Z` accepted.
 */
const STAMP_RE =
  /^((\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2}))\s+(.*)$/;

export interface InboxCapture {
  /** Raw stamp as written by the Shortcut, or null when unreadable. */
  stamp: string | null;
  /** Local calendar date (YYYY-MM-DD) the capture was made on. */
  date: string | null;
  /**
   * Local time of day the capture was made at — HH:MM:SS when the stamp
   * carries seconds, HH:MM when it does not. Seconds are kept so two captures
   * made in the same minute stay distinct (drain dedupe key, Q2).
   */
  time: string | null;
  /** Body text; continuations joined with newlines, indentation stripped. */
  text: string;
  filed: boolean;
  /** True when the line carries no readable stamp — held, never guessed at. */
  unparseable: boolean;
  startLine: number;
  endLine: number;
  markerLine: number | null;
}

export function isInboxFiledMarkerLine(line: string): boolean {
  return INBOX_FILED_RE.test(line);
}

function isTopLevelBullet(line: string): boolean {
  return TOP_LEVEL_BULLET_RE.test(line);
}

/**
 * Indented continuation of a capture: leading whitespace, non-empty, not a
 * top-level bullet, not the filed marker. Mirrors parse.ts isContinuationLine.
 */
function isContinuationLine(line: string): boolean {
  if (line.length === 0) return false;
  if (isTopLevelBullet(line)) return false;
  if (!/^[ \t]/.test(line)) return false;
  if (isInboxFiledMarkerLine(line)) return false;
  return true;
}

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

interface ParsedStamp {
  stamp: string;
  date: string;
  time: string;
  text: string;
}

/**
 * Split the leading stamp off a bullet body.
 *
 * The date and time are read straight from the stamp's own offset rather than
 * converted — a capture belongs to the day it was made, where it was made. A
 * thought captured at 23:40 on the 27th is a Monday thought even though it is
 * already Tuesday in UTC.
 */
function parseStamp(firstLineBody: string): ParsedStamp | null {
  const m = firstLineBody.match(STAMP_RE);
  if (!m) return null;

  const [, stamp, yy, mm, dd, hh, min, ss, text] = m;
  const y = Number(yy);
  const mo = Number(mm);
  const d = Number(dd);
  const h = Number(hh);
  const mi = Number(min);
  const s = ss === undefined ? 0 : Number(ss);

  if (!isRealCalendarDate(y, mo, d)) return null;
  if (h > 23 || mi > 59 || s > 59) return null;

  return {
    stamp: stamp!,
    date: `${yy}-${mm}-${dd}`,
    time: ss === undefined ? `${hh}:${min}` : `${hh}:${min}:${ss}`,
    text: text!,
  };
}

/**
 * Split the inbox note into captures.
 *
 * Capture extent = top-level bullet + indented continuation lines, up to the
 * next top-level bullet, the filed marker, or EOF — the same shape parse.ts
 * uses for dailies, so a drained capture reads back as exactly one capture.
 */
export function parseInboxCaptures(content: string): InboxCapture[] {
  const lines = content.split(/\r?\n/);
  const captures: InboxCapture[] = [];
  let i = 0;

  while (i < lines.length) {
    const bullet = lines[i]!.match(TOP_LEVEL_BULLET_RE);
    if (!bullet) {
      i += 1;
      continue;
    }

    const startLine = i;
    const parsed = parseStamp(bullet[1]!);
    const bodyParts: string[] = [parsed ? parsed.text : bullet[1]!];

    i += 1;
    while (i < lines.length && isContinuationLine(lines[i]!)) {
      bodyParts.push(lines[i]!.replace(/^[ \t]+/, ""));
      i += 1;
    }

    const endLine = i - 1;

    let filed = false;
    let markerLine: number | null = null;
    if (i < lines.length && isInboxFiledMarkerLine(lines[i]!)) {
      filed = true;
      markerLine = i;
      i += 1;
    }

    const text = bodyParts.join("\n");
    // A stampless-but-empty bullet is not work — it matches the daily's
    // "lone dash" case rather than a capture we failed to read.
    if (!parsed && isEmptyCaptureText(text)) continue;

    captures.push({
      stamp: parsed?.stamp ?? null,
      date: parsed?.date ?? null,
      time: parsed?.time ?? null,
      text,
      filed,
      unparseable: parsed === null,
      startLine,
      endLine,
      markerLine,
    });
  }

  return captures;
}

/** Captures waiting to be filed: stamped, readable, not yet marked. */
export function pendingInboxCaptures(captures: InboxCapture[]): InboxCapture[] {
  return captures.filter(
    (c) => !c.filed && !c.unparseable && !isEmptyCaptureText(c.text),
  );
}

/** Captures the drain cannot route — held in place and surfaced, never dropped. */
export function unparseableInboxCaptures(
  captures: InboxCapture[],
): InboxCapture[] {
  return captures.filter((c) => c.unparseable && !c.filed);
}

/** Local YYYY-MM-DD, matching ensureDailyForDate's future-date cutoff. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** How many captures are still stuck in the inbox, and why. */
export interface InboxCounts {
  /** Readable, unfiled, not future-dated — will file on the next drain. */
  pending: number;
  /** Future-dated — held until their day arrives, never filed ahead of the clock. */
  held: number;
  /** No readable stamp — held in place until a human repairs the line. */
  unparseable: number;
}

/**
 * Count the captures still stuck in the inbox, split by why.
 *
 * Computed from the note content at read time rather than cached off the last
 * drain, so the count stays honest when Atoms home is opened long after a drain
 * ran and clears on its own once the captures are filed. `now` fixes the
 * future-date cutoff: a capture dated ahead of the local clock is held, mirroring
 * ensureDailyForDate's refusal. Empty content (or a missing note) is all zeros.
 */
export function inboxCounts(content: string, now: Date): InboxCounts {
  const captures = parseInboxCaptures(content);
  const today = localDateString(now);
  let pending = 0;
  let held = 0;
  for (const c of pendingInboxCaptures(captures)) {
    if (c.date! > today) held += 1;
    else pending += 1;
  }
  return {
    pending,
    held,
    unparseable: unparseableInboxCaptures(captures).length,
  };
}

/**
 * Header written into a freshly created inbox note.
 *
 * Someone who stumbles across this file months from now should not have to
 * guess what it is or whether editing it is safe.
 */
export const INBOX_NOTE_TEMPLATE = [
  "---",
  "atoms-inbox: true",
  "---",
  "",
  "Capture inbox. Your phone shortcut appends here, and Atoms files each line",
  "into the daily note for the day it was captured.",
  "",
  "Lines are marked once filed and are never deleted by Atoms.",
  "",
  "Do not move or rename this note — the capture shortcut points at this exact",
  "path and stops working until you re-point it.",
  "",
  "",
].join("\n");

/** Minimal vault surface the bootstrap needs, kept narrow for testability. */
interface InboxVault {
  getAbstractFileByPath(path: string): unknown;
  createFolder(path: string): Promise<unknown>;
  create(path: string, data: string): Promise<TFile>;
}

function vaultOf(app: App): InboxVault {
  return (app as unknown as { vault: InboxVault }).vault;
}

/**
 * Ensure the inbox note exists at its canonical path, creating the folder and
 * the note when either is missing.
 *
 * Runs on every load because the bookmark and note must exist on whichever
 * device the shortcut fires from, and Obsidian only syncs settings — including
 * bookmarks — when the user has settings sync switched on.
 *
 * Idempotent: an existing note is returned untouched, never rewritten.
 */
export async function ensureInboxNote(app: App): Promise<TFile> {
  const vault = vaultOf(app);
  const existing = vault.getAbstractFileByPath(INBOX_NOTE_PATH);
  if (existing) return existing as TFile;

  if (!vault.getAbstractFileByPath(ATOMS_SYSTEM_FOLDER)) {
    try {
      await vault.createFolder(ATOMS_SYSTEM_FOLDER);
    } catch {
      // A concurrent create (or a sync race) is fine — the create below is
      // what actually has to succeed.
    }
  }
  return vault.create(INBOX_NOTE_PATH, INBOX_NOTE_TEMPLATE);
}

/**
 * Bookmarks plugin surface. Not part of Obsidian's public plugin API — there is
 * no supported way to add a bookmark — so every access is probed and guarded.
 * A shape change upstream must degrade to "no bookmark", never break load.
 */
interface BookmarksInstance {
  items?: Array<{ type?: string; path?: string }>;
  addItem?: (item: { type: string; path: string; title?: string }) => void;
  saveData?: () => void;
}

function bookmarksInstance(app: App): BookmarksInstance | null {
  try {
    const internal = (
      app as unknown as {
        internalPlugins?: {
          plugins?: Record<string, { enabled?: boolean; instance?: unknown }>;
        };
      }
    ).internalPlugins;
    const plugin = internal?.plugins?.["bookmarks"];
    if (!plugin?.enabled) return null;
    const instance = plugin.instance as BookmarksInstance | undefined;
    if (!instance || typeof instance.addItem !== "function") return null;
    return instance;
  } catch {
    return null;
  }
}

export type InboxBookmarkResult = "created" | "already-present" | "unavailable";

/**
 * Ensure the inbox note is bookmarked so the iOS "Capture to Bookmark" action
 * can target it.
 *
 * Returns "unavailable" rather than throwing when the Bookmarks plugin is off
 * or its internal shape is unrecognized; the caller surfaces a one-time setup
 * notice and the user bookmarks the note by hand. Capture still works — it just
 * needs one manual step.
 */
export async function ensureInboxBookmark(
  app: App,
): Promise<InboxBookmarkResult> {
  const instance = bookmarksInstance(app);
  if (!instance) return "unavailable";

  try {
    const already = (instance.items ?? []).some(
      (item) => item?.type === "file" && item?.path === INBOX_NOTE_PATH,
    );
    if (already) return "already-present";

    instance.addItem!({
      type: "file",
      path: INBOX_NOTE_PATH,
      title: INBOX_BOOKMARK_TITLE,
    });
    instance.saveData?.();
    return "created";
  } catch {
    return "unavailable";
  }
}

/**
 * Outcome of a drain pass. U6 surfaces these next to the unprocessed-capture
 * count in Atoms home, so the shape stays flat and cheap to read.
 *
 * `filed` is progress; `held`, `unparseable`, and `pending` are the states a
 * capture can get stuck in — held (future-dated, retries once the day arrives),
 * unparseable (unreadable stamp, needs a human), and pending (a daily could not
 * be resolved this pass, e.g. Daily Notes disabled).
 */
export interface InboxDrainResult {
  /** Captures marked filed this pass — appended, or already present and re-marked. */
  filed: number;
  /** Readable captures left unfiled because their daily could not be resolved. */
  pending: number;
  /** Future-dated captures held rather than filed into a note ahead of the clock. */
  held: number;
  /** Lines with no readable stamp, held in place and counted (never guessed at). */
  unparseable: number;
}

/** Vault surface the drain reads and writes. */
interface DrainVault {
  getAbstractFileByPath(path: string): unknown;
  read(file: TFile): Promise<string>;
  modify(file: TFile, data: string): Promise<void>;
}

function drainVaultOf(app: App): DrainVault {
  return (app as unknown as { vault: DrainVault }).vault;
}

export interface DrainInboxDeps {
  /**
   * Resolve or create the daily for a local date. Defaults to
   * ensureDailyForDate; injected in tests to run the drain against an
   * in-memory vault. Throws FutureDailyNoteError for a date ahead of the clock.
   */
  ensureDaily?: (app: App, date: string) => Promise<TFile>;
}

/** Daily-note bullet for a capture: `- HH:MM body`, continuations tab-indented (KTD8, KTD10). */
function inboxDailyBulletLines(time: string, body: string): string[] {
  const [first, ...rest] = body.split("\n");
  const lines = [`- ${time} ${first ?? ""}`];
  for (const cont of rest) lines.push(`\t${cont}`);
  return lines;
}

/**
 * Dedupe backstop: does the daily already hold this capture? Compares against
 * the daily's own parse so a line whose inbox marker was lost to a sync merge
 * is re-marked rather than duplicated. Keyed on (time, body) per Q2.
 */
function dailyHasCapture(
  dailyContent: string,
  time: string,
  body: string,
): boolean {
  return parseCaptures(dailyContent).some(
    (c) => c.timestamp === time && c.text === body,
  );
}

/** Append bullet lines to a daily, keeping a newline off the previous line. */
function appendBulletLines(content: string, bulletLines: string[]): string {
  const block = bulletLines.join("\n");
  if (content === "") return `${block}\n`;
  const sep = content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}${block}\n`;
}

/**
 * Insert filed markers after each capture's extent, highest line first so an
 * earlier insertion does not shift a later capture's indices (KTD11 —
 * docs/solutions/logic-errors/marker-line-drift-batch-process.md).
 */
function appendFiledMarkers(content: string, captures: InboxCapture[]): string {
  const lines = content.split(/\r?\n/);
  const bottomUp = [...captures].sort((a, b) => b.endLine - a.endLine);
  for (const c of bottomUp) {
    lines.splice(c.endLine + 1, 0, `\t${INBOX_FILED_MARKER}`);
  }
  return lines.join("\n");
}

/**
 * Identity of a capture across two reads of the inbox: the stamp plus the body.
 * Line numbers cannot be used — an append that lands mid-drain shifts nothing
 * above it, but a merge that reflows the file shifts everything.
 */
function captureKey(c: InboxCapture): string {
  return `${c.stamp ?? ""}\n${c.text}`;
}

/**
 * Re-locate the captures we filed in a freshly read inbox.
 *
 * The drain awaits daily resolution and writes between reading the inbox and
 * marking it, and the phone can append into that window. Marking the stale
 * snapshot would drop those captures, so markers are placed against a re-read
 * instead. Matching is greedy per key so two genuine same-second, same-text
 * captures each get their own marker rather than one collecting both.
 */
function relocateFiledCaptures(
  freshCaptures: InboxCapture[],
  filed: InboxCapture[],
): InboxCapture[] {
  const remaining = new Map<string, number>();
  for (const c of filed) {
    remaining.set(captureKey(c), (remaining.get(captureKey(c)) ?? 0) + 1);
  }

  const matched: InboxCapture[] = [];
  for (const c of freshCaptures) {
    if (c.filed || c.unparseable) continue;
    const key = captureKey(c);
    const left = remaining.get(key) ?? 0;
    if (left === 0) continue;
    remaining.set(key, left - 1);
    matched.push(c);
  }
  return matched;
}

const EMPTY_DRAIN_RESULT: InboxDrainResult = {
  filed: 0,
  pending: 0,
  held: 0,
  unparseable: 0,
};

/**
 * Drain every pending inbox capture into its own day's daily and mark it filed.
 *
 * Idempotent and append-only (KTD2): nothing in the inbox is ever deleted or
 * rewritten — the drain only appends daily bullets and inbox markers. A capture
 * already present in its daily (marker lost to sync) is re-marked, not
 * duplicated. Future-dated and unparseable captures are held and counted, never
 * guessed at. Best-effort per date: one daily failing to resolve leaves that
 * date's captures pending without blocking the rest.
 */
export async function drainInbox(
  app: App,
  deps?: DrainInboxDeps,
): Promise<InboxDrainResult> {
  const vault = drainVaultOf(app);
  const inbox = vault.getAbstractFileByPath(INBOX_NOTE_PATH);
  if (!(inbox instanceof TFile)) return { ...EMPTY_DRAIN_RESULT };

  const content = await vault.read(inbox);
  const captures = parseInboxCaptures(content);
  const unparseable = unparseableInboxCaptures(captures).length;
  const pending = pendingInboxCaptures(captures);
  if (pending.length === 0) {
    return { ...EMPTY_DRAIN_RESULT, unparseable };
  }

  const ensureDaily = deps?.ensureDaily ?? ensureDailyForDate;

  // Group by capture date, one daily resolved per date. Map preserves the
  // first-seen date order, so dailies are written in the order they appear.
  const byDate = new Map<string, InboxCapture[]>();
  for (const c of pending) {
    const group = byDate.get(c.date!) ?? [];
    group.push(c);
    byDate.set(c.date!, group);
  }

  const filedCaptures: InboxCapture[] = [];
  let held = 0;
  let stillPending = 0;

  for (const [date, group] of byDate) {
    let daily: TFile;
    try {
      daily = await ensureDaily(app, date);
    } catch (e) {
      if (e instanceof FutureDailyNoteError) held += group.length;
      else stillPending += group.length;
      continue;
    }

    // Read once; dedupe each capture against the daily as it stood before this
    // pass. Two genuine same-second captures both file — dropping one is the
    // failure to avoid, filing twice is recoverable (Q2).
    const dailyContent = await vault.read(daily);
    const additions: string[] = [];
    for (const c of group) {
      if (!dailyHasCapture(dailyContent, c.time!, c.text)) {
        additions.push(...inboxDailyBulletLines(c.time!, c.text));
      }
      filedCaptures.push(c);
    }
    if (additions.length > 0) {
      await vault.modify(daily, appendBulletLines(dailyContent, additions));
    }
  }

  if (filedCaptures.length > 0) {
    // Re-read rather than marking the opening snapshot: the loop above awaited
    // daily creation and writes, and the Shortcut or Sync can append into that
    // window. Writing the stale content back would silently discard whatever
    // landed — the exact capture loss this whole path exists to prevent.
    const fresh = await vault.read(inbox);
    const matched = relocateFiledCaptures(parseInboxCaptures(fresh), filedCaptures);
    if (matched.length > 0) {
      await vault.modify(inbox, appendFiledMarkers(fresh, matched));
    }
  }

  return {
    filed: filedCaptures.length,
    pending: stillPending,
    held,
    unparseable,
  };
}
