/**
 * Hub list preview — dry-run summary + Include Unsorted filter (pass-only).
 */

import {
  projectHubMarkdown,
  type HubProjectionEntry,
} from "./hubProjection";
import type {
  HubForProjection,
  HubProjectionPlan,
  HubProjectionPlanItem,
} from "./runHubProjection";
import { shouldWriteNonPersonHub, hubHasGeneratedDelimiters } from "./hubQualify";

export const HUB_LIST_PREVIEW_MAX_ROWS = 40;

export type HubListPreviewSectionCount = {
  name: string;
  count: number;
};

export type HubListPreviewRow = {
  hubTitle: string;
  path: string;
  total: number;
  sections: HubListPreviewSectionCount[];
};

export type HubListPreviewSummary = {
  rows: HubListPreviewRow[];
  /** Hubs beyond max rows (not shown). */
  moreCount: number;
  empty: boolean;
};

const UNSORTED = "Unsorted";

function sectionCounts(
  entries: HubProjectionEntry[],
  hubSections: string[],
): HubListPreviewSectionCount[] {
  const sectionByLow = new Map(
    hubSections
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => [s.toLowerCase(), s] as const),
  );
  const unsortedKey =
    sectionByLow.get(UNSORTED.toLowerCase()) ?? UNSORTED;
  const buckets = new Map<string, number>();
  for (const e of entries) {
    const sec = (e.section ?? "").trim();
    const key = sec
      ? sectionByLow.get(sec.toLowerCase()) ?? unsortedKey
      : unsortedKey;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const out: HubListPreviewSectionCount[] = [];
  for (const sec of hubSections) {
    const n = buckets.get(sec) ?? 0;
    if (n) out.push({ name: sec, count: n });
  }
  const u = buckets.get(unsortedKey) ?? 0;
  const hubHasU = hubSections.some(
    (s) => s.trim().toLowerCase() === UNSORTED.toLowerCase(),
  );
  if (u && !hubHasU) out.push({ name: UNSORTED, count: u });
  return out;
}

/** Build UI rows from a projection plan (changed writes only). */
export function summarizeHubProjectionPlan(
  plan: HubProjectionPlan,
  opts?: { maxRows?: number },
): HubListPreviewSummary {
  const maxRows = opts?.maxRows ?? HUB_LIST_PREVIEW_MAX_ROWS;
  const changed = plan.writes.filter((w) => w.changed);
  const rows: HubListPreviewRow[] = [];
  for (const w of changed) {
    const entries = w.entries ?? [];
    const hubSections = w.hubSections ?? [];
    const sections = sectionCounts(entries, hubSections);
    const total = entries.filter((e) => (e.title ?? "").trim()).length;
    rows.push({
      hubTitle: w.hubTitle,
      path: w.path,
      total,
      sections,
    });
  }
  rows.sort((a, b) => a.hubTitle.localeCompare(b.hubTitle));
  const moreCount = Math.max(0, rows.length - maxRows);
  const sliced = moreCount ? rows.slice(0, maxRows) : rows;
  return {
    rows: sliced,
    moreCount,
    empty: changed.length === 0,
  };
}

function entryHasSection(e: HubProjectionEntry): boolean {
  return !!(e.section ?? "").trim();
}

/**
 * When includeUnsorted is false, drop Unsorted-only atoms and re-project.
 * Hubs that become empty / brake-fail after filter are removed from writes.
 */
export function filterPlanIncludeUnsorted(
  plan: HubProjectionPlan,
  includeUnsorted: boolean,
): HubProjectionPlan {
  if (includeUnsorted) return plan;

  const writes: HubProjectionPlanItem[] = [];
  const skipped = [...plan.skipped];
  const errors = [...plan.errors];

  for (const w of plan.writes) {
    const entries = w.entries ?? [];
    const hubSections = w.hubSections ?? [];
    const kind = w.kind ?? "person";
    const kept = entries.filter(entryHasSection);
    if (!kept.length) {
      skipped.push({
        ...w,
        changed: false,
        next: w.previous,
        skipped: true,
        skipReason: "unsorted-excluded",
      });
      continue;
    }

    if (kind === "list") {
      const ok = shouldWriteNonPersonHub({
        memberCount: kept.length,
        hasMatchingHubSection: kept.some(entryHasSection),
        hubHasGeneratedDelimiters: hubHasGeneratedDelimiters(w.previous),
      });
      if (!ok) {
        skipped.push({
          ...w,
          changed: false,
          next: w.previous,
          entries: kept,
          skipped: true,
          skipReason: "non-person-write-brake",
        });
        continue;
      }
    }

    const projected = projectHubMarkdown(w.previous, kept, hubSections);
    if (!projected.ok) {
      errors.push({
        hubTitle: w.hubTitle,
        path: w.path,
        reason: projected.reason,
      });
      continue;
    }
    writes.push({
      ...w,
      entries: kept,
      next: projected.content,
      changed: projected.content !== w.previous,
    });
  }

  return { writes, errors, skipped };
}

export type HubListPreviewCopy = {
  title: string;
  body: string;
  emptyBody: string;
  includeUnsortedLabel: string;
  includeUnsortedDesc: string;
  notNowLabel: string;
  updateLabel: string;
  doneLabel: string;
  moreLabel: (n: number) => string;
  atomCountLabel: (n: number) => string;
};

export function hubListPreviewCopy(): HubListPreviewCopy {
  return {
    title: "Update hub lists?",
    body: "These notes would get a list of linked atoms at the bottom. Your writing above stays the same.",
    emptyBody:
      "No hub notes have linked atoms ready to list yet. File a few captures, then try Refresh hub lists from Settings.",
    includeUnsortedLabel: "Include Unsorted",
    includeUnsortedDesc:
      "Atoms that do not match a heading still appear under Unsorted. Turn off to only fill real headings.",
    notNowLabel: "Not now",
    updateLabel: "Update lists",
    doneLabel: "Done",
    moreLabel: (n) => `and ${n} more`,
    atomCountLabel: (n) => (n === 1 ? "1 atom" : `${n} atoms`),
  };
}

/** Unused import guard for HubForProjection if needed by callers. */
export type { HubForProjection };
