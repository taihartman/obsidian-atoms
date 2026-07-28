import type { App, TFile } from "obsidian";
import { isEmptyCaptureText } from "./parse";

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
  /** Local time of day (HH:MM) the capture was made at. */
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
    time: `${hh}:${min}`,
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
