import { type App, TFile } from "obsidian";
import { isEmptyCaptureText, parseCaptures } from "./parse";
import {
  ensureDailyForDate,
  formatLocalDate,
  FutureDailyNoteError,
} from "./daily";

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

/** Recorded when the drain had to infer a capture's day — makes the guess auditable. */
export function inboxInferredDateMarker(date: string): string {
  return `<!--atoms:inferred-date:${date}-->`;
}

const INBOX_INFERRED_DATE_RE =
  /^\s*<!--atoms:inferred-date:(\d{4}-\d{2}-\d{2})-->\s*$/;

/** The date an inferred-date marker line records, or null for any other line. */
export function inboxInferredDateFromLine(line: string): string | null {
  return line.match(INBOX_INFERRED_DATE_RE)?.[1] ?? null;
}

/** Top-level bullet at column 0 (capture start), mirroring parse.ts. */
const TOP_LEVEL_BULLET_RE = /^- (.*)$/;

/**
 * Leading ISO 8601 local datetime with an explicit offset, written by the
 * Shortcut at capture time. Seconds optional; `Z` accepted.
 */
const STAMP_RE =
  /^((\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2}))(?:\s+(.*))?$/;

/**
 * A leading token that is *shaped* like a routing stamp but does not read as
 * one. The body is sacred (non-negotiable #1); a junk routing stamp is not
 * body, and letting it through lands verbatim in the daily and in the atom.
 *
 * The asymmetry decides how tight this is: a junk stamp left in the body is
 * ugly but visible and lossless, while stripped user text is gone silently and
 * forever. So this matches exactly three *named* shapes — every one a real
 * misconfiguration documented in docs/capture-shortcut.md — and nothing else:
 *
 * 1. ISO-shaped but not a real instant (impossible calendar date, out-of-range
 *    time, or a missing offset). Only reachable once parseStamp has refused it.
 * 2. Shortcuts "Short" date style, `7/28/26, 12:00 PM` — the format string set
 *    on the Current Date variable instead of the Format Date action. The comma
 *    is required: Short style always emits one, and requiring it is what keeps
 *    a genuine `12/25/26 10:00 dentist appointment` intact. The AM/PM marker is
 *    required too, which is a deliberate trade: it pins the alternation to the
 *    US-locale trap documented in docs/capture-shortcut.md, and gives up
 *    stripping a 24-hour-locale Shortcut's `28/07/2026, 12:00` so that a
 *    hand-written `3/15/26, 14:30 finally finished the report` survives whole.
 *    Per the asymmetry above, that is the right way round.
 * 3. `EEE, dd MMM yyyy HH:mm:ss Z`, e.g. `Fri, 28 Jul 2026 12:00:00 -0400` —
 *    Shortcuts' default custom format, wrong because of `Z` vs `ZZZZZ`.
 *
 * Tighten this, never widen it.
 */
const UNREADABLE_STAMP_RE =
  /^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,4}[-/]\d{1,2}[-/]\d{1,4},\s*\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp]\.?[Mm]\.?|[A-Z][a-z]{2},\s\d{1,2}\s[A-Z][a-z]{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\s[+-]\d{4})(?:\s+(.*))?$/;

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
  /**
   * Date recorded by this region's inferred-date marker, or null when there is
   * none. Durable record only: a capture whose date was inferred in memory this
   * pass but not yet marked reads back as `inferredDate === null` with a null
   * `stamp` (KTD1).
   */
  inferredDate: string | null;
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

/** Written at column 0 — no leading space or tab. */
function isColumnZero(line: string): boolean {
  return !/^[ \t]/.test(line);
}

/**
 * A dash carrying no content — `-` alone, or trailed only by whitespace.
 *
 * TOP_LEVEL_BULLET_RE requires the space, so this is not a bullet; absorbing it
 * would append a stray `- ` line to the preceding capture's body and write `- -`
 * into the daily. The body is sacred (non-negotiable #1), so it stays put.
 */
const DEGENERATE_DASH_RE = /^\s*-\s*$/;

/**
 * A sync-conflict marker git (or Obsidian Sync) left behind.
 *
 * The inbox is appended to by every device, which makes it the note in the
 * vault most likely to receive a conflict. Absorbing the scaffolding writes
 * text the user never typed into a capture body, so it is left unabsorbed and
 * uncounted. Exactly the four seven-character markers, optionally labelled —
 * `|||||||` is the base section `merge.conflictStyle = diff3`/`zdiff3` writes.
 * Anchored at column 0 with no leading-whitespace tolerance: git writes markers
 * there, and the failure this file reasons about is indentation being *lost*.
 */
const CONFLICT_MARKER_RE = /^(?:<{7}|\|{7}|={7}|>{7})(?:\s.*)?$/;

/**
 * A line the parser refuses to absorb: scaffolding, not capture text.
 *
 * Noise is invisible in both directions — it neither folds into the body above
 * it nor terminates the region scan below it. Letting it terminate the scan
 * would hide a filed marker sitting under it and silently reassign a capture's
 * filed state, stacking a second marker that the append-only inbox never cleans.
 */
function isNoiseLine(line: string): boolean {
  return DEGENERATE_DASH_RE.test(line) || CONFLICT_MARKER_RE.test(line);
}

/** Either of the inbox's own sentinels, which never fold into a body. */
function isInboxMarkerLine(line: string): boolean {
  return (
    isInboxFiledMarkerLine(line) || inboxInferredDateFromLine(line) !== null
  );
}

/**
 * Line that folds into the preceding capture's body.
 *
 * Same shape as parse.ts's continuation rule plus **column-0 orphans** — a
 * continuation that lost its indentation to a sync merge or an editor (KTD4).
 * The inbox is plugin-owned machinery, so reporting an orphan only tells the
 * user about a file they will never open; absorbing it keeps the capture whole.
 * A truly blank line still terminates the extent; a whitespace-only line is
 * indented, so it is absorbed and stripped to "".
 *
 * Two shapes are content-free scaffolding rather than a lost continuation and
 * are left where they are: a degenerate dash, and a sync-conflict marker.
 */
function isAbsorbableLine(line: string): boolean {
  if (line.trim() === "" && isColumnZero(line)) return false;
  if (isTopLevelBullet(line)) return false;
  if (isInboxMarkerLine(line)) return false;
  if (isNoiseLine(line)) return false;
  return true;
}

/** The inbox's own markers sitting in the region after a capture's extent. */
interface InboxRegionMarkers {
  /** Line of the filed marker, or null when this capture is not marked filed. */
  filedLine: number | null;
  /** Date the inferred-date marker records, or null when there is none. */
  inferredDate: string | null;
}

/**
 * Find the inbox's markers in the region after a capture's extent.
 *
 * Scans from `endLine + 1` forward and stops at the next top-level bullet or a
 * non-indented non-blank line, so a blank line that drifts between a capture
 * and its marker (a sync merge, a hand edit) still reads as filed rather than
 * re-filing and stacking a second marker. Neither marker terminates the scan
 * and neither is required to be indented: the pair reads in either order, and a
 * merge that strips the tab off one would otherwise read as prose and hide the
 * other below it. Noise the parser refused to absorb is skipped for the same
 * reason — see `isNoiseLine`. Mirrors `captureAlreadyHasMarker` in render.ts — the inbox
 * owns its own sentinels and never teaches parse.ts about them (KTD9).
 */
function inboxMarkersInRegion(
  lines: string[],
  endLine: number,
): InboxRegionMarkers {
  let filedLine: number | null = null;
  let inferredDate: string | null = null;
  for (let j = endLine + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (isTopLevelBullet(line)) break;
    const date = inboxInferredDateFromLine(line);
    if (date !== null) {
      if (inferredDate === null) inferredDate = date;
      continue;
    }
    if (isInboxFiledMarkerLine(line)) {
      if (filedLine === null) filedLine = j;
      continue;
    }
    if (isNoiseLine(line)) continue; // scaffolding never hides a marker below it
    if (line.trim() !== "" && isColumnZero(line)) break; // non-indented prose
  }
  return { filedLine, inferredDate };
}

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/** True when a `YYYY-MM-DD` string names a day that actually exists. */
function isRealDateString(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  return isRealCalendarDate(y!, m!, d!);
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
    // A bullet that is only a stamp carries no content — empty, not unreadable
    // (KTD3). The empty skip below drops it rather than reporting a false alarm.
    text: text ?? "",
  };
}

/**
 * Body of a bullet whose stamp did not read: the junk routing stamp stripped
 * off when there is one, otherwise the bullet unchanged.
 */
function bodyWithoutUnreadableStamp(firstLineBody: string): string {
  const m = firstLineBody.match(UNREADABLE_STAMP_RE);
  return m ? (m[1] ?? "") : firstLineBody;
}

/**
 * Split the inbox note into captures.
 *
 * Capture extent = top-level bullet + indented continuation lines, up to the
 * next top-level bullet, the filed marker, or EOF — the same shape parse.ts
 * uses for dailies, so a drained capture reads back as exactly one capture.
 */
export function parseInboxCaptures(
  content: string,
  now: Date = new Date(),
): InboxCapture[] {
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
    const bodyParts: string[] = [
      parsed ? parsed.text : bodyWithoutUnreadableStamp(bullet[1]!),
    ];

    i += 1;
    while (i < lines.length && isAbsorbableLine(lines[i]!)) {
      bodyParts.push(lines[i]!.replace(/^[ \t]+/, ""));
      i += 1;
    }

    // A bare stamp carries no body of its own (KTD3), so a continuation behind
    // it would otherwise render as an empty first bullet line in the daily.
    if (bodyParts.length > 1 && bodyParts[0] === "") bodyParts.shift();

    const endLine = i - 1;

    // Region scan, not adjacency: a blank line drifting between the capture and
    // its marker must still read as filed (F4).
    const { filedLine, inferredDate } = inboxMarkersInRegion(lines, endLine);
    const filed = filedLine !== null;
    if (filedLine !== null) i = filedLine + 1;

    const text = bodyParts.join("\n");
    // An empty bullet is not work, whether or not the stamp read — it matches
    // the daily's "lone dash" case rather than a capture we failed to read.
    if (isEmptyCaptureText(text)) continue;

    captures.push({
      stamp: parsed?.stamp ?? null,
      date: parsed?.date ?? null,
      time: parsed?.time ?? null,
      text,
      filed,
      inferredDate,
      startLine,
      endLine,
      markerLine: filedLine,
    });
  }

  inheritMissingDates(captures, now);
  return captures;
}

/**
 * Give every capture whose stamp did not read a date to file against (KTD1).
 *
 * A recorded inferred-date marker wins, so the guess stays stable across
 * drains. Otherwise the inbox's append order is the evidence: the capture takes
 * the day of the nearest preceding *stamped* capture, then the nearest
 * following one, then today (KTD2). Anchoring only on stamped captures keeps a
 * run of orphans from drifting off one guess. Every path clamps to today —
 * a date ahead of the clock raises FutureDailyNoteError and strands the capture
 * forever, which is the outcome this whole path exists to prevent.
 *
 * `stamp` and `time` stay null. The day is inferable; the moment is not.
 */
function inheritMissingDates(captures: InboxCapture[], now: Date): void {
  const today = formatLocalDate(now);
  for (let i = 0; i < captures.length; i++) {
    const c = captures[i]!;
    if (c.date !== null) continue;

    // A marker naming a day that does not exist is no evidence at all: the
    // marker regex is shape-only, and `2026-02-30` formats as an invalid moment
    // that files every corrupt capture into a literal `Daily/Invalid date.md`.
    // Fall through to a fresh guess rather than trusting it — same argument as
    // the clamp below, since a bad recorded date is re-supplied on every parse
    // and the capture could otherwise never heal.
    if (c.inferredDate !== null && isRealDateString(c.inferredDate)) {
      // Clamped like a fresh guess: a future-dated marker that survived a merge
      // while the filed marker did not would re-supply the bad date on every
      // parse, so the capture could never heal.
      c.date = c.inferredDate > today ? today : c.inferredDate;
      continue;
    }

    let inherited: string | null = null;
    for (let j = i - 1; j >= 0 && inherited === null; j--) {
      if (captures[j]!.stamp !== null) inherited = captures[j]!.date;
    }
    for (let j = i + 1; j < captures.length && inherited === null; j++) {
      if (captures[j]!.stamp !== null) inherited = captures[j]!.date;
    }

    c.date = inherited === null || inherited > today ? today : inherited;
  }
}

/** A capture the drain can route: it knows which day it belongs to. */
export type DatedInboxCapture = InboxCapture & { date: string };

/** Captures waiting to be filed: dated (read or inherited), not yet marked. */
export function pendingInboxCaptures(
  captures: InboxCapture[],
): DatedInboxCapture[] {
  return captures.filter(
    (c): c is DatedInboxCapture =>
      !c.filed && c.date !== null && !isEmptyCaptureText(c.text),
  );
}

/** How many captures are still stuck in the inbox, and why. */
export interface InboxCounts {
  /** Readable, unfiled, not future-dated — will file on the next drain. */
  pending: number;
  /** Future-dated — held until their day arrives, never filed ahead of the clock. */
  held: number;
  /** Captures whose day the drain had to infer, filed or not — the audit trail. */
  inferredDates: number;
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
  const captures = parseInboxCaptures(content, now);
  const today = formatLocalDate(now);
  let pending = 0;
  let held = 0;
  for (const c of pendingInboxCaptures(captures)) {
    if (c.date > today) held += 1;
    else pending += 1;
  }
  return {
    pending,
    held,
    inferredDates: captures.filter((c) => c.inferredDate !== null).length,
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
interface BookmarkItem {
  type?: string;
  path?: string;
  /** Group items nest their children here; addItem only ever adds top-level. */
  items?: BookmarkItem[];
}

interface BookmarksInstance {
  items?: BookmarkItem[];
  addItem?: (item: { type: string; path: string; title?: string }) => void;
  saveData?: () => void;
}

/**
 * True if the inbox is bookmarked anywhere in the tree, including nested inside
 * a group. A flat top-level check misses a bookmark the user filed into a group
 * and adds a duplicate on every load, propagated by settings sync (F6).
 */
function bookmarksInbox(items: BookmarkItem[] | undefined): boolean {
  for (const item of items ?? []) {
    if (item?.type === "file" && item?.path === INBOX_NOTE_PATH) return true;
    if (item?.items && bookmarksInbox(item.items)) return true;
  }
  return false;
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
    if (bookmarksInbox(instance.items)) return "already-present";

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
 * `filed` is progress; `held` and `pending` are the two states a capture can
 * still get stuck in — held (future-dated, retries once the day arrives) and
 * pending (a daily could not be resolved this pass, e.g. Daily Notes disabled).
 * An unreadable stamp is no longer one of them: the capture inherits a day and
 * files, counted under `inferred` (KTD1).
 */
export interface InboxDrainResult {
  /** Captures marked filed this pass — appended, or already present and re-marked. */
  filed: number;
  /** Captures left unfiled because their daily could not be resolved. */
  pending: number;
  /** Future-dated captures held rather than filed into a note ahead of the clock. */
  held: number;
  /** Captures filed this pass whose day had to be inferred from a neighbour. */
  inferred: number;
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
  /**
   * Clock for date inheritance. Defaults to the real one; injected in tests so
   * a capture that falls back to the today-anchor lands on a fixed date rather
   * than the machine's.
   */
  now?: Date;
}

/**
 * Daily-note bullet for a capture: `- HH:MM body`, continuations tab-indented
 * (KTD8, KTD10). A null time writes `- body`: an untimed bullet is already a
 * normal daily shape (parse.ts carries `timestamp: string | null`), and it
 * reads honestly as "we did not know when" rather than fabricating a moment.
 */
function inboxDailyBulletLines(time: string | null, body: string): string[] {
  const [first, ...rest] = body.split("\n");
  const head = first ?? "";
  const lines = [time === null ? `- ${head}` : `- ${time} ${head}`];
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
  time: string | null,
  body: string,
): boolean {
  return parseCaptures(dailyContent).some(
    (c) => c.timestamp === time && c.text === body,
  );
}

/**
 * How many bullets the daily holds per `(time, body)` key. Verification counts
 * rather than tests existence: two byte-identical same-second captures both
 * file by design (Q2), so `some(...)` lets one surviving bullet satisfy both
 * checks and marks a capture that a merge already dropped.
 */
function dailyCaptureCounts(dailyContent: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of parseCaptures(dailyContent)) {
    const key = `${c.timestamp ?? ""}\n${c.text}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
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
function appendFiledMarkers(
  content: string,
  captures: DatedInboxCapture[],
): string {
  // Preserve the file's dominant terminator: rewriting CRLF to LF turns a
  // two-line insert into a whole-file rewrite on a Windows-synced vault (F2).
  const term = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const bottomUp = [...captures]
    // Region already marked (drifted marker) — never stack a second one (F4).
    .filter((c) => inboxMarkersInRegion(lines, c.endLine).filedLine === null)
    .sort((a, b) => b.endLine - a.endLine);
  for (const c of bottomUp) {
    // A capture whose day we had to guess records the guess alongside the filed
    // marker, so the next read reuses it instead of guessing again (KTD1).
    const inserted =
      c.stamp === null && c.inferredDate === null
        ? [`\t${inboxInferredDateMarker(c.date)}`, `\t${INBOX_FILED_MARKER}`]
        : [`\t${INBOX_FILED_MARKER}`];
    lines.splice(c.endLine + 1, 0, ...inserted);
  }
  let out = lines.join(term);
  // Restore the EOF terminator the Shortcut appends against — without it the
  // next capture fuses onto the marker line and is lost (F1).
  if (!out.endsWith(term)) out += term;
  return out;
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
 *
 * Each match keeps the *fresh* capture's line numbers — what the marker splice
 * needs — but the *original's* date: the re-read re-infers dates from whatever
 * the file looks like now, and a drain that straddles midnight or an append
 * that moves the neighbour anchors would otherwise record an inferred-date
 * marker pinning a different day than the daily bullet actually landed under.
 */
function relocateFiledCaptures(
  freshCaptures: InboxCapture[],
  filed: DatedInboxCapture[],
): DatedInboxCapture[] {
  // Document order, not the caller's: the drain groups by date, so two
  // same-key captures can arrive with the later one first. Matching walks the
  // re-read in document order, so a per-key queue built out of document order
  // hands each duplicate the *other* one's date — one marker each, both naming
  // the wrong day, and inheritMissingDates trusts that marker forever after.
  const remaining = new Map<string, DatedInboxCapture[]>();
  for (const c of [...filed].sort((a, b) => a.startLine - b.startLine)) {
    const key = captureKey(c);
    const queue = remaining.get(key) ?? [];
    queue.push(c);
    remaining.set(key, queue);
  }

  const matched: DatedInboxCapture[] = [];
  for (const c of freshCaptures) {
    if (c.filed) continue;
    const original = remaining.get(captureKey(c))?.shift();
    if (original === undefined) continue;
    matched.push({ ...c, date: original.date });
  }
  return matched;
}

/**
 * Keep only the captures whose bullet is still in its daily at marker time.
 *
 * The daily write landing is not proof the bullet survived: Obsidian Sync
 * replaces files out-of-band, so a merge can drop the bullet after the write
 * and before the marker, leaving a capture marked filed and gone. Re-reading
 * each daily here is the only thing that catches that, and no in-process write
 * primitive helps — `Vault.process` serializes writers within this process
 * only.
 *
 * **This narrows the window; it does not close it.** A Sync replacement landing
 * between this read and the marker write is still possible, just over a shorter
 * span. The recovery path for that residual is the unmatched-capture fallback:
 * an unverified capture gets no marker, counts as pending, and re-drains next
 * pass — which is why this conditions the marker rather than repairing the
 * daily (R9).
 *
 * Keyed on (time, body) like the write-side dedupe, so a filing sentinel or a
 * marker appended under the bullet since the write still verifies. Matching is
 * greedy per key rather than existence-based: two identical captures need two
 * surviving bullets, and this is not dedupe — two bullets still verify two.
 */
async function verifyFiledInDailies(
  vault: DrainVault,
  written: { daily: TFile; group: DatedInboxCapture[] }[],
): Promise<DatedInboxCapture[]> {
  const verified: DatedInboxCapture[] = [];
  for (const { daily, group } of written) {
    let dailyContent: string;
    try {
      dailyContent = await vault.read(daily);
    } catch {
      // Unreadable now — cannot prove the bullet landed, so claim nothing.
      continue;
    }
    const remaining = dailyCaptureCounts(dailyContent);
    for (const c of group) {
      const key = `${c.time ?? ""}\n${c.text}`;
      const left = remaining.get(key) ?? 0;
      if (left <= 0) continue;
      remaining.set(key, left - 1);
      verified.push(c);
    }
  }
  return verified;
}

const EMPTY_DRAIN_RESULT: InboxDrainResult = {
  filed: 0,
  pending: 0,
  held: 0,
  inferred: 0,
};

/**
 * Drain every pending inbox capture into its own day's daily and mark it filed.
 *
 * Idempotent and append-only (KTD2): nothing in the inbox is ever deleted or
 * rewritten — the drain only appends daily bullets and inbox markers. A capture
 * already present in its daily (marker lost to sync) is re-marked, not
 * duplicated. Future-dated captures are held until their day arrives. A capture
 * whose stamp did not read is *not* held: the inbox is plugin-owned machinery
 * the user never opens, so holding it means it never arrives. It inherits its
 * neighbour's day, files, and records the guess (KTD1, KTD2). Best-effort per
 * date: one daily failing to resolve leaves that date's captures pending
 * without blocking the rest.
 */
export async function drainInbox(
  app: App,
  deps?: DrainInboxDeps,
): Promise<InboxDrainResult> {
  const vault = drainVaultOf(app);
  const inbox = vault.getAbstractFileByPath(INBOX_NOTE_PATH);
  if (!(inbox instanceof TFile)) return { ...EMPTY_DRAIN_RESULT };

  const now = deps?.now ?? new Date();
  const content = await vault.read(inbox);
  const captures = parseInboxCaptures(content, now);
  const pending = pendingInboxCaptures(captures);
  if (pending.length === 0) return { ...EMPTY_DRAIN_RESULT };

  const ensureDaily = deps?.ensureDaily ?? ensureDailyForDate;

  // Group by capture date, one daily resolved per date. Map preserves the
  // first-seen date order, so dailies are written in the order they appear.
  const byDate = new Map<string, DatedInboxCapture[]>();
  for (const c of pending) {
    const group = byDate.get(c.date) ?? [];
    group.push(c);
    byDate.set(c.date, group);
  }

  const filedCaptures: DatedInboxCapture[] = [];
  // Each written daily kept alongside its captures, so marker time can re-read
  // it and confirm the bullets are still there.
  const writtenDailies: { daily: TFile; group: DatedInboxCapture[] }[] = [];
  let held = 0;
  let stillPending = 0;

  for (const [date, group] of byDate) {
    // Best-effort per date: the whole read/write is inside the try so an
    // unreadable or unwritable daily leaves that date pending without aborting
    // the drain — later dates and the marker-write pass still run (F3).
    try {
      const daily = await ensureDaily(app, date);

      // Read once; dedupe each capture against the daily as it stood before
      // this pass. Two genuine same-second captures both file — dropping one is
      // the failure to avoid, filing twice is recoverable (Q2).
      const dailyContent = await vault.read(daily);
      const additions: string[] = [];
      for (const c of group) {
        if (!dailyHasCapture(dailyContent, c.time, c.text)) {
          additions.push(...inboxDailyBulletLines(c.time, c.text));
        }
      }
      if (additions.length > 0) {
        await vault.modify(daily, appendBulletLines(dailyContent, additions));
      }
      // Only after the daily is written do these captures count as filed —
      // and only provisionally, until re-verified below.
      filedCaptures.push(...group);
      writtenDailies.push({ daily, group });
    } catch (e) {
      if (e instanceof FutureDailyNoteError) held += group.length;
      else stillPending += group.length;
      continue;
    }
  }

  let matched: DatedInboxCapture[] = [];
  const verified = await verifyFiledInDailies(vault, writtenDailies);
  if (verified.length > 0) {
    // Re-read rather than marking the opening snapshot: the loop above awaited
    // daily creation and writes, and the Shortcut or Sync can append into that
    // window. Writing the stale content back would silently discard whatever
    // landed — the exact capture loss this whole path exists to prevent.
    const fresh = await vault.read(inbox);
    matched = relocateFiledCaptures(parseInboxCaptures(fresh, now), verified);
    if (matched.length > 0) {
      await vault.modify(inbox, appendFiledMarkers(fresh, matched));
    }
  }

  return {
    // `filed` counts markers actually written, not captures attempted: a
    // capture whose bullet no longer reads back from its daily, or whose inbox
    // line a merge reflowed, gets no marker and re-surfaces as pending until a
    // later drain files and marks it (F5, R9).
    filed: matched.length,
    pending: stillPending + (filedCaptures.length - matched.length),
    held,
    inferred: matched.filter((c) => c.stamp === null).length,
  };
}
