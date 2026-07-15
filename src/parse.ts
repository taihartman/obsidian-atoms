import type { Capture, DailyNoteWithCaptures, MarkerKind } from "./types";

/** Atom marker: ↳ … [[…]] … <!--linker--> (KTD1 / §A). */
export const ATOM_MARKER_RE = /^\s*↳ .*\[\[.*\]\].*<!--linker-->\s*$/;

/** Non-atom sentinel-only markers (KTD1 / H1). */
export const NON_ATOM_MARKER_RE = /^\s*<!--linker:(task|noise)-->\s*$/;

/** Top-level bullet at column 0 (capture start). */
const TOP_LEVEL_BULLET_RE = /^- (.*)$/;

/** Optional leading timestamp: `14:32 rest` or `14:32:01 rest`. */
const TIMESTAMP_RE = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/;

export function isAtomMarkerLine(line: string): boolean {
  return ATOM_MARKER_RE.test(line);
}

export function isNonAtomMarkerLine(line: string): boolean {
  return NON_ATOM_MARKER_RE.test(line);
}

export function isMarkerLine(line: string): boolean {
  return isAtomMarkerLine(line) || isNonAtomMarkerLine(line);
}

export function markerKindFromLine(line: string): MarkerKind | null {
  if (isAtomMarkerLine(line)) return "atom";
  const m = line.match(NON_ATOM_MARKER_RE);
  if (m?.[1] === "task" || m?.[1] === "noise") return m[1];
  return null;
}

function isTopLevelBullet(line: string): boolean {
  return TOP_LEVEL_BULLET_RE.test(line);
}

/**
 * Indented continuation of a capture: leading whitespace, non-empty,
 * not a top-level bullet, not a marker line.
 */
function isContinuationLine(line: string): boolean {
  if (line.length === 0) return false;
  if (isTopLevelBullet(line)) return false;
  if (!/^[ \t]/.test(line)) return false;
  if (isMarkerLine(line)) return false;
  return true;
}

function stripBulletAndTimestamp(firstLineBody: string): {
  text: string;
  timestamp: string | null;
} {
  const ts = firstLineBody.match(TIMESTAMP_RE);
  if (ts) {
    return { timestamp: ts[1]!, text: ts[2]! };
  }
  return { timestamp: null, text: firstLineBody };
}

/**
 * Split a daily-note body into captures with marker detection (KTD1).
 *
 * Capture extent = top-level bullet + indented continuation lines, up to the
 * next top-level bullet, a marker line, or EOF. "The following line" for
 * markers is the first line after that extent.
 *
 * Wikilinks inside capture text are ignored for processed-state.
 */
export function parseCaptures(content: string): Capture[] {
  const lines = content.split(/\r?\n/);
  const captures: Capture[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const bullet = line.match(TOP_LEVEL_BULLET_RE);
    if (!bullet) {
      i += 1;
      continue;
    }

    const startLine = i;
    const { text: firstText, timestamp } = stripBulletAndTimestamp(bullet[1]!);
    const bodyParts: string[] = [firstText];

    i += 1;
    while (i < lines.length && isContinuationLine(lines[i]!)) {
      bodyParts.push(lines[i]!.replace(/^[ \t]+/, ""));
      i += 1;
    }

    const endLine = i - 1;

    let processed = false;
    let markerKind: MarkerKind | null = null;
    let markerLine: number | null = null;

    if (i < lines.length && isMarkerLine(lines[i]!)) {
      processed = true;
      markerKind = markerKindFromLine(lines[i]!);
      markerLine = i;
      i += 1;
    }

    captures.push({
      text: bodyParts.join("\n"),
      timestamp,
      startLine,
      endLine,
      processed,
      markerKind,
      markerLine,
    });
  }

  return captures;
}

export function unprocessedCaptures(captures: Capture[]): Capture[] {
  return captures.filter((c) => !c.processed);
}

/**
 * Pure helper: given note path/date/content, skip today (and future) and
 * days with no unmarked captures.
 */
export function collectPastNotesWithUnmarkedCaptures(
  notes: Array<{ path: string; date: string; content: string }>,
  today: string,
): DailyNoteWithCaptures[] {
  const out: DailyNoteWithCaptures[] = [];
  for (const note of notes) {
    if (note.date >= today) continue; // today and future excluded (R1 / AE4)
    const captures = parseCaptures(note.content);
    const unprocessed = unprocessedCaptures(captures);
    if (unprocessed.length === 0) continue;
    out.push({
      path: note.path,
      date: note.date,
      captures,
      unprocessed,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
