import type { App } from "obsidian";
import { classifyCapture, type ClassifyDeps } from "./classify";
import type { MetadataContextProvider } from "./context";
import { getPastDailyNotesWithUnmarkedCaptures } from "./daily";
import {
  applyWrite,
  listAtomPaths,
  planWrite,
  type ApplyWriteResult,
  type PlannedWrite,
} from "./render";
import type {
  Capture,
  ClassificationResult,
  DailyNoteWithCaptures,
} from "./types";
import { enrichPersonLinks, type PersonHub } from "./people";
import { mergeProposedTags } from "./vocabulary";

export interface WritePathEntry {
  dailyPath: string;
  date: string;
  captureText: string;
  verdict: string;
  title: string;
  write: ApplyWriteResult;
  planned: PlannedWrite;
}

export interface WritePathReport {
  entries: WritePathEntry[];
  atomsCreated: number;
  markersAppended: number;
  collisions: number;
  failed: number;
  scanned: number;
  proposedTagsMerged: string[];
}

export interface RunWritePathOptions {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  activeVocabulary: string[];
  atomFolder: string;
  maxCaptures?: number;
  classifyDeps?: Partial<ClassifyDeps>;
  onProgress?: (done: number, total: number) => void;
  /**
   * Optional pre-baked classifications (for CLI/fixture tests without network).
   * Map key: `${dailyPath}::${capture.startLine}` or sequential by order.
   */
  fixtureResults?: ClassificationResult[];
  /** Manual force: include today's daily. Default false (never for auto-run). */
  includeToday?: boolean;
}

/**
 * Manual write path (U8): classify unprocessed past captures, create atoms,
 * append markers for all three verdicts. Never rewrites existing capture lines.
 */
export async function runWritePath(
  opts: RunWritePathOptions,
): Promise<WritePathReport> {
  const listed = await getPastDailyNotesWithUnmarkedCaptures(opts.app, {
    includeToday: opts.includeToday,
  });
  const work: Array<{ note: DailyNoteWithCaptures; capture: Capture }> = [];
  for (const note of listed.notes) {
    for (const capture of note.unprocessed) {
      work.push({ note, capture });
    }
  }

  const max = opts.maxCaptures ?? work.length;
  const slice = work.slice(0, max);
  const ctx = opts.contextProvider.buildContext();
  const existingAtoms = listAtomPaths(opts.app, opts.atomFolder);

  const entries: WritePathEntry[] = [];
  let atomsCreated = 0;
  let markersAppended = 0;
  let collisions = 0;
  let failed = 0;
  const proposedIncoming: string[] = [];

  // Cache daily content we mutate within this run
  const dailyCache = new Map<string, string>();

  for (let i = 0; i < slice.length; i++) {
    const { note, capture } = slice[i]!;
    opts.onProgress?.(i + 1, slice.length);

    let result: ClassificationResult | null = null;
    if (opts.fixtureResults && opts.fixtureResults[i]) {
      // Fixtures skip live classify — still run people repair choke-point.
      const hubs: PersonHub[] = (ctx.personHubDetails ?? []).map((d) => ({
        canonicalTitle: d.canonicalTitle,
        matchKeys: d.matchKeys,
        path: "",
      }));
      result = enrichPersonLinks(capture.text, opts.fixtureResults[i]!, hubs);
    } else {
      const outcome = await classifyCapture(capture.text, ctx, {
        apiKey: opts.apiKey,
        model: opts.model,
        activeVocabulary: opts.activeVocabulary,
        ...opts.classifyDeps,
      });
      if (!outcome.ok) {
        failed += 1;
        continue;
      }
      result = outcome.result;
      if (result.proposed_tags?.length) {
        proposedIncoming.push(...result.proposed_tags);
      }
    }

    const plan = planWrite({
      result,
      capture,
      dailyPath: note.path,
      dailyDate: note.date,
      atomFolder: opts.atomFolder,
      existingAtomPaths: existingAtoms,
    });

    if (plan.action.kind === "create_atom") {
      existingAtoms.add(plan.action.path);
    }

    let content = dailyCache.get(note.path);
    if (content === undefined) {
      const file = opts.app.vault.getAbstractFileByPath(note.path);
      if (!file || !("extension" in file)) {
        failed += 1;
        continue;
      }
      content = await opts.app.vault.read(
        file as import("obsidian").TFile,
      );
    }

    const { result: writeResult, newDailyContent } = await applyWrite(
      opts.app,
      plan,
      content,
    );
    dailyCache.set(note.path, newDailyContent);

    if (writeResult.atomCreated) atomsCreated += 1;
    if (writeResult.atomSkippedCollision) collisions += 1;
    if (writeResult.markerAppended) markersAppended += 1;

    entries.push({
      dailyPath: note.path,
      date: note.date,
      captureText: capture.text.slice(0, 80),
      verdict: result.verdict,
      title: result.title,
      write: writeResult,
      planned: plan,
    });
  }

  const proposedTagsMerged = mergeProposedTags(
    [],
    proposedIncoming,
    opts.activeVocabulary,
  );

  return {
    entries,
    atomsCreated,
    markersAppended,
    collisions,
    failed,
    scanned: work.length,
    proposedTagsMerged,
  };
}
