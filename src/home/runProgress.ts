/**
 * Pure helpers for Preview/Process progress UI on Atoms home.
 */

import type { DryRunReport } from "../pipeline/preview";
import type { WritePathReport } from "../pipeline/write";

export type RunProgressMeta = {
  captureText?: string;
};

export type RunPhase =
  | "idle"
  | "preview"
  | "process"
  | "update"
  | "done"
  | "error";

export type RunSummary = {
  atoms: number;
  tasks: number;
  noise: number;
  failed: number;
  mode: "preview" | "process" | "update";
};

export function snippetCapture(text: string, max = 72): string {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "…";
  if (one.length <= max) return one;
  return one.slice(0, max - 1) + "…";
}

export function formatRunSummary(s: RunSummary): string {
  const parts: string[] = [];
  if (s.atoms) parts.push(`${s.atoms} atom${s.atoms === 1 ? "" : "s"}`);
  if (s.tasks) parts.push(`${s.tasks} task${s.tasks === 1 ? "" : "s"}`);
  if (s.noise) parts.push(`${s.noise} noise`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (!parts.length) {
    return s.mode === "preview" ? "Nothing to preview" : "Nothing to process";
  }
  const head = s.mode === "preview" ? "Preview done" : "Done";
  return `${head} · ${parts.join(" · ")}`;
}

function tallyVerdict(
  verdict: string | undefined,
  ok: boolean,
  acc: RunSummary,
): void {
  if (!ok) {
    acc.failed += 1;
    return;
  }
  if (verdict === "atom") acc.atoms += 1;
  else if (verdict === "task") acc.tasks += 1;
  else if (verdict === "noise") acc.noise += 1;
  else acc.failed += 1;
}

export function summaryFromDryRun(report: DryRunReport): RunSummary {
  const acc: RunSummary = {
    atoms: 0,
    tasks: 0,
    noise: 0,
    failed: 0,
    mode: "preview",
  };
  for (const e of report.entries) {
    if (!e.outcome.ok) {
      acc.failed += 1;
      continue;
    }
    tallyVerdict(e.outcome.result.verdict, true, acc);
  }
  return acc;
}

export function summaryFromWrite(report: WritePathReport): RunSummary {
  const acc: RunSummary = {
    atoms: 0,
    tasks: 0,
    noise: 0,
    failed: report.failed,
    mode: "process",
  };
  for (const e of report.entries) {
    tallyVerdict(e.verdict, true, acc);
  }
  // failed is already aggregate from write path (classify failures not in entries)
  return acc;
}

/** Progress fraction 0–100 for bar width. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function progressLabel(
  phase: "preview" | "process" | "update",
  done: number,
  total: number,
): string {
  const verb =
    phase === "preview"
      ? "Previewing"
      : phase === "update"
        ? "Updating"
        : "Processing";
  if (total <= 0) return `${verb}…`;
  return `${verb} ${done} of ${total}`;
}

export function formatUpdateSummary(opts: {
  updated: number;
  remaining: number;
  failed: number;
  skipped: number;
}): string {
  const parts: string[] = [];
  if (opts.updated) {
    parts.push(
      `Updated ${opts.updated} note${opts.updated === 1 ? "" : "s"}`,
    );
  } else {
    parts.push("No notes updated");
  }
  if (opts.remaining > 0) {
    parts.push(
      `${opts.remaining} still older`,
    );
  }
  if (opts.failed) parts.push(`${opts.failed} failed`);
  if (opts.skipped) parts.push(`${opts.skipped} skipped`);
  return parts.join(" · ");
}
