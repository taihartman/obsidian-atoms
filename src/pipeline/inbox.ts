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
