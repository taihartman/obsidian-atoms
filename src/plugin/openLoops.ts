/**
 * Open-loops Browse / Review pure helpers (no Home chrome).
 */
import { looksLikeOpenLoop } from "../pipeline/openLoopHeuristic";
import { parseLinkProse } from "../pipeline/parseLinkProse";
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

export type OpenLoopRow = {
  path: string;
  title: string;
  state: OpenLoopFm["state"];
  source: OpenLoopFm["source"];
};

function bodyAndFm(content: string): { fm: string; body: string } {
  if (!content.startsWith("---")) return { fm: "", body: content };
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { fm: "", body: content };
  return {
    fm: content.slice(0, end + 4),
    body: content.slice(end + 4).replace(/^\n/, ""),
  };
}

function linksFromBody(body: string): { note: string; reason?: string }[] {
  const region = body.includes("\n\n")
    ? body.slice(body.lastIndexOf("\n\n") + 2)
    : body;
  return parseLinkProse(region).map((l) => ({
    note: l.note,
    reason: l.reason,
  }));
}

export function isOpenNowContent(content: string): boolean {
  const { fm, body } = bodyAndFm(content);
  const loop = parseOpenLoopFm(fm);
  if (!loop) return false;
  return openNow({
    state: loop.state,
    hasRedeemingChild: linksIncludeRedeems(linksFromBody(body)),
  });
}

export function openLoopMeta(
  content: string,
): OpenLoopFm | null {
  return parseOpenLoopFm(bodyAndFm(content).fm);
}

/** Review candidates: heuristic hit and classifier may still write. */
export function isProposalCandidate(content: string, title: string): boolean {
  const { fm, body } = bodyAndFm(content);
  const loop = parseOpenLoopFm(fm);
  if (!canClassifierWrite(loop)) return false;
  if (loop?.state === "active") return false;
  return looksLikeOpenLoop(body, title);
}

export function applyOpenLoopFm(
  content: string,
  next: OpenLoopFm,
): string {
  const { fm, body } = bodyAndFm(content);
  if (!fm) {
    const lines = ["---", ...formatOpenLoopFmLines(next), "---", "", body];
    return lines.join("\n");
  }
  const without = fm
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith(`${OPEN_LOOP_KEY}:`) &&
        !line.startsWith(`${OPEN_LOOP_SOURCE_KEY}:`),
    );
  const insertAt = without.findIndex((l) => l.trim() === "---" && without.indexOf(l) > 0);
  const head = insertAt > 0 ? without.slice(0, insertAt) : without.slice(0, -1);
  const tail = insertAt > 0 ? without.slice(insertAt) : ["---"];
  const nextFm = [...head, ...formatOpenLoopFmLines(next), ...tail].join("\n");
  return nextFm + (body.startsWith("\n") ? body : `\n${body}`);
}
