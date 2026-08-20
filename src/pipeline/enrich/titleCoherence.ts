/**
 * Post-classify title repair: do not name this atom after a context neighbour
 * the capture does not support (#66 generalized past exact-path collision).
 */

import type { ClassificationResult } from "../../shared/types";
import { tokens } from "../shortlist";
import { shortTitleFromCapture } from "./ideaRescue";

/**
 * Share this fraction of the proposed title's tokens with a context title
 * before treating it as a paraphrase of that neighbour.
 *
 * 0.6 is above a weak topical pair (sleep+debt against a different sleep note)
 * and at or below the farmers-carries paraphrase that named an iPhone capture.
 */
export const TITLE_CONTEXT_COVERAGE = 0.6;

/** At least two stemmed tokens must overlap a neighbour — one generic word is not a borrow. */
export const TITLE_CONTEXT_MIN_SHARED = 2;

function tokenSet(s: string): Set<string> {
  return new Set(tokens(s));
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

/**
 * True when the proposed title is grounded in a context Note title, not in this capture.
 *
 * Grounded-in-capture titles (any shared content token) always return false — that is the
 * same-thread continue we still want. Empty context cannot prove a borrow.
 */
export function isTitleBorrowedFromContext(
  title: string,
  captureText: string,
  noteTitles: readonly string[],
): boolean {
  const titleToks = tokenSet(title);
  if (titleToks.size === 0 || noteTitles.length === 0) return false;
  const captureToks = tokenSet(captureText);
  if (sharedCount(titleToks, captureToks) > 0) return false;

  for (const note of noteTitles) {
    const n = (note ?? "").trim();
    if (!n) continue;
    const shared = sharedCount(titleToks, tokenSet(n));
    if (shared < TITLE_CONTEXT_MIN_SHARED) continue;
    if (shared / titleToks.size >= TITLE_CONTEXT_COVERAGE) return true;
  }
  return false;
}

/**
 * If the model named this atom after a context neighbour the capture does not
 * support, replace the title with one taken from the capture. Never demotes
 * verdicts. Never rewrites body (body is written elsewhere).
 */
export function repairBorrowedTitle(
  captureText: string,
  result: ClassificationResult,
  noteTitles: readonly string[] = [],
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const title = (result.title ?? "").trim();
  if (!title) return result;
  if (!isTitleBorrowedFromContext(title, captureText, noteTitles)) return result;
  const next = shortTitleFromCapture(captureText).trim();
  if (!next || next.toLowerCase() === title.toLowerCase()) return result;
  return { ...result, title: next };
}

/** Titles the borrow check may treat as neighbours (shortlist + optional continue parent). */
export function neighbourTitlesForBorrowCheck(
  titles: readonly string[] | undefined,
  continueParentTitle?: string | null,
): string[] {
  const out = [...(titles ?? [])];
  const parent = continueParentTitle?.trim();
  if (parent && !out.some((t) => t.trim().toLowerCase() === parent.toLowerCase())) {
    out.push(parent);
  }
  return out;
}
