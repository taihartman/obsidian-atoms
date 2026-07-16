/**
 * Update notes — refresh older linker atoms to Process parity (plan 015).
 * Never uses planWrite create/skip; modifies in place.
 */
import { TFile, type App } from "obsidian";
import {
  CURRENT_ATOMS_QUALITY,
  isEligibleForRefresh,
  qualityUpdatedDate,
} from "../shared/atomQuality";
import type { ClassificationResult } from "../shared/types";
import {
  atomPathForTitle,
  displayTitleForAtom,
  formatAtomBody,
  listAtomPaths,
  sanitizeFilename,
} from "./render";
import { classifyCapture, type ClassifyDeps } from "./classify";
import type { MetadataContextProvider } from "./context";

const ATOM_MARKER_TITLE_RE =
  /^\s*↳\s*\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]\s*<!--linker-->\s*$/;

function bodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\s*\n/, "");
}

export type ExtractCaptureResult =
  | { ok: true; captureText: string; method: "blank_line" | "whole_body" }
  | { ok: false; reason: "untrusted_split" };

/**
 * Split plugin-shaped atom body into capture vs reason prose.
 * Blank line present → capture is before first blank line (plugin write shape).
 * No blank line → whole body is capture.
 * Multiple blank lines → untrusted (hand-edit risk); caller may try daily match.
 */
export function extractCaptureBody(content: string): ExtractCaptureResult {
  const body = bodyAfterFrontmatter(content).replace(/\s+$/, "");
  if (!body) return { ok: false, reason: "untrusted_split" };

  const parts = body.split(/\n\n/);
  if (parts.length === 1) {
    return { ok: true, captureText: parts[0]!, method: "whole_body" };
  }
  // More than one blank-line region: only trust classic capture + single reason para
  if (parts.length === 2) {
    const capture = parts[0]!.replace(/\s+$/, "");
    if (!capture) return { ok: false, reason: "untrusted_split" };
    return { ok: true, captureText: capture, method: "blank_line" };
  }
  return { ok: false, reason: "untrusted_split" };
}

/** Parse immutable + useful frontmatter fields from an existing atom. */
export function parseAtomFrontmatter(content: string): {
  created: string | null;
  source: string | null;
  aliases: string[];
} {
  if (!content.startsWith("---")) {
    return { created: null, source: null, aliases: [] };
  }
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const createdM = fm.match(/^created:\s*(.+)\s*$/m);
  const sourceM = fm.match(/^source:\s*["']?\[\[([^\]]+)\]\]["']?\s*$/m);
  const aliases: string[] = [];
  const lines = fm.split(/\r?\n/);
  let inAliases = false;
  for (const line of lines) {
    if (/^aliases:\s*$/.test(line)) {
      inAliases = true;
      continue;
    }
    if (inAliases) {
      const am = line.match(/^\s+-\s+(.+)$/);
      if (am) {
        let v = am[1]!.trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          try {
            v = JSON.parse(v.startsWith('"') ? v : `"${v.slice(1, -1)}"`);
          } catch {
            v = v.slice(1, -1);
          }
        }
        aliases.push(v);
        continue;
      }
      if (/^\S/.test(line) && !/^\s/.test(line)) inAliases = false;
    }
  }
  return {
    created: createdM?.[1]?.trim() ?? null,
    source: sourceM?.[1]?.trim() ?? null,
    aliases,
  };
}

/**
 * Prefer capture text from source daily when unique bullet matches body first line.
 * Falls back to extractCaptureBody; untrusted multi-blank without daily → fail.
 */
export function extractCaptureForRefresh(
  content: string,
  dailyContent: string | null,
): ExtractCaptureResult {
  const bodyExtract = extractCaptureBody(content);
  if (dailyContent) {
    const candidate =
      bodyExtract.ok ? bodyExtract.captureText : bodyAfterFrontmatter(content);
    const first = (candidate.split("\n")[0] ?? "").trim();
    if (first) {
      const matched = findUniqueCaptureTextInDaily(dailyContent, first);
      if (matched) {
        return { ok: true, captureText: matched, method: "blank_line" };
      }
    }
  }
  return bodyExtract;
}

function findUniqueCaptureTextInDaily(
  dailyContent: string,
  firstLineNeedle: string,
): string | null {
  const lines = dailyContent.split(/\r?\n/);
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^- (.*)$/);
    if (!m) continue;
    const raw = m[1]!;
    const withoutTs = raw.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/, "");
    if (withoutTs !== firstLineNeedle && raw !== firstLineNeedle) continue;
    const parts = [withoutTs];
    let j = i + 1;
    while (
      j < lines.length &&
      /^[ \t]/.test(lines[j]!) &&
      lines[j]!.trim() !== "" &&
      !/^\s*↳ /.test(lines[j]!) &&
      !/<!--linker/.test(lines[j]!) &&
      !/^- /.test(lines[j]!)
    ) {
      parts.push(lines[j]!.replace(/^[ \t]+/, ""));
      j += 1;
    }
    hits.push(parts.join("\n"));
  }
  if (hits.length === 1) return hits[0]!;
  return null;
}

/** Force keep-as-atom (R13): never delete on noise/task re-triage. */
export function keepAsAtomResult(
  result: ClassificationResult,
  fallbackTitle: string,
): ClassificationResult {
  const title =
    result.verdict === "atom" && result.title.trim()
      ? result.title.trim()
      : fallbackTitle.trim() || "Untitled";
  return {
    ...result,
    verdict: "atom",
    title,
  };
}

export function buildRefreshedAtomMarkdown(opts: {
  oldContent: string;
  result: ClassificationResult;
  captureText: string;
  quality?: number;
  qualityUpdated?: string;
  /** Extra aliases (e.g. old title on rename, or desired title on collision). */
  extraAliases?: string[];
  /** Basename of file on disk — aliases must not duplicate this. */
  fileBasename?: string;
}): string {
  const fm = parseAtomFrontmatter(opts.oldContent);
  const created = fm.created ?? qualityUpdatedDate();
  const source = fm.source;
  const result = opts.result;
  const title = result.title.trim();
  const { alias: sanitizeAlias } = sanitizeFilename(title);
  const tags = (result.tags ?? []).map((t) => t.replace(/^#/, ""));
  const quality = opts.quality ?? CURRENT_ATOMS_QUALITY;
  const qUpdated = opts.qualityUpdated ?? qualityUpdatedDate();
  const fileBase = (opts.fileBasename ?? displayTitleForAtom(title)).trim();

  const aliasSet: string[] = [];
  const pushAlias = (a: string | null | undefined) => {
    const t = (a ?? "").trim();
    if (!t) return;
    if (t.toLowerCase() === fileBase.toLowerCase()) return;
    if (aliasSet.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    aliasSet.push(t);
  };
  for (const a of fm.aliases) pushAlias(a);
  pushAlias(sanitizeAlias);
  for (const a of opts.extraAliases ?? []) pushAlias(a);

  const lines: string[] = ["---", `created: ${created}`];
  if (aliasSet.length) {
    lines.push("aliases:");
    for (const a of aliasSet) lines.push(`  - ${JSON.stringify(a)}`);
  }
  if (source) {
    lines.push(`source: "[[${source}]]"`);
  }
  lines.push("generated-by: linker");
  lines.push(`atoms-quality: ${quality}`);
  lines.push(`quality-updated: ${qUpdated}`);
  if (tags.length) {
    lines.push("tags:");
    for (const t of tags) lines.push(`  - ${t}`);
  } else {
    lines.push("tags: []");
  }
  lines.push("---", "");

  const body = formatAtomBody(opts.captureText, result);
  return lines.join("\n") + body + (body.endsWith("\n") ? "" : "\n");
}

export type RefreshPlan =
  | {
      kind: "modify";
      path: string;
      content: string;
      oldTitle: string;
      newTitle: string;
      renameTo: string | null;
      markerRepair: {
        dailyPath: string;
        oldTitle: string;
        newTitle: string;
      } | null;
    }
  | { kind: "skip"; path: string; reason: string };

export function planRefreshWrite(opts: {
  path: string;
  oldContent: string;
  result: ClassificationResult;
  captureText: string;
  atomFolder: string;
  existingAtomPaths: Set<string>;
  /** Resolved vault path for source daily, if any. */
  sourceDailyPath: string | null;
}): RefreshPlan {
  const oldTitle = opts.path
    .split("/")
    .pop()!
    .replace(/\.md$/i, "");
  const forced = keepAsAtomResult(opts.result, oldTitle);
  const newTitle = displayTitleForAtom(forced.title);
  const newPath = atomPathForTitle(opts.atomFolder, forced.title);
  const newPathKey = newPath.replace(/\\/g, "/");
  const oldPathKey = opts.path.replace(/\\/g, "/");

  let renameTo: string | null = null;
  let extraAliases: string[] = [];
  /** Basename of the file after this plan (aliases must not equal this). */
  let fileBasename = oldTitle;

  if (newPathKey !== oldPathKey) {
    if (
      opts.existingAtomPaths.has(newPathKey) ||
      opts.existingAtomPaths.has(newPath)
    ) {
      // Collision: keep path; alias desired title so [[new]] still resolves
      extraAliases = [forced.title.trim(), newTitle];
      renameTo = null;
      fileBasename = oldTitle;
    } else {
      renameTo = newPath;
      extraAliases = [oldTitle];
      fileBasename = newTitle;
    }
  }

  const content = buildRefreshedAtomMarkdown({
    oldContent: opts.oldContent,
    result: forced,
    captureText: opts.captureText,
    extraAliases,
    fileBasename,
  });

  const markerRepair =
    opts.sourceDailyPath && newTitle !== oldTitle && renameTo
      ? {
          dailyPath: opts.sourceDailyPath,
          oldTitle,
          newTitle,
        }
      : opts.sourceDailyPath && newTitle !== oldTitle
        ? {
            dailyPath: opts.sourceDailyPath,
            oldTitle,
            newTitle,
          }
        : null;

  return {
    kind: "modify",
    path: opts.path,
    content,
    oldTitle,
    newTitle,
    renameTo,
    markerRepair,
  };
}

/**
 * Replace plugin marker wikilink for old title only when unique match under capture.
 * Pure string transform.
 */
export function repairMarkerLine(
  dailyContent: string,
  captureFirstLine: string,
  oldTitle: string,
  newTitle: string,
): { content: string; changed: boolean; reason?: string } {
  const lines = dailyContent.split(/\r?\n/);
  const endsWithNewline = dailyContent.endsWith("\n");
  const oldDisp = displayTitleForAtom(oldTitle);
  const newDisp = displayTitleForAtom(newTitle);

  const matchIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^- (.*)$/);
    if (!m) continue;
    const raw = m[1]!;
    const withoutTs = raw.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/, "");
    if (withoutTs === captureFirstLine || raw === captureFirstLine) {
      matchIndexes.push(i);
    }
  }
  if (matchIndexes.length !== 1) {
    return {
      content: dailyContent,
      changed: false,
      reason: matchIndexes.length === 0 ? "capture_not_found" : "ambiguous",
    };
  }
  const start = matchIndexes[0]!;
  let end = start;
  let j = start + 1;
  while (
    j < lines.length &&
    /^[ \t]/.test(lines[j]!) &&
    lines[j]!.trim() !== "" &&
    !ATOM_MARKER_TITLE_RE.test(lines[j]!) &&
    !/<!--linker/.test(lines[j]!) &&
    !/^- /.test(lines[j]!)
  ) {
    end = j;
    j += 1;
  }

  // Find marker after capture
  let markerIdx = -1;
  for (let k = end + 1; k < lines.length; k++) {
    if (/^- /.test(lines[k]!)) break;
    const mm = lines[k]!.match(ATOM_MARKER_TITLE_RE);
    if (mm) {
      const linked = (mm[1] ?? "").trim();
      if (
        linked === oldDisp ||
        linked === oldTitle ||
        linked.toLowerCase() === oldDisp.toLowerCase()
      ) {
        markerIdx = k;
        break;
      }
      // Different title — leave alone
      return {
        content: dailyContent,
        changed: false,
        reason: "marker_title_mismatch",
      };
    }
    if (lines[k]!.trim() !== "" && !/^\s/.test(lines[k]!)) break;
  }
  if (markerIdx < 0) {
    return { content: dailyContent, changed: false, reason: "marker_not_found" };
  }

  lines[markerIdx] = `\t↳ [[${newDisp}]] <!--linker-->`;
  let content = lines.join("\n");
  if (endsWithNewline && !content.endsWith("\n")) content += "\n";
  return { content, changed: true };
}

export type RefreshRunReport = {
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  failed: number;
  renamed: number;
  markersRepaired: number;
  remaining: number;
};

export const REFRESH_BATCH_DEFAULT = 15;

export async function refreshEligibleAtoms(opts: {
  app: App;
  atomFolder: string;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  activeVocabulary: string[];
  limit?: number;
  classifyDeps?: Partial<ClassifyDeps>;
  onProgress?: (done: number, total: number, meta?: { captureText?: string }) => void;
  dryRun?: boolean;
}): Promise<RefreshRunReport> {
  const limit = opts.limit ?? REFRESH_BATCH_DEFAULT;
  const folder = opts.atomFolder.replace(/\/$/, "") || "Atoms";
  const files = opts.app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === folder || f.path.startsWith(`${folder}/`));

  type Item = { file: TFile; content: string };
  const eligible: Item[] = [];
  for (const file of files) {
    const content = await opts.app.vault.cachedRead(file);
    if (isEligibleForRefresh(content)) {
      eligible.push({ file, content });
    }
  }
  // Oldest first (mtime ascending)
  eligible.sort((a, b) => a.file.stat.mtime - b.file.stat.mtime);

  const batch = eligible.slice(0, limit);
  const report: RefreshRunReport = {
    scanned: files.length,
    eligible: eligible.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    renamed: 0,
    markersRepaired: 0,
    remaining: Math.max(0, eligible.length - batch.length),
  };

  const ctx = opts.contextProvider.buildContext();
  let existing = listAtomPaths(opts.app, folder);

  for (let i = 0; i < batch.length; i++) {
    const { file, content } = batch[i]!;
    const fm = parseAtomFrontmatter(content);
    let dailyContent: string | null = null;
    let sourceDailyPath: string | null = null;
    if (fm.source) {
      const found = findDailyByBasename(opts.app, fm.source);
      if (found) {
        sourceDailyPath = found.path;
        dailyContent = await opts.app.vault.cachedRead(found);
      }
    }

    const extracted = extractCaptureForRefresh(content, dailyContent);
    if (!extracted.ok) {
      report.skipped += 1;
      opts.onProgress?.(i + 1, batch.length, {});
      continue;
    }

    opts.onProgress?.(i + 1, batch.length, {
      captureText: extracted.captureText,
    });

    if (opts.dryRun) {
      report.updated += 1;
      continue;
    }

    const outcome = await classifyCapture(extracted.captureText, ctx, {
      apiKey: opts.apiKey,
      model: opts.model,
      activeVocabulary: opts.activeVocabulary,
      ...opts.classifyDeps,
    });

    if (!outcome.ok) {
      report.failed += 1;
      continue;
    }

    const plan = planRefreshWrite({
      path: file.path,
      oldContent: content,
      result: outcome.result,
      captureText: extracted.captureText,
      atomFolder: folder,
      existingAtomPaths: existing,
      sourceDailyPath,
    });

    if (plan.kind === "skip") {
      report.skipped += 1;
      continue;
    }

    try {
      await opts.app.vault.modify(file, plan.content);
      let finalPath = file.path;

      if (plan.renameTo) {
        const parent = plan.renameTo.split("/").slice(0, -1).join("/");
        if (parent && !opts.app.vault.getAbstractFileByPath(parent)) {
          await opts.app.vault.createFolder(parent);
        }
        // Re-check collision
        if (!opts.app.vault.getAbstractFileByPath(plan.renameTo)) {
          await opts.app.fileManager.renameFile(file, plan.renameTo);
          finalPath = plan.renameTo;
          report.renamed += 1;
          existing.add(plan.renameTo);
          existing.delete(file.path);
        }
      }

      if (plan.markerRepair && dailyContent && sourceDailyPath) {
        const first = extracted.captureText.split("\n")[0] ?? "";
        const repaired = repairMarkerLine(
          dailyContent,
          first,
          plan.markerRepair.oldTitle,
          plan.markerRepair.newTitle,
        );
        if (repaired.changed) {
          const dailyFile = opts.app.vault.getAbstractFileByPath(sourceDailyPath);
          if (dailyFile instanceof TFile) {
            await opts.app.vault.modify(dailyFile, repaired.content);
            report.markersRepaired += 1;
          }
        }
      }

      void finalPath;
      report.updated += 1;
    } catch {
      report.failed += 1;
    }
  }

  // Still-stale after this run (not successfully stamped)
  report.remaining = Math.max(0, report.eligible - report.updated);
  return report;
}

function findDailyByBasename(app: App, basename: string): TFile | null {
  const want = basename.replace(/\.md$/i, "");
  for (const f of app.vault.getMarkdownFiles()) {
    const base = f.basename;
    if (base === want || f.path.endsWith(`/${want}.md`)) return f;
  }
  return null;
}

export function countEligibleAtoms(
  files: Array<{ content: string }>,
): number {
  let n = 0;
  for (const f of files) {
    if (isEligibleForRefresh(f.content)) n += 1;
  }
  return n;
}
