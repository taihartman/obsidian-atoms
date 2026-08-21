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
import { extractCaptureBody } from "../pipeline/refreshAtoms";
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

export function collectLoopCloseOffers(
  rows: { path: string; title: string; content: string }[],
  opts: { told?: Set<string> | string[] } = {},
): LoopCloseOffer[] {
  const told = new Set([...(opts.told ?? [])]);
  const redeemed = collectRedeemedParentKeys(rows);
  const loops = rows.filter(
    (r) =>
      isOpenNowContent(r.content) && !redeemed.has(r.title.trim().toLowerCase()),
  );
  if (!loops.length) return [];

  const offers: (LoopCloseOffer & { stamp: string })[] = [];
  for (const reading of rows) {
    const body = extractCaptureBody(reading.content).trim();
    const key = measuredThingKey(body);
    if (!key) continue;
    const stamp = createdStamp(reading.content);
    if (!stamp) continue;
    for (const loop of loops) {
      if (loop.path === reading.path) continue;
      const loopBody = extractCaptureBody(loop.content).trim();
      if (!measuredThingMentions(loopBody).has(key)) continue;
      const loopStamp = createdStamp(loop.content);
      if (!loopStamp || stamp < loopStamp) continue;
      if (told.has(loopClosePairId(loop.path, reading.path))) continue;
      offers.push({
        loopPath: loop.path,
        loopTitle: loop.title,
        loopBody,
        readingPath: reading.path,
        readingTitle: reading.title,
        readingBody: body,
        stamp,
      });
    }
  }
  return offers
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
    .map(({ stamp: _stamp, ...offer }) => offer);
}


