import type { App } from "obsidian";
import {
  applyClassificationQuality,
  classifyCapture,
  type ClassifyDeps,
} from "./classify";
import { logShortlistDiagnostics, type MetadataContextProvider } from "./context";
import { getPastDailyNotesWithUnmarkedCaptures } from "./daily";
import {
  applyWrite,
  displayTitleForAtom,
  listAtomPaths,
  planWrite,
  type ApplyWriteResult,
  type PlannedWrite,
} from "./render";
import { extractCaptureBody } from "./refreshAtoms";
import type {
  Capture,
  ClassificationResult,
  DailyNoteWithCaptures,
} from "../shared/types";
import {
  personHubMissAfterEnrich,
  type PersonHub,
} from "./enrich/people";
import { mergeProposedTags } from "./vocabulary";
import {
  applyPersonPeerLinksToContents,
  resolveAtomPersonName,
} from "./personInvite";
import { Notice, TFile } from "obsidian";
import { projectHubsFromAtomContents } from "./runHubProjection";
import { localDateYmd } from "./atomQuality";
import {
  appLoadLocal,
  appSaveLocal,
  applyContinueEnsures,
  clearContinueParent,
  withEligibleContinueParent,
} from "../platform/continueParent";

export interface WritePathEntry {
  dailyPath: string;
  date: string;
  captureText: string;
  verdict: string;
  title: string;
  write: ApplyWriteResult;
  planned: PlannedWrite;
  /** Person-shaped atom with no hub link after enrich. */
  personHubMiss: boolean;
}

/** Classify or integrity failure — capture left unprocessed. */
export interface WritePathFailure {
  dailyPath: string;
  date: string;
  captureText: string;
  reason: string;
  message: string;
}

export interface WritePathReport {
  entries: WritePathEntry[];
  atomsCreated: number;
  markersAppended: number;
  collisions: number;
  failed: number;
  scanned: number;
  proposedTagsMerged: string[];
  personHubMisses: number;
  failures: WritePathFailure[];
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
  onProgress?: (
    done: number,
    total: number,
    meta?: { captureText?: string },
  ) => void;
  /**
   * Optional pre-baked classifications (for CLI/fixture tests without network).
   * Map key: `${dailyPath}::${capture.startLine}` or sequential by order.
   */
  fixtureResults?: ClassificationResult[];
  /** Manual force: include today's daily. Default false (never for auto-run). */
  includeToday?: boolean;
  enableHubProjection?: boolean;
  /** Shortlist size per capture. Defaults to DEFAULT_SHORTLIST_K. */
  shortlistK?: number;
  /** Offer notes linked from the ones a capture matched. Defaults to DEFAULT_GRAPH_EXPANSION. */
  expandGraph?: boolean;
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

  // Bottom-up within each daily so inserted markers don't shift later line numbers.
  work.sort((a, b) => {
    const byPath = a.note.path.localeCompare(b.note.path);
    if (byPath !== 0) return byPath;
    return b.capture.startLine - a.capture.startLine;
  });

  const max = opts.maxCaptures ?? work.length;
  const slice = work.slice(0, max);
  // One run, one vault read. Only the scoring repeats per capture (KTD4a).
  const run = await opts.contextProvider.beginRun({
    atomFolder: opts.atomFolder,
    shortlistK: opts.shortlistK,
    expandGraph: opts.expandGraph,
  });
  // Tags, vocabulary and hubs are the run's, not the capture's — a shortlist never narrows them.
  const staticCtx = run.vaultContext;
  const existingAtoms = listAtomPaths(opts.app, opts.atomFolder);

  const entries: WritePathEntry[] = [];
  const failures: WritePathFailure[] = [];
  let atomsCreated = 0;
  let markersAppended = 0;
  let collisions = 0;
  let failed = 0;
  let personHubMisses = 0;
  const proposedIncoming: string[] = [];
  const hubs: PersonHub[] = (staticCtx.personHubDetails ?? []).map((d) => ({
    canonicalTitle: d.canonicalTitle,
    matchKeys: d.matchKeys,
    path: "",
  }));

  // Cache daily content we mutate within this run
  const dailyCache = new Map<string, string>();

  const pushFail = (
    note: DailyNoteWithCaptures,
    capture: Capture,
    reason: string,
    message: string,
  ) => {
    failed += 1;
    failures.push({
      dailyPath: note.path,
      date: note.date,
      captureText: capture.text.slice(0, 120),
      reason,
      message,
    });
  };

  const todayYmd = localDateYmd();
  const loadLs = (k: string) => appLoadLocal(opts.app, k);
  const saveLs = (k: string, v: unknown) => appSaveLocal(opts.app, k, v);

  try {
    for (let i = 0; i < slice.length; i++) {
      const { note, capture } = slice[i]!;
      opts.onProgress?.(i + 1, slice.length, { captureText: capture.text });

      // Scored against this capture, including atoms this run already wrote (R4).
      let ctx = await run.getCandidates(capture);
      logShortlistDiagnostics("process shortlist", ctx.stats);

      // Home Continue: today-only, re-read each capture; clear only after write success.
      const injected = withEligibleContinueParent(
        ctx,
        note.date,
        todayYmd,
        loadLs,
      );
      ctx = injected.ctx;
      const continueInjected = injected.parentTitle;

      let result: ClassificationResult | null = null;
      if (opts.fixtureResults && opts.fixtureResults[i]) {
        // Fixtures skip live classify — same quality pass as classifyCapture.
        result = applyClassificationQuality(
          capture.text,
          opts.fixtureResults[i]!,
          {
            titles: ctx.titles ?? [],
            personHubs: hubs,
            personHubTitles: ctx.personHubs ?? [],
          },
        );
      } else {
        const outcome = await classifyCapture(capture.text, ctx, {
          apiKey: opts.apiKey,
          model: opts.model,
          activeVocabulary: opts.activeVocabulary,
          ...opts.classifyDeps,
        });
        if (!outcome.ok) {
          pushFail(
            note,
            capture,
            outcome.reason,
            outcome.message || outcome.reason,
          );
          continue;
        }
        result = outcome.result;
        if (result.proposed_tags?.length) {
          proposedIncoming.push(...result.proposed_tags);
        }
      }

      if (continueInjected) {
        result = applyContinueEnsures(
          result,
          continueInjected,
          existingAtoms,
          opts.atomFolder,
        );
      }

      const personHubMiss = personHubMissAfterEnrich(
        capture.text,
        result,
        hubs,
      );
      if (personHubMiss) personHubMisses += 1;

      const plan = planWrite({
        result,
        capture,
        dailyPath: note.path,
        dailyDate: note.date,
        atomFolder: opts.atomFolder,
        existingAtomPaths: existingAtoms,
      });

      if (
        plan.action.kind === "create_atom" ||
        plan.action.kind === "skip_existing_atom"
      ) {
        existingAtoms.add(plan.action.path);
      }

      let content = dailyCache.get(note.path);
      if (content === undefined) {
        const file = opts.app.vault.getAbstractFileByPath(note.path);
        if (!file || !("extension" in file)) {
          pushFail(
            note,
            capture,
            "missing_daily",
            `Daily note missing or unreadable: ${note.path}`,
          );
          continue;
        }
        if (!(file instanceof TFile)) {
          pushFail(
            note,
            capture,
            "missing_daily",
            `Daily note missing or unreadable: ${note.path}`,
          );
          continue;
        }
        content = await opts.app.vault.read(file);
      }

      const { result: writeResult, newDailyContent } = await applyWrite(
        opts.app,
        plan,
        content,
        { extractCaptureBody },
      );

      if (writeResult.collisionBodyMismatch) {
        const title =
          plan.action.kind === "skip_existing_atom"
            ? plan.action.title
            : (result.title || "").trim() || "atom";
        pushFail(
          note,
          capture,
          "collision_mismatch",
          `Title "${title}" already exists with a different body — left unprocessed`,
        );
        continue;
      }

      dailyCache.set(note.path, newDailyContent);

      if (writeResult.atomCreated) atomsCreated += 1;
      if (writeResult.atomSkippedCollision) collisions += 1;
      if (writeResult.markerAppended) markersAppended += 1;

      if (continueInjected && writeResult.markerAppended) {
        clearContinueParent(saveLs);
      }

      // Make it scoreable for the captures still to come. Only newly created atoms:
      // a collision skip means the file was already in the corpus at seed time.
      if (writeResult.atomCreated) {
        run.addWrittenAtom({
          path: writeResult.atomCreated,
          // Same spelling the file/marker use — raw model title can differ after sanitize.
          title: displayTitleForAtom(result.title),
          body: capture.text,
          tags: result.tags,
          links: result.links,
        });
      }

      entries.push({
        dailyPath: note.path,
        date: note.date,
        captureText: capture.text.slice(0, 80),
        verdict: result.verdict,
        title: result.title,
        write: writeResult,
        planned: plan,
        personHubMiss,
      });
    }
  } finally {
    run.end();
  }

  const proposedTagsMerged = mergeProposedTags(
    [],
    proposedIncoming,
    opts.activeVocabulary,
  );

  // Pre-hub peer links among same-name atoms created this run (R14).
  await applyPersonPeersForNewAtoms(opts.app, entries, hubs);

  if (opts.enableHubProjection) {
    const atomContents: string[] = [];
    for (const e of entries) {
      const path =
        e.write.atomCreated ??
        e.write.atomUpdated ??
        e.write.atomSkippedCollision;
      if (!path) continue;
      const f = opts.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) continue;
      try {
        atomContents.push(await opts.app.vault.read(f));
      } catch {
        /* skip */
      }
    }
    await projectHubsFromAtomContents({
      app: opts.app,
      enabled: true,
      atomFolder: opts.atomFolder,
      atomContents,
      personHubTitles: staticCtx.personHubs ?? [],
      personHubDetails: staticCtx.personHubDetails,
    });
  }

  return {
    entries,
    atomsCreated,
    markersAppended,
    collisions,
    failed,
    scanned: work.length,
    proposedTagsMerged,
    personHubMisses,
    failures,
  };
}

/**
 * Group newly written atoms by high-confidence person label; if ≥2 share a
 * label with no person hub, write orbit-safe peer links between them.
 */
async function applyPersonPeersForNewAtoms(
  app: App,
  entries: WritePathEntry[],
  hubs: PersonHub[],
): Promise<void> {
  const hubLower = new Set(
    hubs.map((h) => h.canonicalTitle.trim().toLowerCase()).filter(Boolean),
  );
  type Mem = { path: string; title: string; content: string };
  const byLabel = new Map<string, Mem[]>();

  for (const e of entries) {
    if (e.verdict !== "atom") continue;
    if (!e.write.atomCreated && !e.write.atomSkippedCollision) continue; // both string|null
    const path =
      e.planned.action.kind === "create_atom" ||
      e.planned.action.kind === "skip_existing_atom"
        ? e.planned.action.path
        : null;
    if (!path) continue;
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const content = await app.vault.read(file);
    const name = resolveAtomPersonName(content, e.captureText, e.title);
    if (!name) continue;
    const id = name.toLowerCase();
    if (hubLower.has(id)) continue;
    const list = byLabel.get(id) ?? [];
    list.push({ path, title: e.title, content });
    byLabel.set(id, list);
  }

  for (const members of byLabel.values()) {
    if (members.length < 2) continue;
    // re-read fresh content
    const fresh: Mem[] = [];
    for (const m of members) {
      const file = app.vault.getAbstractFileByPath(m.path);
      if (!(file instanceof TFile)) continue;
      fresh.push({
        path: m.path,
        title: m.title,
        content: await app.vault.read(file),
      });
    }
    const updates = applyPersonPeerLinksToContents(fresh);
    for (const [p, next] of updates) {
      const file = app.vault.getAbstractFileByPath(p);
      if (file instanceof TFile) await app.vault.modify(file, next);
    }
  }
}
