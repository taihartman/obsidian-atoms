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
  OPEN_LOOP_KEY,
  OPEN_LOOP_SOURCE_KEY,
  canClassifierWrite,
  formatOpenLoopFmLines,
  linksIncludeRedeems,
  openNow,
  parseOpenLoopFm,
  type OpenLoopFm,
} from "../shared/openLoop";

function bodyAfterFm(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  return content.slice(end + 4).replace(/^\n/, "");
}

/** Titles (lowercase) that have at least one inbound redeems child among rows. */
export function collectRedeemedParentKeys(
  rows: { title: string; content: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const links = parseLinkProse(extractLinkProseRegion(row.content));
    if (!linksIncludeRedeems(links)) continue;
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

/** Review candidates: heuristic hit and classifier may still write. */
export function isProposalCandidate(content: string, title: string): boolean {
  const loop = parseOpenLoopFm(content);
  if (!canClassifierWrite(loop)) return false;
  if (loop?.state === "active") return false;
  return looksLikeOpenLoop(extractCaptureBody(content), title);
}

export function applyOpenLoopFm(content: string, next: OpenLoopFm): string {
  const body = bodyAfterFm(content);
  if (!content.startsWith("---") || content.indexOf("\n---", 3) < 0) {
    return ["---", ...formatOpenLoopFmLines(next), "---", "", body].join("\n");
  }
  const end = content.indexOf("\n---", 3);
  const fm = content.slice(0, end + 4);
  const without = fm
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith(`${OPEN_LOOP_KEY}:`) &&
        !line.startsWith(`${OPEN_LOOP_SOURCE_KEY}:`),
    );
  const close = without.lastIndexOf("---");
  const head = close > 0 ? without.slice(0, close) : without.slice(0, -1);
  const tail = close > 0 ? without.slice(close) : ["---"];
  const nextFm = [...head, ...formatOpenLoopFmLines(next), ...tail].join("\n");
  return nextFm + (body.startsWith("\n") ? body : `\n${body}`);
}
