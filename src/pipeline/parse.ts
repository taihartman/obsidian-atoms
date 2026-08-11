import type { Capture, DailyNoteWithCaptures, MarkerKind } from "../shared/types";

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

/** Skip empty / whitespace-only bullets (e.g. lone "- "). */
export function isEmptyCaptureText(text: string): boolean {
  return !text.replace(/\s+/g, " ").trim();
}

export function unprocessedCaptures(captures: Capture[]): Capture[] {
  return captures.filter((c) => !c.processed && !isEmptyCaptureText(c.text));
}

/** The only shape a window bound may take — every comparison against it is a string compare. */
const DAY_BOUND_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A window bound is either absent or a day — never "present but unusable".
 *
 * The truthiness check this replaces read `""` as "no bound", and for `since` that is not a
 * harmless no-op: `note.date < ""` is false for every note, so an empty start silently widened
 * the window to all of history — the one failure this file promises cannot happen. Rejecting is
 * chosen over degrading to an empty result because the only producers are the resolver (which
 * guarantees a day) and future migration code, so a bad bound is a caller bug; a silent empty
 * scan would be indistinguishable from a drained window, while a throw on the unattended path
 * is caught by `runAutoFilingCycle`, logged, and leaves the day unstamped to retry.
 */
function checkDayBound(name: "since" | "before", v: string | undefined): void {
  if (v === undefined) return;
  if (!DAY_BOUND_RE.test(v)) {
    throw new TypeError(
      `collectPastNotesWithUnmarkedCaptures: ${name} must be YYYY-MM-DD, got ${JSON.stringify(v)}`,
    );
  }
}

/**
 * Pure helper: notes with unmarked captures.
 * Default past-only (date < today). includeToday also keeps date === today.
 * Future days always excluded.
 *
 * `since` / `before` bound the scan to a half-open day range — `since <= date < before` —
 * so the filing window (KTD2) and its backfill complement (KTD3) are the same filter read
 * from opposite ends and can never overlap or leave a gap. Both are `YYYY-MM-DD` and are
 * compared **lexically**: no Date parsing, so no timezone or DST hazard on a bound that
 * lives in localStorage. All three bounds live here so no caller can honor one and miss
 * another.
 */
export function collectPastNotesWithUnmarkedCaptures(
  notes: Array<{ path: string; date: string; content: string }>,
  today: string,
  opts?: { includeToday?: boolean; since?: string; before?: string },
): DailyNoteWithCaptures[] {
  const includeToday = opts?.includeToday === true;
  const since = opts?.since;
  const before = opts?.before;
  checkDayBound("since", since);
  checkDayBound("before", before);
  const out: DailyNoteWithCaptures[] = [];
  for (const note of notes) {
    if (note.date > today) continue;
    if (!includeToday && note.date >= today) continue; // past-only default (R1 / AE4)
    // `!== undefined`, never truthiness: a bound that exists is always applied (checked above).
    if (since !== undefined && note.date < since) continue; // start is inclusive
    if (before !== undefined && note.date >= before) continue; // end is exclusive
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
