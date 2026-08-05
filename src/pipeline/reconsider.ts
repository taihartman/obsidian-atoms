import { TFile, type App } from "obsidian";
import { getDateFromFile } from "obsidian-daily-notes-interface";
import type {
  Capture,
  ClassificationResult,
  MarkerKind,
  Verdict,
} from "../shared/types";
import { parseCaptures } from "./parse";
import {
  captureTextsMatch,
  listAtomPaths,
  planWrite,
  replaceMarkerAfterCapture,
  type ApplyWriteResult,
  type PlannedWrite,
} from "./render";
import { extractCaptureBody } from "./refreshAtoms";
import { shortTitleFromCapture } from "./enrich/ideaRescue";

export type ReconsiderTargetGate =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "none" | "atom" | "unprocessed" | "not_skip" };

/** Capture under cursor: body lines or the marker line immediately after extent. */
export function findCaptureAtLine(
  content: string,
  line0: number,
): Capture | null {
  if (line0 < 0) return null;
  const caps = parseCaptures(content);
  for (const c of caps) {
    if (line0 >= c.startLine && line0 <= c.endLine) return c;
    if (c.markerLine !== null && line0 === c.markerLine) return c;
  }
  const lines = content.split(/\r?\n/);
  if (line0 >= lines.length) return null;
  const line = lines[line0] ?? "";
  if (
    !/^\s*(?:↳ .*\[\[.*\]\].*<!--linker-->|<!--linker:(?:task|noise)-->)\s*$/.test(
      line,
    )
  ) {
    return null;
  }
  for (let i = caps.length - 1; i >= 0; i--) {
    const c = caps[i]!;
    if (c.endLine >= line0) continue;
    let blocked = false;
    for (let j = c.endLine + 1; j < line0; j++) {
      if (/^- /.test(lines[j]!)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return c;
  }
  return null;
}

export function gateReconsiderTarget(
  capture: Capture | null,
): ReconsiderTargetGate {
  if (!capture) return { ok: false, reason: "none" };
  if (!capture.processed) return { ok: false, reason: "unprocessed" };
  if (capture.markerKind === "atom") return { ok: false, reason: "atom" };
  if (capture.markerKind === "noise" || capture.markerKind === "task") {
    return { ok: true, capture };
  }
  return { ok: false, reason: "not_skip" };
}

/**
 * Locate a noise|task capture for Library Skipped → Reconsider.
 * Prefer full `text` body match; never accept line number alone.
 */
export function resolveSkippedCapture(
  content: string,
  opts: { startLine: number; snippet: string; text?: string },
): Capture | null {
  const bodyKey = (opts.text ?? opts.snippet.replace(/…$/, "")).trim();
  const caps = parseCaptures(content).filter(
    (c) =>
      c.processed &&
      (c.markerKind === "noise" || c.markerKind === "task"),
  );

  if (opts.text) {
    const exact = caps.find((c) => captureTextsMatch(c.text, opts.text!));
    if (exact) return exact;
  }

  const byLine = findCaptureAtLine(content, opts.startLine);
  if (
    byLine &&
    (byLine.markerKind === "noise" || byLine.markerKind === "task") &&
    byLine.processed &&
    (captureTextsMatch(byLine.text, bodyKey) ||
      byLine.text.replace(/\s+/g, " ").trim().startsWith(bodyKey.slice(0, 40)))
  ) {
    return byLine;
  }

  for (const c of caps) {
    if (
      captureTextsMatch(c.text, bodyKey) ||
      c.text.replace(/\s+/g, " ").trim().startsWith(bodyKey.slice(0, 40))
    ) {
      return c;
    }
  }
  return null;
}

export function labelSkipKind(kind: MarkerKind | null): string {
  if (kind === "atom") return "Note";
  return "Skipped";
}

export function labelVerdict(verdict: Verdict): string {
  return verdict === "atom" ? "Note" : "Skipped";
}

/** Apply only when proposed is atom (promote). Same-skip = no write. */
export function canApplyReconsider(
  nowKind: MarkerKind | null,
  proposed: Verdict,
): boolean {
  if (proposed !== "atom") return false;
  if (nowKind === "atom") return false;
  return nowKind === "noise" || nowKind === "task";
}

export function missNotice(): string {
  return "Place the cursor on a skipped capture, then try again.";
}

export function atomRefuseNotice(): string {
  return "This one already became a note. Open it or edit the daily yourself.";
}

export function flagOffNotice(): string {
  return "Turn on Reconsider capture in Settings → Atoms.";
}

export function collisionNotice(): string {
  return "Couldn’t file — a note with that claim already exists.";
}

export function filedNotice(title: string): string {
  const t = title.trim() || "note";
  return `Filed as “${t}”`;
}

/** User override when the model still says skip — keep as atom with body-derived title. */
export function forceKeepAtomResult(captureText: string): ClassificationResult {
  return {
    verdict: "atom",
    title: shortTitleFromCapture(captureText),
    tags: ["list"],
    proposed_tags: [],
    links: [],
  };
}

export interface ReconsiderApplyOpts {
  app: App;
  dailyPath: string;
  dailyDate: string;
  capture: Capture;
  result: ClassificationResult;
  atomFolder: string;
}

export interface ReconsiderApplyReport {
  ok: boolean;
  reason?: "no_change" | "collision" | "missing_daily" | "stale" | "error";
  write?: ApplyWriteResult;
  planned?: PlannedWrite;
  title?: string;
}

/**
 * Promote skipped capture → atom: create atom (collision body-gate), replace marker.
 * Re-resolves capture by body text before write; daily marker via vault.process.
 */
export async function applyReconsiderWrite(
  opts: ReconsiderApplyOpts,
): Promise<ReconsiderApplyReport> {
  if (!canApplyReconsider(opts.capture.markerKind, opts.result.verdict)) {
    return { ok: false, reason: "no_change" };
  }

  const dailyFile = opts.app.vault.getAbstractFileByPath(opts.dailyPath);
  if (!(dailyFile instanceof TFile)) {
    return { ok: false, reason: "missing_daily" };
  }

  // Fresh daily + body identity before creating an atom (avoid orphan on drift).
  const dailyContent = await opts.app.vault.cachedRead(dailyFile);
  const live =
    resolveSkippedCapture(dailyContent, {
      startLine: opts.capture.startLine,
      snippet: opts.capture.text,
      text: opts.capture.text,
    }) ?? null;
  const gate = gateReconsiderTarget(live);
  if (!gate.ok) {
    return { ok: false, reason: "stale" };
  }
  const capture = gate.capture;

  const existingAtoms = listAtomPaths(opts.app, opts.atomFolder);
  const planned = planWrite({
    result: opts.result,
    capture,
    dailyPath: opts.dailyPath,
    dailyDate: opts.dailyDate,
    atomFolder: opts.atomFolder,
    existingAtomPaths: existingAtoms,
  });

  let atomCreated: string | null = null;
  let atomSkippedCollision: string | null = null;

  const bodyOk = async (path: string): Promise<boolean> => {
    const f = opts.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return false;
    const atomContent = await opts.app.vault.read(f);
    return captureTextsMatch(extractCaptureBody(atomContent), capture.text);
  };

  if (planned.action.kind === "create_atom") {
    const folder = planned.action.path.split("/").slice(0, -1).join("/");
    if (folder) {
      const folderExists = opts.app.vault.getAbstractFileByPath(folder);
      if (!folderExists) {
        await opts.app.vault.createFolder(folder);
      }
    }
    const existing = opts.app.vault.getAbstractFileByPath(planned.action.path);
    if (!existing) {
      await opts.app.vault.create(planned.action.path, planned.action.content);
      atomCreated = planned.action.path;
    } else {
      if (!(await bodyOk(planned.action.path))) {
        return {
          ok: false,
          reason: "collision",
          planned,
          title: opts.result.title,
          write: {
            atomCreated: null,
            atomUpdated: null,
            atomSkippedCollision: planned.action.path,
            markerAppended: false,
            dailyPath: opts.dailyPath,
            collisionBodyMismatch: true,
          },
        };
      }
      atomSkippedCollision = planned.action.path;
    }
  } else if (planned.action.kind === "skip_existing_atom") {
    if (!(await bodyOk(planned.action.path))) {
      return {
        ok: false,
        reason: "collision",
        planned,
        title: opts.result.title,
        write: {
          atomCreated: null,
          atomUpdated: null,
          atomSkippedCollision: planned.action.path,
          markerAppended: false,
          dailyPath: opts.dailyPath,
          collisionBodyMismatch: true,
        },
      };
    }
    atomSkippedCollision = planned.action.path;
  }

  let markerAppended = false;
  await opts.app.vault.process(dailyFile, (data) => {
    const again =
      resolveSkippedCapture(data, {
        startLine: capture.startLine,
        snippet: capture.text,
        text: capture.text,
      }) ?? null;
    const g2 = gateReconsiderTarget(again);
    if (!g2.ok) return data;
    const { content: next, changed } = replaceMarkerAfterCapture(
      data,
      g2.capture,
      planned.markerLine,
    );
    markerAppended = changed;
    return next;
  });

  return {
    ok: true,
    planned,
    title: opts.result.title.trim(),
    write: {
      atomCreated,
      atomUpdated: null,
      atomSkippedCollision,
      markerAppended,
      dailyPath: opts.dailyPath,
      collisionBodyMismatch: false,
    },
  };
}

export function dailyDateForFile(app: App, file: TFile): string {
  try {
    const m = getDateFromFile(file, "day");
    if (m) return m.format("YYYY-MM-DD");
  } catch {
    /* not a daily */
  }
  const base = file.basename;
  if (/^\d{4}-\d{2}-\d{2}$/.test(base)) return base;
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}
