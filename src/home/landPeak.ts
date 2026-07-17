/**
 * Post-write land peak — pure copy + payload helpers (Land, then remember).
 */

export type LandSource = "process" | "update" | "autorun";

export type LandedAtom = {
  title: string;
  path: string;
  meta?: string;
};

export type LandPeak = {
  source: LandSource;
  /** Full list of landed atoms (display may slice). */
  atoms: LandedAtom[];
  atomCount: number;
  markersAppended?: number;
  /** Subtitle / short summary for chrome */
  summaryLine: string;
};

export const LAND_TITLE_CAP = 3;

export type LandDisplay = {
  headline: string;
  body: string;
  rows: LandedAtom[];
  moreCount: number;
};

export function formatLandHeadline(
  source: LandSource,
  atomCount: number,
): string {
  if (source === "update") {
    if (atomCount <= 0) return "Nothing to update";
    return `Updated ${atomCount} note${atomCount === 1 ? "" : "s"}`;
  }
  if (atomCount <= 0) return "Nothing new filed";
  if (atomCount === 1) return "Filed 1 note";
  return `Filed ${atomCount} notes`;
}

export function formatLandBody(
  source: LandSource,
  atomCount: number,
  markersAppended?: number,
): string {
  if (source === "update") {
    return atomCount > 0
      ? "Titles and links refreshed. Bodies unchanged."
      : "No notes needed a refresh.";
  }
  if (atomCount <= 0) {
    const m = markersAppended ?? 0;
    if (m > 0) {
      return `${m} marker${m === 1 ? "" : "s"} written. No new atoms this run.`;
    }
    return "No new atoms this run.";
  }
  if (source === "autorun") {
    return "Automatic filing finished. Open one to check how it linked.";
  }
  return atomCount === 1
    ? "Open it to check how it linked."
    : "Open one to check how it linked.";
}

export function landDisplayFromPeak(peak: LandPeak): LandDisplay {
  const rows = peak.atoms.slice(0, LAND_TITLE_CAP);
  const moreCount = Math.max(0, peak.atomCount - rows.length);
  return {
    headline: formatLandHeadline(peak.source, peak.atomCount),
    body: formatLandBody(peak.source, peak.atomCount, peak.markersAppended),
    rows,
    moreCount,
  };
}

export function buildLandPeak(opts: {
  source: LandSource;
  atoms: LandedAtom[];
  markersAppended?: number;
}): LandPeak {
  const atoms = opts.atoms.filter((a) => (a.title ?? "").trim().length > 0);
  const atomCount = atoms.length;
  const summaryLine = formatLandHeadline(opts.source, atomCount);
  return {
    source: opts.source,
    atoms,
    atomCount,
    markersAppended: opts.markersAppended,
    summaryLine,
  };
}

/** Map process write entries → land atoms (created only). */
export function landAtomsFromWriteEntries(
  entries: Array<{
    verdict: string;
    title: string;
    write: { atomCreated?: string | null };
    planned: {
      action: {
        kind: string;
        path?: string;
        title?: string;
      };
      result?: { links?: Array<{ note?: string }> };
    };
  }>,
): LandedAtom[] {
  const out: LandedAtom[] = [];
  for (const e of entries) {
    if (e.verdict !== "atom") continue;
    const createdPath = e.write.atomCreated;
    if (!createdPath) continue;
    const action = e.planned.action;
    const path =
      typeof action.path === "string" && action.path
        ? action.path
        : createdPath;
    const title =
      (typeof action.title === "string" && action.title) ||
      e.title ||
      "";
    if (!path || !title.trim()) continue;
    const linkNote = e.planned.result?.links?.[0]?.note?.trim();
    const meta = linkNote ? `Linked · ${linkNote}` : undefined;
    out.push({ title: title.trim(), path, meta });
  }
  return out;
}

export function landAtomsFromRefreshItems(
  items: Array<{ title: string; path: string }>,
): LandedAtom[] {
  return items
    .filter((i) => i.path && i.title.trim())
    .map((i) => ({
      title: i.title.trim(),
      path: i.path,
      meta: "Links refreshed",
    }));
}
