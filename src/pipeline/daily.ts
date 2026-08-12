import { moment, type App, type TFile } from "obsidian";
import {
  appHasDailyNotesPluginLoaded,
  createDailyNote,
  getAllDailyNotes,
  getDailyNote,
  getDateFromFile,
} from "obsidian-daily-notes-interface";
import {
  collectPastNotesWithUnmarkedCaptures,
} from "./parse";
import type { DailyNoteWithCaptures } from "../shared/types";

export class DailyNotesDisabledError extends Error {
  constructor() {
    super(
      "Atoms requires the core Daily Notes plugin to be enabled. Enable it under Settings → Core plugins.",
    );
    this.name = "DailyNotesDisabledError";
  }
}

export class FutureDailyNoteError extends Error {
  constructor(date: string) {
    super(`Refusing to create a daily note for a future date (${date}).`);
    this.name = "FutureDailyNoteError";
  }
}

/**
 * Local YYYY-MM-DD. Exported because the inbox's held-capture cutoff has to
 * agree with this module's future-date cutoff exactly — two copies that drift
 * would count a capture as held while the drain still tried to file it.
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface PastDailyNotesResult {
  notes: DailyNoteWithCaptures[];
  totalUnprocessed: number;
}

export interface GetUnprocessedOpts {
  /** When true, include today's daily (manual test / force process). Default false. */
  includeToday?: boolean;
  today?: Date;
  /**
   * Filing-window start, `YYYY-MM-DD` inclusive (KTD2). Non-optional in practice on every
   * unattended path — absent means "scan all history", which is the sweep the window exists
   * to end, so unattended callers resolve it through `resolveAutoFilingSince`. Optional here
   * because the attended commands are deliberately unbounded diagnostics.
   */
  since?: string;
  /** Backfill complement bound, `YYYY-MM-DD` exclusive (KTD3): strictly before the window. */
  before?: string;
}

/**
 * Scan daily notes for unmarked captures.
 * Default excludes today (auto-run / normal process). Pass includeToday for
 * manual "try with today" from the home view.
 */
export async function getPastDailyNotesWithUnmarkedCaptures(
  app: App,
  todayOrOpts: Date | GetUnprocessedOpts = new Date(),
): Promise<PastDailyNotesResult> {
  if (!appHasDailyNotesPluginLoaded()) {
    throw new DailyNotesDisabledError();
  }

  const opts: GetUnprocessedOpts =
    todayOrOpts instanceof Date
      ? { today: todayOrOpts }
      : todayOrOpts ?? {};
  const today = opts.today ?? new Date();
  const todayStr = formatLocalDate(today);
  const all = getAllDailyNotes();
  const notes: Array<{ path: string; date: string; content: string }> = [];

  for (const file of Object.values(all)) {
    const momentDate = getDateFromFile(file, "day");
    if (!momentDate) continue;
    const date = momentDate.format("YYYY-MM-DD");
    // Bounded reads: the day is already known for free, so a note the window excludes is never
    // opened — otherwise every unattended pass still reads the whole vault's history, which is
    // the sweep the window exists to end. Only the two lexical `YYYY-MM-DD` bounds are applied
    // here; the today / includeToday rule is subtler and stays solely in
    // `collectPastNotesWithUnmarkedCaptures` rather than becoming a second copy that can drift
    // (today is one file — leaving it read costs nothing). All three bounds still run there:
    // this skips work the cheap check already proved unnecessary, it does not replace the filter.
    if (opts.since !== undefined && date < opts.since) continue;
    if (opts.before !== undefined && date >= opts.before) continue;
    const content = await app.vault.cachedRead(file);
    notes.push({ path: file.path, date, content });
  }

  const result = collectPastNotesWithUnmarkedCaptures(notes, todayStr, {
    includeToday: opts.includeToday,
    since: opts.since,
    before: opts.before,
  });
  return {
    notes: result,
    totalUnprocessed: result.reduce((n, x) => n + x.unprocessed.length, 0),
  };
}

/**
 * Resolve the daily note for a given local date (create if missing).
 *
 * The drain needs this for arbitrary past dates: a capture made on Monday
 * belongs in Monday's daily even when it reaches the vault on Thursday, and
 * that file often does not exist yet. Never opens a workspace leaf — unlike
 * openTodaysDaily, whose callers want the note in front of the user.
 *
 * Future dates are refused rather than created: a stamp ahead of the local
 * clock means device skew, not a real capture day.
 */
export async function ensureDailyForDate(
  app: App,
  date: string,
): Promise<TFile> {
  if (!appHasDailyNotesPluginLoaded()) {
    throw new DailyNotesDisabledError();
  }
  if (date > formatLocalDate(new Date())) {
    throw new FutureDailyNoteError(date);
  }

  const target = moment(date);
  const all = getAllDailyNotes();
  let file: TFile | undefined;
  try {
    file = getDailyNote(target, all) ?? undefined;
  } catch {
    file = undefined;
  }
  if (file) return file;

  const created = await createDailyNote(target);
  if (!created) {
    throw new Error(
      `Could not create the daily note for ${date}. Check Daily Notes folder settings.`,
    );
  }
  return created;
}

/**
 * Resolve today's daily note (create if missing). Returns the file only —
 * caller opens it in the workspace. Never classifies or marks the note.
 */
export async function openTodaysDaily(app: App): Promise<TFile> {
  if (!appHasDailyNotesPluginLoaded()) {
    throw new DailyNotesDisabledError();
  }
  const date = moment();
  const all = getAllDailyNotes();
  let file: TFile | undefined;
  try {
    file = getDailyNote(date, all) ?? undefined;
  } catch {
    file = undefined;
  }
  // getDailyNote may return undefined when missing depending on version
  if (!file) {
    const created = await createDailyNote(date);
    if (!created) {
      throw new Error(
        "Could not create today's daily note. Check Daily Notes folder settings.",
      );
    }
    return created;
  }
  return file;
}
