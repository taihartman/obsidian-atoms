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
  isLinkerGenerated,
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
import {
  improveClassificationLinks,
  isJunkLinkReason,
  isWeakLinkReason,
  stripSelfReferentialLinks,
} from "./enrich/linkQuality";
import {
  extractLinkProseRegion,
  parseLinkProse,
} from "./parseLinkProse";
import type { ClassificationLink, ClassificationResult } from "../shared/types";
import type { PersonHub } from "./enrich/people";

export const UPDATE_NOTES_BATCH_LIMIT = 15;
/** Safety cap for free polish modifies per Update confirm. */
export const POLISH_BATCH_LIMIT = 500;

export type EligibleAtom = {
  path: string;
  title: string;
  content: string;
  quality: number;
  mtime?: number;
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

/** Tags from frontmatter (simple list form). */
export function parseTagsFromFrontmatter(content: string): string[] {
  const fm =
    content.startsWith("---") && content.indexOf("\n---", 3) !== -1
      ? content.slice(0, content.indexOf("\n---", 3) + 4)
      : "";
  if (/^tags:\s*\[\]\s*$/m.test(fm)) return [];
  const tags: string[] = [];
  let inTags = false;
  for (const line of fm.split(/\r?\n/)) {
    if (/^tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        tags.push(item[1]!.trim().replace(/^#/, ""));
        continue;
      }
      if (/^\w/.test(line)) break;
    }
  }
  return tags;
}

function linksEqual(a: ClassificationLink[], b: ClassificationLink[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (l, i) =>
      l.note === b[i]!.note &&
      (l.reason ?? "").trim() === (b[i]!.reason ?? "").trim(),
  );
}

/**
 * Local polish: rewrite weak/junk/self link prose without API.
 * Does not bump atoms-quality. Returns null when no change.
 */
export function planLocalPolish(opts: {
  path: string;
  title: string;
  content: string;
  today?: string;
}): { path: string; content: string; captureText: string } | null {
  if (!isLinkerGenerated(opts.content)) return null;
  const captureText = extractCaptureBody(opts.content);
  const prose = extractLinkProseRegion(opts.content);
  const parsed = parseLinkProse(prose);
  // Need structured links to polish; empty-link atoms go to refile
  if (!parsed.length) return null;

  const { existingAliases } = parseImmutableFrontmatter(opts.content);
  let result: ClassificationResult = {
    verdict: "atom",
    title: opts.title,
    tags: parseTagsFromFrontmatter(opts.content),
    proposed_tags: [],
    links: parsed,
  };

  result = improveClassificationLinks(captureText, result);
  result = stripSelfReferentialLinks(result, {
    alsoSelf: [opts.title, ...existingAliases],
  });

  if (linksEqual(result.links, parsed)) return null;

  const content = buildPolishedAtomMarkdown({
    oldContent: opts.content,
    captureText,
    result,
    title: opts.title,
    today: opts.today,
  });
  if (content === opts.content) return null;
  return { path: opts.path, content, captureText };
}

/** Rebuild atom keeping quality stamp; only link region + optional links-polished. */
export function buildPolishedAtomMarkdown(opts: {
  oldContent: string;
  captureText: string;
  result: ClassificationResult;
  title: string;
  today?: string;
}): string {
  const today = opts.today ?? localDateYmd();
  const quality = parseAtomsQuality(opts.oldContent);
  const { created, sourceWikilink, existingAliases } = parseImmutableFrontmatter(
    opts.oldContent,
  );
  const result = keepAsAtomResult(opts.result, opts.title);
  const resultTags = result.tags ?? [];
  const tags =
    resultTags.length > 0
      ? resultTags.map((t) => t.replace(/^#/, ""))
      : parseTagsFromFrontmatter(opts.oldContent);

  const fm: string[] = ["---", `created: ${created}`];
  if (existingAliases.length) {
    fm.push("aliases:");
    for (const a of existingAliases) fm.push(`  - ${JSON.stringify(a)}`);
  }
  if (sourceWikilink) {
    fm.push(`source: "${sourceWikilink}"`);
  }
  fm.push("generated-by: linker");
  if (quality > 0) {
    fm.push(...qualityStampLines(today, quality).lines);
  }
  fm.push(`links-polished: ${today}`);
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

export type LinkStats = {
  linkCount: number;
  weakOrJunkCount: number;
  brokenCount: number;
};

export function computeLinkStats(
  content: string,
  vaultTitles: Set<string>,
): LinkStats {
  const prose = extractLinkProseRegion(content);
  const links = parseLinkProse(prose);
  let weakOrJunkCount = 0;
  let brokenCount = 0;
  for (const l of links) {
    const reason = (l.reason ?? "").trim();
    if (isWeakLinkReason(reason) || isJunkLinkReason(reason)) {
      weakOrJunkCount += 1;
    }
    const key = l.note.trim().toLowerCase();
    if (key && !vaultTitles.has(key)) brokenCount += 1;
  }
  // Unparsed prose with wikilinks still counts as having links
  if (!links.length && /\[\[.+\]\]/.test(prose)) {
    return { linkCount: 1, weakOrJunkCount: 0, brokenCount: 0 };
  }
  return {
    linkCount: links.length,
    weakOrJunkCount,
    brokenCount,
  };
}

export function isPolishableContent(content: string, title: string): boolean {
  return planLocalPolish({ path: "", title, content }) !== null;
}

export function refileScore(opts: {
  quality: number;
  stats: LinkStats;
  mtime: number;
}): number {
  // Higher = more urgent for AI refile. Only meaningful when q < CURRENT.
  let s = 0;
  if (opts.stats.linkCount === 0) s += 1000;
  if (
    opts.stats.linkCount > 0 &&
    opts.stats.weakOrJunkCount >= opts.stats.linkCount
  ) {
    s += 800;
  }
  s += opts.stats.brokenCount * 50;
  // Newer recents slightly preferred over pure oldest (product: meet again)
  s += Math.min(200, Math.floor(opts.mtime / 1e10));
  // Older quality debt: slight boost for lower quality
  s += Math.max(0, 10 - opts.quality);
  return s;
}

export function rankRefileCandidates(
  items: Array<EligibleAtom & { stats: LinkStats; mtime: number }>,
  limit: number = UPDATE_NOTES_BATCH_LIMIT,
  current: number = CURRENT_ATOMS_QUALITY,
): EligibleAtom[] {
  const eligible = items.filter((i) => i.quality < current);
  eligible.sort((a, b) => {
    const sa = refileScore({
      quality: a.quality,
      stats: a.stats,
      mtime: a.mtime,
    });
    const sb = refileScore({
      quality: b.quality,
      stats: b.stats,
      mtime: b.mtime,
    });
    if (sb !== sa) return sb - sa;
    return a.path.localeCompare(b.path);
  });
  return eligible.slice(0, limit).map(({ stats: _s, mtime: _m, ...rest }) => rest);
}

export async function listLinkerAtoms(
  app: App,
  atomFolder: string,
): Promise<Array<EligibleAtom & { mtime: number }>> {
  const folder = clampAtomFolder(atomFolder);
  const out: Array<EligibleAtom & { mtime: number }> = [];
  const files = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === folder || f.path.startsWith(`${folder}/`));

  for (const f of files) {
    const content = await app.vault.read(f);
    if (!isLinkerGenerated(content)) continue;
    out.push({
      path: f.path,
      title: f.basename,
      content,
      quality: parseAtomsQuality(content),
      mtime: f.stat.mtime,
    });
  }
  return out;
}

export async function listEligibleAtoms(
  app: App,
  atomFolder: string,
  limit: number = UPDATE_NOTES_BATCH_LIMIT,
): Promise<EligibleAtom[]> {
  const all = await listLinkerAtoms(app, atomFolder);
  const vaultTitles = new Set(
    app.vault.getMarkdownFiles().map((f) => f.basename.toLowerCase()),
  );
  const withStats = all.map((a) => ({
    ...a,
    stats: computeLinkStats(a.content, vaultTitles),
  }));
  return rankRefileCandidates(withStats, limit);
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
  /** Free local polish count (Phase A). */
  polished: number;
  /** AI refile count (Phase B). */
  updated: number;
  renamed: number;
  markersRepaired: number;
  failed: number;
  skipped: number;
  /** Paths/titles successfully refiled (for land peak). */
  updatedItems: Array<{ title: string; path: string }>;
  /** Paths/titles successfully polished. */
  polishedItems: Array<{ title: string; path: string }>;
  /** True when Phase B attempted classify (API or fixtures). */
  usedApi: boolean;
};

export type RunRefreshOptions = {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  activeVocabulary: string[];
  atomFolder: string;
  limit?: number;
  polishLimit?: number;
  classifyDeps?: Partial<ClassifyDeps>;
  onProgress?: (
    done: number,
    total: number,
    meta?: { captureText?: string },
  ) => void;
  /** Fixture classifications (tests) — sequential order of refile list. */
  fixtureResults?: ClassificationResult[];
  /** Skip Phase A (tests). */
  skipPolish?: boolean;
  /** Skip Phase B (tests). */
  skipRefile?: boolean;
};

/**
 * Smart refresh: Phase A free polish, Phase B ranked Process-parity refile.
 */
export async function runRefreshEligibleAtoms(
  opts: RunRefreshOptions,
): Promise<RefreshReport> {
  const refileLimit = opts.limit ?? UPDATE_NOTES_BATCH_LIMIT;
  const polishLimit = opts.polishLimit ?? POLISH_BATCH_LIMIT;
  const report: RefreshReport = {
    scanned: 0,
    polished: 0,
    updated: 0,
    renamed: 0,
    markersRepaired: 0,
    failed: 0,
    skipped: 0,
    updatedItems: [],
    polishedItems: [],
    usedApi: false,
  };

  const all = await listLinkerAtoms(opts.app, opts.atomFolder);
  report.scanned = all.length;
  const vaultTitles = new Set(
    opts.app.vault.getMarkdownFiles().map((f) => f.basename.toLowerCase()),
  );

  // --- Phase A: local polish ---
  const polishPlans: Array<{
    path: string;
    title: string;
    content: string;
    captureText: string;
  }> = [];
  if (!opts.skipPolish) {
    for (const item of all) {
      if (polishPlans.length >= polishLimit) break;
      const plan = planLocalPolish({
        path: item.path,
        title: item.title,
        content: item.content,
      });
      if (plan) {
        polishPlans.push({
          path: plan.path,
          title: item.title,
          content: plan.content,
          captureText: plan.captureText,
        });
      }
    }
  }

  const withStats = all.map((a) => {
    // Prefer polished content for refile ranking when we will polish first
    const polished = polishPlans.find((p) => p.path === a.path);
    const content = polished?.content ?? a.content;
    return {
      ...a,
      content,
      stats: computeLinkStats(content, vaultTitles),
    };
  });
  const refileList = opts.skipRefile
    ? []
    : rankRefileCandidates(withStats, refileLimit);

  const totalSteps = polishPlans.length + refileList.length;
  let done = 0;

  for (const plan of polishPlans) {
    opts.onProgress?.(done, totalSteps || 1, {
      captureText: plan.captureText,
    });
    try {
      const file = opts.app.vault.getAbstractFileByPath(plan.path);
      if (!(file instanceof TFile)) {
        report.failed += 1;
        done += 1;
        continue;
      }
      await opts.app.vault.modify(file, plan.content);
      report.polished += 1;
      report.polishedItems.push({ title: plan.title, path: plan.path });
    } catch {
      report.failed += 1;
    }
    done += 1;
  }

  if (!refileList.length) {
    opts.onProgress?.(totalSteps, totalSteps || 1);
    return report;
  }

  report.usedApi = true;
  const ctx = opts.contextProvider.buildContext();
  const existing = listAtomPaths(opts.app, opts.atomFolder);
  let fixtureIdx = 0;

  for (let i = 0; i < refileList.length; i++) {
    const item = refileList[i]!;
    // Re-read after polish may have rewritten the file
    let liveContent = item.content;
    try {
      const f = opts.app.vault.getAbstractFileByPath(item.path);
      if (f instanceof TFile) {
        liveContent = await opts.app.vault.read(f);
      }
    } catch {
      /* use planned content */
    }

    opts.onProgress?.(done, totalSteps, {
      captureText: extractCaptureBody(liveContent),
    });

    const captureText = extractCaptureBody(liveContent);
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
      done += 1;
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
        done += 1;
        continue;
      }
      result = outcome.result;
    }

    const plan = planRefreshApply({
      path: item.path,
      oldTitle: item.title,
      oldContent: liveContent,
      result,
      atomFolder: opts.atomFolder,
      existingAtomPaths: existing,
    });

    try {
      const file = opts.app.vault.getAbstractFileByPath(plan.path);
      if (!(file instanceof TFile)) {
        report.failed += 1;
        done += 1;
        continue;
      }

      await opts.app.vault.modify(file, plan.content);
      report.updated += 1;

      let finalPath = plan.path;
      let finalTitle = plan.newTitle || plan.oldTitle;
      if (plan.rename) {
        const destExists = opts.app.vault.getAbstractFileByPath(plan.newPath);
        if (!destExists) {
          try {
            await opts.app.vault.rename(file, plan.newPath);
            existing.delete(plan.path);
            existing.add(plan.newPath);
            report.renamed += 1;
            finalPath = plan.newPath;
            finalTitle = plan.newTitle || finalTitle;
          } catch {
            // Content already refreshed; leave path (aliases carry old title).
          }
        }
      }
      report.updatedItems.push({ title: finalTitle, path: finalPath });

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
    done += 1;
  }

  opts.onProgress?.(totalSteps, totalSteps || 1);
  return report;
}

function findDailyFile(app: App, basename: string): TFile | null {
  const want = basename.replace(/\.md$/i, "");
  for (const f of app.vault.getMarkdownFiles()) {
    if (f.basename === want) return f;
  }
  return null;
}
