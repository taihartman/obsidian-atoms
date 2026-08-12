/**
 * Open-loops Browse / Review pure helpers (no Home chrome).
 */
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


