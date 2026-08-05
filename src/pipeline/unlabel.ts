/**
 * Strip-only unlabel for skipped (noise|task) captures — home Library path.
 * Body sacred; no classify. Promote remains Reconsider.
 */

import { TFile, type App } from "obsidian";
import type { Capture, MarkerKind } from "../shared/types";
import { parseCaptures } from "./parse";
import {
  insertMarkerAfterCapture,
  markerLineForDecision,
  stripMarkersAfterCapture,
  captureTextsMatch,
} from "./render";
import { findCaptureAtLine, gateReconsiderTarget } from "./reconsider";

export type SkippedMarkerKind = Extract<MarkerKind, "noise" | "task">;

export type UnlabelContentResult =
  | {
      ok: true;
      content: string;
      kind: SkippedMarkerKind;
      capture: Capture;
    }
  | { ok: false; reason: "none" | "atom" | "unprocessed" | "not_skip" | "unchanged" };

export type RestoreContentResult =
  | { ok: true; content: string }
  | {
      ok: false;
      reason: "none" | "already_marked" | "not_found" | "unchanged";
    };

export function resolveSkippedCapture(
  content: string,
  opts: { startLine: number; snippet: string },
): Capture | null {
  const byLine = findCaptureAtLine(content, opts.startLine);
  if (byLine && captureTextsMatch(byLine.text, opts.snippet.replace(/…$/, ""))) {
    return byLine;
  }
  if (byLine && byLine.startLine === opts.startLine) return byLine;
  const caps = parseCaptures(content);
  const snip = opts.snippet.replace(/…$/, "").trim();
  for (const c of caps) {
    if (
      c.processed &&
      (c.markerKind === "noise" || c.markerKind === "task") &&
      (captureTextsMatch(c.text, snip) ||
        c.text.replace(/\s+/g, " ").trim().startsWith(snip.slice(0, 40)))
    ) {
      return c;
    }
  }
  return byLine;
}

/** Pure strip of one noise|task marker region. */
export function unlabelSkippedInContent(
  content: string,
  opts: { startLine: number; snippet: string },
): UnlabelContentResult {
  const capture = resolveSkippedCapture(content, opts);
  const gate = gateReconsiderTarget(capture);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const kind = gate.capture.markerKind as SkippedMarkerKind;
  const stripped = stripMarkersAfterCapture(content, gate.capture);
  if (stripped.removed === 0) {
    return { ok: false, reason: "unchanged" };
  }
  return {
    ok: true,
    content: stripped.content,
    kind,
    capture: gate.capture,
  };
}

/** Pure restore prior noise|task marker when still unprocessed. */
export function restoreSkippedInContent(
  content: string,
  opts: { startLine: number; snippet: string; kind: SkippedMarkerKind },
): RestoreContentResult {
  const capture = resolveSkippedCapture(content, {
    startLine: opts.startLine,
    snippet: opts.snippet,
  });
  if (!capture) return { ok: false, reason: "not_found" };
  if (capture.processed) {
    if (capture.markerKind === "noise" || capture.markerKind === "task") {
      return { ok: false, reason: "already_marked" };
    }
    if (capture.markerKind === "atom") {
      return { ok: false, reason: "already_marked" };
    }
  }
  const marker = markerLineForDecision(opts.kind, "");
  const inserted = insertMarkerAfterCapture(content, capture, marker);
  if (!inserted.changed) return { ok: false, reason: "unchanged" };
  return { ok: true, content: inserted.content };
}

export type VaultUnlabelResult =
  | { ok: true; kind: SkippedMarkerKind }
  | { ok: false; reason: string };

export async function applyUnlabelWrite(
  app: App,
  path: string,
  opts: { startLine: number; snippet: string },
): Promise<VaultUnlabelResult> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { ok: false, reason: "missing" };
  let result: VaultUnlabelResult = { ok: false, reason: "unchanged" };
  await app.vault.process(file, (data) => {
    const r = unlabelSkippedInContent(data, opts);
    if (!r.ok) {
      result = { ok: false, reason: r.reason };
      return data;
    }
    result = { ok: true, kind: r.kind };
    return r.content;
  });
  return result;
}

export async function applyRestoreWrite(
  app: App,
  path: string,
  opts: { startLine: number; snippet: string; kind: SkippedMarkerKind },
): Promise<VaultUnlabelResult> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { ok: false, reason: "missing" };
  let result: VaultUnlabelResult = { ok: false, reason: "unchanged" };
  await app.vault.process(file, (data) => {
    const r = restoreSkippedInContent(data, opts);
    if (!r.ok) {
      result = { ok: false, reason: r.reason };
      return data;
    }
    result = { ok: true, kind: opts.kind };
    return r.content;
  });
  return result;
}

export function unlabelNoticeMessage(
  sourceDate: string,
  todayYmd: string,
): string {
  if (sourceDate === todayYmd) {
    return "Unlabeled — Process today to reclassify";
  }
  return "Unlabeled — will show on next Process";
}

export const UNDO_TTL_MS = 12_000;
