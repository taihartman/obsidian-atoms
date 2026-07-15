import type { App, TFile } from "obsidian";
import {
  appHasDailyNotesPluginLoaded,
  getAllDailyNotes,
  getDateFromFile,
} from "obsidian-daily-notes-interface";
import {
  collectPastNotesWithUnmarkedCaptures,
} from "./parse";
import type { DailyNoteWithCaptures } from "./types";

export class DailyNotesDisabledError extends Error {
  constructor() {
    super(
      "AI Linker requires the core Daily Notes plugin to be enabled. Enable it under Settings → Core plugins.",
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
