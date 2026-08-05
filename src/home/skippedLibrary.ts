/**
 * Skipped library list: daily captures marked noise|task (not atom-folder rows).
 */

import type { App } from "obsidian";
import {
  appHasDailyNotesPluginLoaded,
  getAllDailyNotes,
  getDateFromFile,
} from "obsidian-daily-notes-interface";
import { parseCaptures, isEmptyCaptureText } from "../pipeline/parse";
import { DailyNotesDisabledError, formatLocalDate } from "../pipeline/daily";
import type { MarkerKind } from "../shared/types";

export type SkippedKind = Extract<MarkerKind, "noise" | "task">;

export interface SkippedLibraryEntry {
  path: string;
  date: string;
  startLine: number;
  endLine: number;
  snippet: string;
  markerKind: SkippedKind;
  /** Newest-first sort key (higher = newer). */
  sortKey: number;
}

export interface SkippedNoteInput {
  path: string;
  date: string;
  content: string;
}

/** One-line clamp for library row (~120 chars). */
export function snippetFromCaptureText(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max - 1).trimEnd() + "…";
}

function sortKeyFor(date: string, startLine: number): number {
  const t = Date.parse(`${date}T12:00:00`);
  const base = Number.isFinite(t) ? t : 0;
  return base * 1000 + startLine;
}

/**
 * Pure: collect noise|task processed captures from daily note bodies.
 * Newest date first, then within-note startLine ascending (reading order).
 */
export function collectSkippedCaptures(
  notes: SkippedNoteInput[],
): SkippedLibraryEntry[] {
  const out: SkippedLibraryEntry[] = [];
  for (const n of notes) {
    for (const c of parseCaptures(n.content)) {
      if (!c.processed) continue;
      if (c.markerKind !== "noise" && c.markerKind !== "task") continue;
      if (isEmptyCaptureText(c.text)) continue;
      out.push({
        path: n.path,
        date: n.date,
        startLine: c.startLine,
        endLine: c.endLine,
        snippet: snippetFromCaptureText(c.text),
        markerKind: c.markerKind,
        sortKey: sortKeyFor(n.date, c.startLine),
      });
    }
  }
  out.sort((a, b) => {
    if (b.date !== a.date) return b.date < a.date ? -1 : 1;
    return a.startLine - b.startLine;
  });
  // After date desc, within same day keep reading order; overall newest days first already
  // Re-sort primarily by sortKey desc for true newest-first across days:
  out.sort((a, b) => b.sortKey - a.sortKey);
  return out;
}

/**
 * Vault scan of all dailies (including today). Never uses unmarked-only collector.
 */
export async function listSkippedLibraryEntries(
  app: App,
  today: Date = new Date(),
): Promise<SkippedLibraryEntry[]> {
  if (!appHasDailyNotesPluginLoaded()) {
    throw new DailyNotesDisabledError();
  }
  const todayStr = formatLocalDate(today);
  const all = getAllDailyNotes();
  const notes: SkippedNoteInput[] = [];
  for (const file of Object.values(all)) {
    const momentDate = getDateFromFile(file, "day");
    if (!momentDate) continue;
    const date = momentDate.format("YYYY-MM-DD");
    if (date > todayStr) continue;
    const content = await app.vault.cachedRead(file);
    notes.push({ path: file.path, date, content });
  }
  return collectSkippedCaptures(notes);
}
