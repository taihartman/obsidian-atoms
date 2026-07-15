import type { App, TFile } from "obsidian";
import type {
  Capture,
  ClassificationLink,
  ClassificationResult,
  Verdict,
} from "./types";

/**
 * Marker line that would be / is appended under a capture (KTD1).
 * Pure — no vault I/O (U7 preview + U8 write path share this).
 */
export function markerLineForDecision(
  verdict: Verdict,
  title: string,
): string {
  if (verdict === "atom") {
    const t = title.trim() || "Untitled";
    return `\t↳ [[${t}]] <!--linker-->`;
  }
  if (verdict === "task") {
    return "\t<!--linker:task-->";
  }
  return "\t<!--linker:noise-->";
}

/** Inline reason-bearing link sentences (R9) — not a bare list. */
export function formatLinkProse(links: ClassificationLink[]): string {
  if (!links.length) return "";
  return links
    .map((l) => {
      const reason = (l.reason || "").trim();
      if (reason.includes("[["))
        return reason.endsWith(".") ? reason : `${reason}.`;
      const note = (l.note || "").trim();
      if (!note) return reason;
      return reason
        ? `${reason} ([[${note}]])`.replace(/\.\s*\(/, " (")
        : `Related to [[${note}]].`;
    })
    .join(" ");
}

/**
 * Atom body: verbatim capture + optional link prose (R2, R9).
 */
export function formatAtomBody(
  captureText: string,
  result: ClassificationResult,
): string {
  const body = captureText.replace(/\s+$/, "");
  const links = formatLinkProse(result.links ?? []);
  if (!links) return body;
  return `${body}\n\n${links}`;
}

/** @deprecated alias — preview used the old name */
export const formatAtomBodyPreview = formatAtomBody;

const ILLEGAL_FILENAME = /[/:\\?%*|"<>]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * KTD8: sanitize for filename; return alias = original title when changed.
 */
export function sanitizeFilename(title: string): {
  filename: string;
  alias: string | null;
} {
  const original = title.trim() || "Untitled";
  let name = original
    .replace(ILLEGAL_FILENAME, "-")
    .replace(/\.\.+/g, ".")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || RESERVED.test(name)) name = "Untitled";
  // Avoid empty after strip
  if (!name) name = "Untitled";
  const alias = name !== original ? original : null;
  return { filename: name, alias };
}

export function atomPathForTitle(atomFolder: string, title: string): string {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  const { filename } = sanitizeFilename(title);
  return `${folder}/${filename}.md`;
}

/**
 * Frontmatter exactly: created, source (wikilink), generated-by, tags.
 * Optional aliases only when sanitization changed the title (KTD8 / R15).
 */
export function buildAtomMarkdown(opts: {
  result: ClassificationResult;
  captureText: string;
  /** ISO date or YYYY-MM-DD for created */
  created: string;
  /** Daily note path or basename for source wikilink */
  sourceDailyPath: string;
}): string {
  const { result, captureText, created, sourceDailyPath } = opts;
  const title = result.title.trim();
  const { alias } = sanitizeFilename(title);
  const sourceName = sourceDailyPath
    .replace(/\.md$/i, "")
    .split("/")
    .pop()!;

  const tags = (result.tags ?? []).map((t) => t.replace(/^#/, ""));
  const fm: string[] = ["---", `created: ${created}`];
  if (alias) {
    fm.push("aliases:");
    fm.push(`  - ${JSON.stringify(alias)}`);
  }
  // source as wikilink string in YAML — Obsidian resolves [[Note]]
  fm.push(`source: "[[${sourceName}]]"`);
  fm.push("generated-by: linker");
  if (tags.length) {
    fm.push("tags:");
    for (const t of tags) fm.push(`  - ${t}`);
  } else {
    fm.push("tags: []");
  }
  fm.push("---", "");

  const body = formatAtomBody(captureText, result);
  return fm.join("\n") + body + (body.endsWith("\n") ? "" : "\n");
}

const MARKER_LINE_RE =
  /^\s*(?:↳ .*\[\[.*\]\].*<!--linker-->|<!--linker:(?:task|noise)-->)\s*$/;

/**
 * True if any plugin marker sits after the capture before the next top-level bullet.
 * Handles stacked markers from older bugs (don't insert another).
 */
export function captureAlreadyHasMarker(
  lines: string[],
  captureEndLine: number,
): boolean {
  for (let j = captureEndLine + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (/^- /.test(line)) break; // next capture
    if (MARKER_LINE_RE.test(line)) return true;
    // blank or non-bullet prose: keep scanning a few lines for orphan markers
    if (line.trim() !== "" && !/^\s/.test(line) && !MARKER_LINE_RE.test(line)) {
      // Non-indented non-bullet text — stop (next freeform line)
      break;
    }
  }
  return false;
}

/**
 * Re-locate a capture in possibly-shifted daily content by matching the bullet line.
 * Prefer exact startLine when it still matches; otherwise search.
 */
export function resolveCaptureEndLine(
  lines: string[],
  capture: { text: string; startLine: number; endLine: number },
): number | null {
  const firstLineText = capture.text.split("\n")[0] ?? "";
  const bulletNeedle = firstLineText; // body after "- " may include timestamp stripped already

  const tryAt = (idx: number): boolean => {
    if (idx < 0 || idx >= lines.length) return false;
    const m = lines[idx]!.match(/^- (.*)$/);
    if (!m) return false;
    // Compare against stripped body first line (timestamp may remain in file)
    const raw = m[1]!;
    const withoutTs = raw.replace(
      /^(\d{1,2}:\d{2}(?::\d{2})?)\s+/,
      "",
    );
    return withoutTs === bulletNeedle || raw === bulletNeedle;
  };

  if (tryAt(capture.startLine)) {
    // extent: continuations after start
    let end = capture.startLine;
    const bodyLines = capture.text.split("\n");
    // Prefer original span length when start still matches
    const span = Math.max(0, capture.endLine - capture.startLine);
    end = Math.min(lines.length - 1, capture.startLine + span);
    // Expand through indented continuations if needed
    let i = capture.startLine + 1;
    while (
      i < lines.length &&
      /^[ \t]/.test(lines[i]!) &&
      lines[i]!.trim() !== "" &&
      !MARKER_LINE_RE.test(lines[i]!) &&
      !/^- /.test(lines[i]!)
    ) {
      end = i;
      i += 1;
    }
    return end;
  }

  // Search for matching bullet
  for (let i = 0; i < lines.length; i++) {
    if (!tryAt(i)) continue;
    let end = i;
    let j = i + 1;
    while (
      j < lines.length &&
      /^[ \t]/.test(lines[j]!) &&
      lines[j]!.trim() !== "" &&
      !MARKER_LINE_RE.test(lines[j]!) &&
      !/^- /.test(lines[j]!)
    ) {
      end = j;
      j += 1;
    }
    // Prefer unique match; if multiple, first is ok for bottom-up processing
    return end;
  }
  return null;
}

/**
 * Insert marker on the line immediately after the capture extent.
 * Original capture lines are byte-unchanged (R4/R6).
 * If a marker is already present after the extent, leave content unchanged.
 */
export function insertMarkerAfterCapture(
  dailyContent: string,
  capture: Capture,
  markerLine: string,
): { content: string; changed: boolean } {
  const lines = dailyContent.split(/\r?\n/);
  const endLine =
    resolveCaptureEndLine(lines, capture) ?? capture.endLine;

  if (captureAlreadyHasMarker(lines, endLine)) {
    return { content: dailyContent, changed: false };
  }

  const after = endLine + 1;

  // Preserve whether file ended with newline
  const endsWithNewline = dailyContent.endsWith("\n");
  const before = lines.slice(0, after);
  const rest = lines.slice(after);
  const out = [...before, markerLine, ...rest];
  let content = out.join("\n");
  if (endsWithNewline && !content.endsWith("\n")) content += "\n";
  return { content, changed: true };
}

/** created field: daily date + optional capture time */
export function resolveCreatedField(
  dailyDate: string,
  captureTimestamp: string | null,
): string {
  if (captureTimestamp) {
    // dailyDate is YYYY-MM-DD; timestamp HH:mm or HH:mm:ss
    return `${dailyDate}T${captureTimestamp.length === 5 ? captureTimestamp + ":00" : captureTimestamp}`;
  }
  return dailyDate;
}

export type WriteAction =
  | { kind: "create_atom"; path: string; content: string }
  | { kind: "skip_atom_collision"; existingPath: string; title: string }
  | { kind: "marker_only" };

export interface PlannedWrite {
  markerLine: string;
  dailyPath: string;
  capture: Capture;
  action: WriteAction;
  /** Result used for atom body (may include collision supersession link). */
  result: ClassificationResult;
}

/**
 * Plan vault writes for one successful classification (pure).
 * Collision (KTD8): no new file; marker still points at existing title.
 */
export function planWrite(opts: {
  result: ClassificationResult;
  capture: Capture;
  dailyPath: string;
  dailyDate: string;
  atomFolder: string;
  /** Existing paths in atom folder (normalized). */
  existingAtomPaths: Set<string>;
}): PlannedWrite {
  const { result, capture, dailyPath, atomFolder, existingAtomPaths } = opts;
  let resultForWrite = result;

  if (result.verdict !== "atom") {
    return {
      markerLine: markerLineForDecision(result.verdict, ""),
      dailyPath,
      capture,
      action: { kind: "marker_only" },
      result: resultForWrite,
    };
  }

  const title = result.title.trim();
  const path = atomPathForTitle(atomFolder, title);
  const pathKey = path.replace(/\\/g, "/");

  if (existingAtomPaths.has(pathKey) || existingAtomPaths.has(path)) {
    // Collision: supersession link + marker only (KTD8)
    const links = [
      ...(result.links ?? []),
      {
        note: title,
        reason: `revises [[${title}]] (same-title collision; no duplicate atom)`,
      },
    ];
    resultForWrite = { ...result, links };
    return {
      markerLine: markerLineForDecision("atom", title),
      dailyPath,
      capture,
      action: { kind: "skip_atom_collision", existingPath: path, title },
      result: resultForWrite,
    };
  }

  const content = buildAtomMarkdown({
    result: resultForWrite,
    captureText: capture.text,
    created: resolveCreatedField(opts.dailyDate, capture.timestamp),
    sourceDailyPath: dailyPath,
  });

  return {
    markerLine: markerLineForDecision("atom", title),
    dailyPath,
    capture,
    action: { kind: "create_atom", path, content },
    result: resultForWrite,
  };
}

export interface ApplyWriteResult {
  atomCreated: string | null;
  atomSkippedCollision: string | null;
  markerAppended: boolean;
  dailyPath: string;
}

/**
 * Apply a planned write to the vault. Only create + append (R3/R4).
 */
export async function applyWrite(
  app: App,
  plan: PlannedWrite,
  dailyContent: string,
): Promise<{ result: ApplyWriteResult; newDailyContent: string }> {
  let atomCreated: string | null = null;
  let atomSkippedCollision: string | null = null;

  if (plan.action.kind === "create_atom") {
    const folder = plan.action.path.split("/").slice(0, -1).join("/");
    if (folder) {
      const folderExists = app.vault.getAbstractFileByPath(folder);
      if (!folderExists) {
        await app.vault.createFolder(folder);
      }
    }
    const existing = app.vault.getAbstractFileByPath(plan.action.path);
    if (!existing) {
      await app.vault.create(plan.action.path, plan.action.content);
      atomCreated = plan.action.path;
    } else {
      // Race: treat as collision
      atomSkippedCollision = plan.action.path;
    }
  } else if (plan.action.kind === "skip_atom_collision") {
    atomSkippedCollision = plan.action.existingPath;
  }

  const { content: newDailyContent, changed } = insertMarkerAfterCapture(
    dailyContent,
    plan.capture,
    plan.markerLine,
  );

  if (changed) {
    const file = app.vault.getAbstractFileByPath(plan.dailyPath);
    if (file && "extension" in file) {
      await app.vault.modify(file as TFile, newDailyContent);
    }
  }

  return {
    result: {
      atomCreated,
      atomSkippedCollision,
      markerAppended: changed,
      dailyPath: plan.dailyPath,
    },
    newDailyContent,
  };
}

/** List existing atom paths under folder for collision detection. */
export function listAtomPaths(app: App, atomFolder: string): Set<string> {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  const set = new Set<string>();
  for (const f of app.vault.getMarkdownFiles()) {
    if (f.path === folder || f.path.startsWith(folder + "/")) {
      set.add(f.path);
    }
  }
  return set;
}
