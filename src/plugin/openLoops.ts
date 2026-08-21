/**
 * Open-loops Browse / Review pure helpers (no Home chrome).
 */
import {
  measuredThingKey,
  measuredThingMentions,
} from "../pipeline/enrich/measurement";
import { looksLikeOpenLoop } from "../pipeline/openLoopHeuristic";
import {
  extractLinkProseRegion,
  parseLinkProse,
} from "../pipeline/parseLinkProse";
import { applyHardLinkToAtomContent } from "../pipeline/personInvite";
import { extractCaptureBody } from "../pipeline/refreshAtoms";
import { formatLinkProse } from "../pipeline/render";
import { relationReasonProse } from "../shared/relationReason";
import {
  REDEEMS_RELATION,
  applyOpenLoopFm,
  frontmatterBlock,
  linksIncludeRedeems,
  openNow,
  parseOpenLoopFm,
  type OpenLoopFm,
} from "../shared/openLoop";

export { applyOpenLoopFm };

function parentRelationFromFm(content: string): {
  parent?: string;
  relation?: string;
} {
  const fm = frontmatterBlock(content);
  if (!fm) return {};
  const parentM = fm.match(/^parent:\s*["']?(.+?)["']?\s*$/m);
  const relationM = fm.match(/^relation:\s*["']?(\w+)["']?\s*$/m);
  const parent = parentM?.[1]?.trim().replace(/^\[\[|\]\]$/g, "");
  const relation = relationM?.[1]?.trim();
  return {
    ...(parent ? { parent } : {}),
    ...(relation ? { relation } : {}),
  };
}

/** Titles (lowercase) that have at least one inbound redeems child among rows. */
export function collectRedeemedParentKeys(
  rows: { title: string; content: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const { parent, relation } = parentRelationFromFm(row.content);
    if (
      parent &&
      (relation || "").toLowerCase() === REDEEMS_RELATION
    ) {
      out.add(parent.toLowerCase());
    }
    const links = parseLinkProse(extractLinkProseRegion(row.content));
    for (const l of links) {
      if (!linksIncludeRedeems([l])) continue;
      const note = (l.note || "").trim();
      if (note) out.add(note.toLowerCase());
    }
  }
  return out;
}

export function isOpenNowContent(
  content: string,
  hasRedeemingChild = false,
): boolean {
  const loop = parseOpenLoopFm(content);
  if (!loop || loop.state !== "active") return false;
  return openNow({ state: loop.state, hasRedeemingChild });
}

export function openLoopMeta(content: string): OpenLoopFm | null {
  return parseOpenLoopFm(content);
}

/** Unmarked intentions eligible for Review accept/skip. */
export function isProposalCandidate(content: string, title: string): boolean {
  const loop = parseOpenLoopFm(content);
  if (loop) return false;
  return looksLikeOpenLoop(extractCaptureBody(content), title);
}

/** Active inferred marks the user may dismiss (false-open correction). */
export function isDismissCandidate(content: string): boolean {
  const loop = parseOpenLoopFm(content);
  return loop?.state === "active" && loop.source === "inferred";
}

/**
 * Loop-close offer (#589, KD4): an open loop and a newer reading of the same
 * measured thing coexist, so Home may ask whether the loop is done. An offer,
 * never a verdict: the live pair that motivated this sat 13-23 miles short of
 * its own stated return window, so no arithmetic decides here. Decline is a
 * permanent told for that pair.
 */
export type LoopCloseOffer = {
  loopPath: string;
  loopTitle: string;
  loopBody: string;
  readingPath: string;
  readingTitle: string;
  readingBody: string;
};

export function loopClosePairId(loopPath: string, readingPath: string): string {
  return `${loopPath}::${readingPath}`;
}

function createdStamp(content: string): string | null {
  const fm = frontmatterBlock(content);
  const m = fm.match(/^created:\s*["']?([0-9][0-9T:-]*)/m);
  return m?.[1] ?? null;
}

/**
 * Write the redeems edge on the reading. The model is taught to link the
 * prior reading with an ordinary series reason, so the common case is an
 * existing link to the loop title: upgrade its reason in place (a title-dedup
 * append would silently write nothing and leave the loop open forever).
 *
 * The trailing region is only *replaced* when it actually parses to links.
 * A trailing paragraph of capture text also splits off as a "prose region",
 * and rewriting it would destroy verbatim body (non-negotiable #1) — that
 * case appends a fresh link block below instead, touching nothing.
 * Null when the content already redeems or nothing changed.
 */
export function applyRedeemsLink(
  content: string,
  loopTitle: string,
): string | null {
  const want = loopTitle.trim().toLowerCase();
  if (!want) return null;
  const prose = extractLinkProseRegion(content);
  const links = parseLinkProse(prose);
  const existing = links.find((l) => l.note.trim().toLowerCase() === want);
  if (existing && prose) {
    if (linksIncludeRedeems([existing])) return null;
    const next = links.map((l) =>
      l === existing
        ? { note: l.note, reason: relationReasonProse(REDEEMS_RELATION, l.note) }
        : l,
    );
    const out = content.replace(prose, formatLinkProse(next));
    return out === content ? null : out;
  }
  return applyHardLinkToAtomContent(
    content,
    loopTitle,
    relationReasonProse(REDEEMS_RELATION, loopTitle),
  );
}

export function collectLoopCloseOffers(
  rows: { path: string; title: string; content: string }[],
  opts: { told?: Set<string> | string[] } = {},
): LoopCloseOffer[] {
  const told = new Set([...(opts.told ?? [])]);
  const redeemed = collectRedeemedParentKeys(rows);
  const loops = rows
    .filter(
      (r) =>
        isOpenNowContent(r.content) &&
        !redeemed.has(r.title.trim().toLowerCase()),
    )
    .map((r) => {
      const body = extractCaptureBody(r.content).trim();
      return {
        row: r,
        body,
        mentions: measuredThingMentions(body),
        // Day granularity: created stamps mix date-only and date-time forms,
        // and a raw string compare would call a same-day later reading older.
        day: createdStamp(r.content)?.slice(0, 10) ?? null,
      };
    })
    .filter((l) => l.day !== null);
  if (!loops.length) return [];

  const readings = rows
    .map((r) => {
      const body = extractCaptureBody(r.content).trim();
      return {
        row: r,
        body,
        key: measuredThingKey(body),
        stamp: createdStamp(r.content),
      };
    })
    .filter((r) => r.key && r.stamp)
    .sort((a, b) => (a.stamp! < b.stamp! ? 1 : a.stamp! > b.stamp! ? -1 : 0));

  // One offer per loop, against the NEWEST qualifying reading only. A told
  // (declined) newest pair silences the loop entirely — an older reading must
  // never re-ask the question with staler evidence. A future reading is a new
  // pair, so new evidence may ask again.
  const offers: (LoopCloseOffer & { stamp: string })[] = [];
  for (const loop of loops) {
    const newest = readings.find(
      (rd) =>
        rd.row.path !== loop.row.path &&
        loop.mentions.has(rd.key!) &&
        rd.stamp!.slice(0, 10) >= loop.day!,
    );
    if (!newest) continue;
    if (told.has(loopClosePairId(loop.row.path, newest.row.path))) continue;
    offers.push({
      loopPath: loop.row.path,
      loopTitle: loop.row.title,
      loopBody: loop.body,
      readingPath: newest.row.path,
      readingTitle: newest.row.title,
      readingBody: newest.body,
      stamp: newest.stamp!,
    });
  }
  return offers
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
    .map(({ stamp: _stamp, ...offer }) => offer);
}


