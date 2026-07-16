import { TFile, type App } from "obsidian";
import {
  applyClassificationQuality,
  classifyCapture,
  type ClassifyDeps,
} from "./classify";
import type { MetadataContextProvider } from "./context";
import {
  CURRENT_ATOMS_QUALITY,
  isEligibleForUpdate,
  localDateYmd,
  parseAtomsQuality,
  qualityStampLines,
} from "./atomQuality";
import {
  atomPathForTitle,
  clampAtomFolder,
  displayTitleForAtom,
  formatAtomBody,
  listAtomPaths,
  sanitizeFilename,
} from "./render";
import { stripSelfReferentialLinks } from "./enrich/linkQuality";
import type { ClassificationResult } from "../shared/types";
import type { PersonHub } from "./enrich/people";

export const UPDATE_NOTES_BATCH_LIMIT = 15;

export type EligibleAtom = {
  path: string;
  title: string;
  content: string;
  quality: number;
};

/** Body after YAML frontmatter. */
export function bodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\r?\n/, "");
}

/**
 * Capture region vs old reason prose.
 * Prefer split on first blank line; else whole body is capture (drop old prose on rebuild).
 */
export function extractCaptureBody(content: string): string {
  const body = bodyAfterFrontmatter(content).replace(/\s+$/, "");
  if (!body) return "";
  const m = body.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
  if (m) return m[1]!.replace(/\s+$/, "");
  return body;
}

export function parseImmutableFrontmatter(content: string): {
  created: string;
  sourceWikilink: string;
  existingAliases: string[];
} {
  const fm =
    content.startsWith("---") && content.indexOf("\n---", 3) !== -1
      ? content.slice(0, content.indexOf("\n---", 3) + 4)
      : "";
  let created = localDateYmd();
  let sourceWikilink = "";
  const existingAliases: string[] = [];
  const createdM = fm.match(/^created:\s*(.+)$/m);
  if (createdM?.[1]) created = createdM[1].trim().replace(/^["']|["']$/g, "");
  const sourceM = fm.match(/^source:\s*["']?(\[\[[^\]]+\]\])["']?\s*$/m);
  if (sourceM?.[1]) sourceWikilink = sourceM[1];
  let inAliases = false;
  for (const line of fm.split(/\r?\n/)) {
    if (/^aliases:\s*$/.test(line)) {
      inAliases = true;
      continue;
    }
    if (inAliases) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        // Strip surrounding quotes only — do not JSON.parse (apostrophes in
        // names like Ning's break JSON and used to surface as parse errors).
        let v = item[1]!.trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (v) existingAliases.push(v);
        continue;
      }
      if (/^\w/.test(line)) break;
    }
  }
  return { created, sourceWikilink, existingAliases };
}

/** Force atom verdict for refresh (R13). */
export function keepAsAtomResult(
  result: ClassificationResult,
  fallbackTitle: string,
): ClassificationResult {
  const title =
    (result.title ?? "").trim() || fallbackTitle.trim() || "Untitled";
  return {
    ...result,
    verdict: "atom",
    title,
  };
}

export function buildRefreshedAtomMarkdown(opts: {
  oldContent: string;
  captureText: string;
  result: ClassificationResult;
  /** Filename/display title after sanitize */
  title: string;
  /** When rename, keep old title as alias if not already present */
  previousTitle?: string;
  quality?: number;
  today?: string;
}): string {
  const quality = opts.quality ?? CURRENT_ATOMS_QUALITY;
  const today = opts.today ?? localDateYmd();
  const { created, sourceWikilink, existingAliases } = parseImmutableFrontmatter(
    opts.oldContent,
  );
  const result = keepAsAtomResult(opts.result, opts.title);
  const { alias: sanitizeAlias } = sanitizeFilename(result.title.trim());
  const tags = (result.tags ?? []).map((t) => t.replace(/^#/, ""));
  const aliases = new Set<string>();
  for (const a of existingAliases) {
    if (a && a !== opts.title) aliases.add(a);
  }
  if (sanitizeAlias && sanitizeAlias !== opts.title) aliases.add(sanitizeAlias);
  if (
    opts.previousTitle &&
    opts.previousTitle !== opts.title &&
    opts.previousTitle !== sanitizeAlias
  ) {
    aliases.add(opts.previousTitle);
  }

  const fm: string[] = ["---", `created: ${created}`];
  if (aliases.size) {
    fm.push("aliases:");
    for (const a of aliases) fm.push(`  - ${JSON.stringify(a)}`);
  }
  if (sourceWikilink) {
    fm.push(`source: "${sourceWikilink}"`);
  }
  fm.push("generated-by: linker");
  const stamp = qualityStampLines(today, quality);
  fm.push(...stamp.lines);
  if (tags.length) {
    fm.push("tags:");
    for (const t of tags) fm.push(`  - ${t}`);
  } else {
    fm.push("tags: []");
  }
  fm.push("---", "");
  const body = formatAtomBody(opts.captureText, result);
  return fm.join("\n") + body + (body.endsWith("\n") ? "" : "\n");
}

/**
 * Best-effort: retarget plugin marker `↳ [[old]] <!--linker-->` → new title
 * when capture body matches under a daily that contains source wikilink name.
 */
export function repairMarkerTitleInDaily(
  dailyContent: string,
  captureText: string,
  oldTitle: string,
  newTitle: string,
): { content: string; changed: boolean } {
  if (oldTitle === newTitle) return { content: dailyContent, changed: false };
  const firstLine = (captureText.split("\n")[0] ?? "").trim();
  if (!firstLine) return { content: dailyContent, changed: false };

  const lines = dailyContent.split(/\r?\n/);
  let captureIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^- (.*)$/);
    if (!m) continue;
    const raw = m[1]!;
    const withoutTs = raw.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/, "");
    if (withoutTs === firstLine || raw === firstLine) {
      captureIdx = i;
      break;
    }
  }
  if (captureIdx < 0) return { content: dailyContent, changed: false };

  const oldDisp = displayTitleForAtom(oldTitle);
  const newDisp = displayTitleForAtom(newTitle);
  const markerRe = new RegExp(
    `^(\\s*↳\\s*\\[\\[)${escapeRegExp(oldDisp)}(\\]\\]\\s*<!--linker-->\\s*)$`,
  );
  for (let j = captureIdx + 1; j < Math.min(lines.length, captureIdx + 8); j++) {
    if (/^- /.test(lines[j]!)) break;
    const line = lines[j]!;
    if (markerRe.test(line)) {
      lines[j] = line.replace(markerRe, `$1${newDisp}$2`);
      const endsWithNewline = dailyContent.endsWith("\n");
      let content = lines.join("\n");
      if (endsWithNewline && !content.endsWith("\n")) content += "\n";
      return { content, changed: true };
    }
  }
  return { content: dailyContent, changed: false };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sourceDailyBasename(sourceWikilink: string): string | null {
  const m = sourceWikilink.match(/\[\[([^\]]+)\]\]/);
  if (!m?.[1]) return null;
  return m[1].trim().replace(/\.md$/i, "");
}

export async function listEligibleAtoms(
  app: App,
  atomFolder: string,
  limit: number = UPDATE_NOTES_BATCH_LIMIT,
): Promise<EligibleAtom[]> {
  const folder = clampAtomFolder(atomFolder);
  const out: EligibleAtom[] = [];
  const files = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === folder || f.path.startsWith(`${folder}/`))
    .sort((a, b) => a.stat.mtime - b.stat.mtime);

  for (const f of files) {
    if (out.length >= limit) break;
    const content = await app.vault.read(f);
    if (!isEligibleForUpdate(content)) continue;
    out.push({
      path: f.path,
      title: f.basename,
      content,
      quality: parseAtomsQuality(content),
    });
  }
  return out;
}

export function countEligibleAtomsFromContents(
  contents: string[],
): number {
  let n = 0;
  for (const c of contents) {
    if (isEligibleForUpdate(c)) n += 1;
  }
  return n;
}

export type RefreshApplyPlan = {
  path: string;
  oldTitle: string;
  newTitle: string;
  newPath: string;
  content: string;
  captureText: string;
  rename: boolean;
  sourceBasename: string | null;
};

export function planRefreshApply(opts: {
  path: string;
  oldTitle: string;
  oldContent: string;
  result: ClassificationResult;
  atomFolder: string;
  existingAtomPaths: Set<string>;
  quality?: number;
  today?: string;
}): RefreshApplyPlan {
  const captureText = extractCaptureBody(opts.oldContent);
  let forced = keepAsAtomResult(opts.result, opts.oldTitle);
  // Prior basename + aliases count as self (not “other notes” to link)
  const { existingAliases } = parseImmutableFrontmatter(opts.oldContent);
  forced = stripSelfReferentialLinks(forced, {
    alsoSelf: [opts.oldTitle, ...existingAliases],
  });
  const newTitle = displayTitleForAtom(forced.title);
  const newPath = atomPathForTitle(opts.atomFolder, forced.title);
  let rename = newPath !== opts.path;
  if (rename) {
    const key = newPath.replace(/\\/g, "/");
    if (
      opts.existingAtomPaths.has(key) ||
      opts.existingAtomPaths.has(newPath)
    ) {
      // Collision: keep old path, still rewrite content with new title surfaces
      rename = false;
    }
  }
  const writePath = rename ? newPath : opts.path;
  const previousTitle =
    newTitle !== opts.oldTitle ? opts.oldTitle : undefined;
  const content = buildRefreshedAtomMarkdown({
    oldContent: opts.oldContent,
    captureText,
    result: forced,
    title: newTitle,
    previousTitle: rename || newTitle !== opts.oldTitle ? previousTitle : undefined,
    quality: opts.quality,
    today: opts.today,
  });
  // If we kept path due to collision, still stamp aliases with old title when titles differ
  const { sourceWikilink } = parseImmutableFrontmatter(opts.oldContent);
  return {
    path: opts.path,
    oldTitle: opts.oldTitle,
    newTitle,
    newPath: writePath,
    content,
    captureText,
    rename,
    sourceBasename: sourceDailyBasename(sourceWikilink),
  };
}

export type RefreshReport = {
  scanned: number;
  updated: number;
  renamed: number;
  markersRepaired: number;
  failed: number;
  skipped: number;
};

export type RunRefreshOptions = {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  activeVocabulary: string[];
  atomFolder: string;
  limit?: number;
  classifyDeps?: Partial<ClassifyDeps>;
  onProgress?: (
    done: number,
    total: number,
    meta?: { captureText?: string },
  ) => void;
  /** Fixture classifications (tests) — sequential order of eligible list. */
  fixtureResults?: ClassificationResult[];
};

/**
 * Refresh eligible atoms via same classifyCapture path as Process.
 */
export async function runRefreshEligibleAtoms(
  opts: RunRefreshOptions,
): Promise<RefreshReport> {
  const limit = opts.limit ?? UPDATE_NOTES_BATCH_LIMIT;
  const eligible = await listEligibleAtoms(opts.app, opts.atomFolder, limit);
  const report: RefreshReport = {
    scanned: eligible.length,
    updated: 0,
    renamed: 0,
    markersRepaired: 0,
    failed: 0,
    skipped: 0,
  };
  if (!eligible.length) return report;

  const ctx = opts.contextProvider.buildContext();
  const existing = listAtomPaths(opts.app, opts.atomFolder);
  let fixtureIdx = 0;

  for (let i = 0; i < eligible.length; i++) {
    const item = eligible[i]!;
    opts.onProgress?.(i, eligible.length, {
      captureText: extractCaptureBody(item.content),
    });

    const captureText = extractCaptureBody(item.content);
    const hubs: PersonHub[] = (ctx.personHubDetails ?? []).map((d) => ({
      canonicalTitle: d.canonicalTitle,
      matchKeys: d.matchKeys,
      path: "",
    }));

    let result: ClassificationResult;
    if (opts.fixtureResults && fixtureIdx < opts.fixtureResults.length) {
      result = applyClassificationQuality(
        captureText,
        opts.fixtureResults[fixtureIdx++]!,
        {
          titles: ctx.titles ?? [],
          personHubs: hubs,
          personHubTitles: ctx.personHubs ?? [],
        },
      );
    } else if (opts.fixtureResults) {
      report.failed += 1;
      continue;
    } else {
      const outcome = await classifyCapture(captureText, ctx, {
        apiKey: opts.apiKey,
        model: opts.model,
        activeVocabulary: opts.activeVocabulary,
        ...opts.classifyDeps,
      });
      if (!outcome.ok) {
        report.failed += 1;
        continue;
      }
      result = outcome.result;
    }

    const plan = planRefreshApply({
      path: item.path,
      oldTitle: item.title,
      oldContent: item.content,
      result,
      atomFolder: opts.atomFolder,
      existingAtomPaths: existing,
    });

    try {
      const file = opts.app.vault.getAbstractFileByPath(plan.path);
      if (!(file instanceof TFile)) {
        report.failed += 1;
        continue;
      }

      // Write content first (in-place), then rename if needed.
      // Prefer vault.rename only — fileManager.renameFile can hang in some vaults.
      await opts.app.vault.modify(file, plan.content);
      report.updated += 1;

      if (plan.rename) {
        const destExists = opts.app.vault.getAbstractFileByPath(plan.newPath);
        if (!destExists) {
          try {
            await opts.app.vault.rename(file, plan.newPath);
            existing.delete(plan.path);
            existing.add(plan.newPath);
            report.renamed += 1;
          } catch {
            // Content already refreshed; leave path (aliases carry old title).
          }
        }
      }

      if (plan.oldTitle !== plan.newTitle && plan.sourceBasename) {
        const daily = findDailyFile(opts.app, plan.sourceBasename);
        if (daily) {
          const dailyText = await opts.app.vault.read(daily);
          const repaired = repairMarkerTitleInDaily(
            dailyText,
            plan.captureText,
            plan.oldTitle,
            plan.newTitle,
          );
          if (repaired.changed) {
            await opts.app.vault.modify(daily, repaired.content);
            report.markersRepaired += 1;
          }
        }
      }
    } catch {
      report.failed += 1;
    }
  }

  opts.onProgress?.(eligible.length, eligible.length);
  return report;
}

function findDailyFile(app: App, basename: string): TFile | null {
  const want = basename.replace(/\.md$/i, "");
  for (const f of app.vault.getMarkdownFiles()) {
    if (f.basename === want) return f;
  }
  return null;
}
