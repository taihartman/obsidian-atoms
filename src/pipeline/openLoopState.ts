/**
 * Open-loop state helpers: Browse / Review gating and the loop-close offer
 * (#589). Pure — no Obsidian imports; consumed by plugin/openLoopsUi and home.
 */
import {
  measuredThingKey,
  measuredThingMentions,
} from "./enrich/measurement";
import { looksLikeOpenLoop } from "./openLoopHeuristic";
import {
  extractLinkProseRegion,
  parseLinkProse,
} from "./parseLinkProse";
import { applyHardLinkToAtomContent } from "./personInvite";
import { extractCaptureBody } from "./refreshAtoms";
import {
  REDEEMS_RELATION,
  applyOpenLoopFm,
  frontmatterBlock,
  linksIncludeRedeems,
  openNow,
  parseOpenLoopFm,
  type OpenLoopFm,
} from "../shared/openLoop";
import { relationReasonProse } from "../shared/relationReason";

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
  readingBody: string;
};

export function loopClosePairId(loopPath: string, readingPath: string): string {
  return `${loopPath}::${readingPath}`.toLowerCase();
}

/** Card copy, pure so tests can pin it like every other Home card's. */
export function loopCloseCardCopy(): {
  kicker: string;
  title: string;
  thenLabel: string;
  nowLabel: string;
  closeLabel: string;
  closeBusyLabel: string;
  keepLabel: string;
} {
  return {
    kicker: "Loops",
    title: "Does this close a loop?",
    thenLabel: "Then",
    nowLabel: "Now",
    closeLabel: "Close it",
    closeBusyLabel: "Closing…",
    keepLabel: "Keep it open",
  };
}

/**
 * Day + stamp from the created frontmatter line. Day granularity drives
 * ordering against loops (stamps mix date-only and date-time forms); the
 * finer stamp only picks the newest among qualifying readings. Tolerates
 * "T" or space separators and trailing timezone text.
 */
const CREATED_RE = /^created:\s*["']?(\d{4}-\d{2}-\d{2})(?:[T ]([0-9:]+))?/m;

function createdStamp(
  content: string,
): { day: string; stamp: string } | null {
  const m = frontmatterBlock(content).match(CREATED_RE);
  if (!m?.[1]) return null;
  return { day: m[1], stamp: m[2] ? `${m[1]}T${m[2]}` : m[1] };
}

function byStampDesc(a: { stamp: string }, b: { stamp: string }): number {
  return a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0;
}

/**
 * Write the redeems edge on the reading. The model is taught to link the
 * prior reading with an ordinary series reason, so the common case is an
 * existing link to the loop title: upgrade its reason in place (a title-dedup
 * append would silently write nothing and leave the loop open forever).
 * Null when the content already redeems or nothing changed. Body-safety
 * (never rewriting a trailing capture paragraph) lives in
 * applyHardLinkToAtomContent, the one home for that rule.
 */
export function applyRedeemsLink(
  content: string,
  loopTitle: string,
): string | null {
  const want = loopTitle.trim().toLowerCase();
  if (!want) return null;
  const existing = parseLinkProse(extractLinkProseRegion(content)).find(
    (l) => l.note.trim().toLowerCase() === want,
  );
  if (existing && linksIncludeRedeems([existing])) return null;
  return applyHardLinkToAtomContent(
    content,
    loopTitle,
    relationReasonProse(REDEEMS_RELATION, loopTitle),
    { upgradeReason: true },
  );
}

export function collectLoopCloseOffers(
  rows: { path: string; title: string; content: string }[],
  opts: { told?: Set<string> } = {},
): LoopCloseOffer[] {
  const told = opts.told ?? new Set<string>();

  // Open loops first: the frontmatter parse is cheap, and an empty result
  // skips the full-content redeem scan and reading passes entirely.
  const open = rows.filter((r) => isOpenNowContent(r.content));
  if (!open.length) return [];

  const redeemed = collectRedeemedParentKeys(rows);
  const loops = open
    .filter((r) => !redeemed.has(r.title.trim().toLowerCase()))
    .map((r) => {
      const body = extractCaptureBody(r.content).trim();
      return {
        row: r,
        body,
        mentions: measuredThingMentions(body),
        created: createdStamp(r.content),
      };
    })
    .filter((l) => l.created !== null && l.mentions.size > 0);
  if (!loops.length) return [];

  const wanted = new Set(loops.flatMap((l) => [...l.mentions]));
  const readings: {
    row: { path: string; title: string; content: string };
    body: string;
    key: string;
    day: string;
    stamp: string;
  }[] = [];
  for (const r of rows) {
    const body = extractCaptureBody(r.content).trim();
    const key = measuredThingKey(body);
    if (!key || !wanted.has(key)) continue;
    const created = createdStamp(r.content);
    if (!created) continue;
    readings.push({ row: r, body, key, ...created });
  }
  readings.sort(byStampDesc);

  // One offer per loop, against the NEWEST qualifying reading only. A told
  // (declined) newest pair silences the loop entirely — an older reading must
  // never re-ask the question with staler evidence. A future reading is a new
  // pair, so new evidence may ask again.
  const paired: { offer: LoopCloseOffer; stamp: string }[] = [];
  for (const loop of loops) {
    const newest = readings.find(
      (rd) =>
        rd.row.path !== loop.row.path &&
        loop.mentions.has(rd.key) &&
        rd.day >= loop.created!.day,
    );
    if (!newest) continue;
    if (told.has(loopClosePairId(loop.row.path, newest.row.path))) continue;
    paired.push({
      stamp: newest.stamp,
      offer: {
        loopPath: loop.row.path,
        loopTitle: loop.row.title,
        loopBody: loop.body,
        readingPath: newest.row.path,
        readingBody: newest.body,
      },
    });
  }
  return paired.sort(byStampDesc).map((p) => p.offer);
}
