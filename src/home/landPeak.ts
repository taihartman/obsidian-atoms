/**
 * Post-write land peak — pure copy + payload helpers (Land, then remember).
 */

import {
  wikiDisplaySegments,
  type WikiDisplaySegment,
} from "../shared/wikiDisplay";

export type LandSource = "process" | "update" | "autorun";

export type LandedLink = {
  note: string;
  reason: string;
};

export type LandedAtom = {
  title: string;
  path: string;
  meta?: string;
  links?: LandedLink[];
};

export type LandPeak = {
  source: LandSource;
  /** Full list of landed atoms (display may slice). */
  atoms: LandedAtom[];
  atomCount: number;
  /** Process: task + noise captures in this run. */
  skippedCount?: number;
  markersAppended?: number;
  /** Update notes: classify/write failures (do not treat as "nothing to update"). */
  failedCount?: number;
  /** Update notes: free local polish count (Phase A). */
  polishedCount?: number;
  /** Subtitle / short summary for chrome */
  summaryLine: string;
};

export const LAND_TITLE_CAP = 3;

export type SpokenSegment = WikiDisplaySegment;

export type LandDisplay = {
  headline: string;
  body: string;
  rows: LandedAtom[];
  moreCount: number;
  sentence: string | null;
  /** Segments for the Home card so wikilinks render as names, not `[[…]]`. */
  sentenceParts: SpokenSegment[] | null;
  featured: LandedAtom | null;
  tally: string;
  /** True when update run had failures (error-toned Done card). */
  isFailure?: boolean;
};

export function spokenLandSentence(link: LandedLink): {
  sentence: string;
  parts: SpokenSegment[];
} {
  const raw = link.reason.trim();
  if (raw) {
    const parts = wikiDisplaySegments(raw);
    const sentence = parts.map((s) => s.text).join("");
    if (sentence) return { sentence, parts };
  }
  const note = link.note.trim();
  return {
    sentence: note,
    parts: note ? [{ kind: "link", text: note }] : [],
  };
}

export function namedLinksOf(atom: LandedAtom): LandedLink[] {
  return (atom.links ?? []).filter((l) => l.note.trim().length > 0);
}

export function pickSpokenLandAtom(atoms: LandedAtom[]): LandedAtom | null {
  const withNamed = atoms.filter((a) => namedLinksOf(a).length > 0);
  if (!withNamed.length) return null;
  const withReason = withNamed.find((a) =>
    namedLinksOf(a).some((l) => l.reason.trim().length > 0),
  );
  return withReason ?? withNamed[0] ?? null;
}

export function pickSpokenLink(atom: LandedAtom): LandedLink | null {
  const named = namedLinksOf(atom);
  if (!named.length) return null;
  return named.find((l) => l.reason.trim().length > 0) ?? named[0] ?? null;
}

export function formatLandSentence(link: LandedLink): string {
  return spokenLandSentence(link).sentence;
}

export function formatLandTally(filed: number, skipped: number): string {
  if (filed <= 0) return "";
  if (skipped <= 0) return `${filed} filed`;
  return `${filed} filed · ${skipped} noise`;
}

export function formatLandHeadline(
  source: LandSource,
  atomCount: number,
  failedCount: number = 0,
  polishedCount: number = 0,
): string {
  if (source === "update") {
    if (atomCount <= 0 && polishedCount <= 0 && failedCount <= 0) {
      return "Nothing to update";
    }
    if (atomCount <= 0 && polishedCount <= 0 && failedCount > 0) {
      return failedCount === 1
        ? "Couldn't update 1 note"
        : `Couldn't update ${failedCount} notes`;
    }
    if (atomCount <= 0 && polishedCount > 0) {
      return polishedCount === 1
        ? "Cleaned up 1 note"
        : `Cleaned up ${polishedCount} notes`;
    }
    if (failedCount > 0) {
      return `Updated ${atomCount} · ${failedCount} failed`;
    }
    if (polishedCount > 0) {
      return `Updated ${atomCount} · polished ${polishedCount}`;
    }
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
  failedCount: number = 0,
  polishedCount: number = 0,
): string {
  if (source === "update") {
    if (atomCount <= 0 && polishedCount <= 0 && failedCount > 0) {
      return "Check Settings → model id and API key, then try Update again.";
    }
    if (atomCount > 0 && failedCount > 0) {
      return "Some notes refreshed. Failed ones stay eligible. Try Update again.";
    }
    if (atomCount <= 0 && polishedCount > 0) {
      return "Cleaned up older link wording. Bodies unchanged.";
    }
    if (atomCount > 0 && polishedCount > 0) {
      return "Titles and links refreshed; weak wording cleaned up. Bodies unchanged.";
    }
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
  const failed = peak.failedCount ?? 0;
  const polished = peak.polishedCount ?? 0;
  const skipped = peak.skippedCount ?? 0;
  const processLike = peak.source === "process" || peak.source === "autorun";
  const featured = processLike ? pickSpokenLandAtom(peak.atoms) : null;
  const spoken = featured ? pickSpokenLink(featured) : null;
  const spokenOut = processLike && spoken ? spokenLandSentence(spoken) : null;
  const sentence =
    spokenOut && spokenOut.sentence ? spokenOut.sentence : null;
  const sentenceParts = sentence && spokenOut ? spokenOut.parts : null;
  const tally = processLike ? formatLandTally(peak.atomCount, skipped) : "";
  const rows = processLike
    ? featured
      ? [featured]
      : []
    : peak.atoms.slice(0, LAND_TITLE_CAP);
  const moreCount = processLike
    ? 0
    : Math.max(0, peak.atomCount - rows.length);
  let headline = formatLandHeadline(
    peak.source,
    peak.atomCount,
    failed,
    polished,
  );
  let body = formatLandBody(
    peak.source,
    peak.atomCount,
    peak.markersAppended,
    failed,
    polished,
  );
  if (processLike && peak.atomCount > 0) {
    headline = sentence ? "Filed, and linked" : "Filed";
    body = tally;
  }
  return {
    headline,
    body,
    rows,
    moreCount,
    sentence,
    sentenceParts,
    featured,
    tally,
    isFailure:
      peak.source === "update" &&
      failed > 0 &&
      peak.atomCount <= 0 &&
      polished <= 0,
  };
}

export function buildLandPeak(opts: {
  source: LandSource;
  atoms: LandedAtom[];
  skippedCount?: number;
  markersAppended?: number;
  failedCount?: number;
  polishedCount?: number;
  /**
   * Update notes: AI refile count for headlines (may differ from atoms.length
   * when land rows show polish-only titles).
   */
  updatedCount?: number;
}): LandPeak {
  const atoms = opts.atoms.filter((a) => (a.title ?? "").trim().length > 0);
  const failedCount = Math.max(0, opts.failedCount ?? 0);
  const polishedCount = Math.max(0, opts.polishedCount ?? 0);
  const skippedCount = Math.max(0, opts.skippedCount ?? 0);
  const atomCount =
    opts.source === "update" && opts.updatedCount !== undefined
      ? Math.max(0, opts.updatedCount)
      : atoms.length;
  const summaryLine = formatLandHeadline(
    opts.source,
    atomCount,
    failedCount,
    polishedCount,
  );
  return {
    source: opts.source,
    atoms,
    atomCount,
    skippedCount: skippedCount > 0 ? skippedCount : undefined,
    markersAppended: opts.markersAppended,
    failedCount: failedCount > 0 ? failedCount : undefined,
    polishedCount: polishedCount > 0 ? polishedCount : undefined,
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
      result?: { links?: Array<{ note?: string; reason?: string }> };
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
    const links = (e.planned.result?.links ?? [])
      .map((l) => ({
        note: (l.note ?? "").trim(),
        reason: (l.reason ?? "").trim(),
      }))
      .filter((l) => l.note.length > 0);
    out.push({
      title: title.trim(),
      path,
      links: links.length ? links : undefined,
    });
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
