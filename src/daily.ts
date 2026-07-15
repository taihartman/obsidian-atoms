import type { App, TFile } from "obsidian";
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
import type { DailyNoteWithCaptures } from "./types";

/** Obsidian injects moment globally; daily-notes-interface expects a Moment. */
type MomentLike = {
  format: (f: string) => string;
  clone?: () => MomentLike;
};

function todayMoment(): MomentLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (globalThis as any).moment;
  if (typeof m === "function") return m() as MomentLike;
  // Fallback for tests without moment: minimal shim matching YYYY-MM-DD
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const iso = `${y}-${mo}-${day}`;
  return {
    format: (f: string) => (f === "YYYY-MM-DD" ? iso : iso),
  };
}

export class DailyNotesDisabledError extends Error {
  constructor() {
    super(
      "Atoms requires the core Daily Notes plugin to be enabled. Enable it under Settings → Core plugins.",
    );
    this.name = "DailyNotesDisabledError";
  }
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface PastDailyNotesResult {
  notes: DailyNoteWithCaptures[];
  totalUnprocessed: number;
}

/**
 * Scan **all** past daily notes for unmarked captures (never a day-level last-run
 * shortcut — amendment G). Excludes today. Throws if Daily Notes core is off.
 */
export async function getPastDailyNotesWithUnmarkedCaptures(
  app: App,
  today: Date = new Date(),
): Promise<PastDailyNotesResult> {
  if (!appHasDailyNotesPluginLoaded()) {
    throw new DailyNotesDisabledError();
  }

  const todayStr = formatLocalDate(today);
  const all = getAllDailyNotes();
  const notes: Array<{ path: string; date: string; content: string }> = [];

  for (const file of Object.values(all) as TFile[]) {
    const momentDate = getDateFromFile(file, "day");
    if (!momentDate) continue;
    const date = momentDate.format("YYYY-MM-DD");
    const content = await app.vault.cachedRead(file);
    notes.push({ path: file.path, date, content });
  }

  const result = collectPastNotesWithUnmarkedCaptures(notes, todayStr);
  return {
    notes: result,
    totalUnprocessed: result.reduce((n, x) => n + x.unprocessed.length, 0),
  };
}

/**
 * Resolve today's daily note (create if missing). Returns the file only —
 * caller opens it in the workspace. Never classifies or marks the note.
 */
export async function openTodaysDaily(app: App): Promise<TFile> {
  if (!appHasDailyNotesPluginLoaded()) {
    throw new DailyNotesDisabledError();
  }
  const date = todayMoment() as Parameters<typeof getDailyNote>[0];
  const all = getAllDailyNotes();
  let file: TFile | null = null;
  try {
    file = getDailyNote(date, all) as TFile | null;
  } catch {
    file = null;
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
