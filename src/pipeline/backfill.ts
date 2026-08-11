import { requestUrl, TFile, type App, Modal, Setting } from "obsidian";
import {
  ANTHROPIC_VERSION,
  applyClassificationQuality,
  buildMessagesRequest,
  shouldCacheChunkTitles,
} from "./classify";
import {
  DEFAULT_CHUNK_GRANULARITY,
  groupIntoChunks,
  type ChunkGranularity,
  type ContextRun,
  type MetadataContextProvider,
} from "./context";
import type { RecentFirstRange } from "./backfillOffer";
import { getPastDailyNotesWithUnmarkedCaptures } from "./daily";
import { PLUS_PRICING, topUpPriceLabel } from "../shared/plusPricing";
import {
  applyWrite,
  displayTitleForAtom,
  listAtomPaths,
  planWrite,
} from "./render";
import type {
  Capture,
  ClassificationResult,
  DailyNoteWithCaptures,
  VaultContext,
} from "../shared/types";
import type { PersonHub } from "./enrich/people";
import { filterTagsToActive, mergeProposedTags } from "./vocabulary";
import { projectHubsFromAtomContents } from "./runHubProjection";

export const BATCHES_URL = "https://api.anthropic.com/v1/messages/batches";
export const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";

/** Default bulk model (plan U10). */
export const DEFAULT_BACKFILL_MODEL = "claude-haiku-4-5-20251001";

/**
 * List prices USD per million tokens (standard, pre-batch).
 * Conservative mid-2026 public rates — estimate only, not a quote.
 */
export const MODEL_RATES_USD_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
};

export const BATCH_DISCOUNT = 0.5;
/** Assumed output tokens per classification (conservative over-estimate). */
export const ASSUMED_OUTPUT_TOKENS = 250;

export interface BackfillWorkItem {
  customId: string;
  note: DailyNoteWithCaptures;
  capture: Capture;
  index: number;
}

/** One chunk's share of the estimate: how many requests it holds, and how big each one is. */
export interface ChunkTokenCount {
  key: string;
  captureCount: number;
  inputTokensPerRequest: number;
}

export interface CostEstimate {
  captureCount: number;
  model: string;
  /**
   * Tokens per request (input side from count_tokens).
   *
   * With chunking there is no single such number — each chunk sends its own titles block, so a
   * February request and a July request are different sizes. When `chunks` is present this field is
   * the **capture-weighted mean** across them, kept only so the modal has one headline figure; the
   * money below is summed per chunk, not derived from this. Read `chunks` for the real shape.
   */
  inputTokensPerRequest: number;
  /** Per-chunk breakdown when the run was chunked. Absent for a single flat context. */
  chunks?: ChunkTokenCount[];
  /** Full input tokens if every request pays full prefix (no cache credit). */
  worstCaseInputTokens: number;
  /** Output assumption × N */
  estimatedOutputTokens: number;
  /** USD after 50% batch discount, worst-case input (no cache reads). */
  worstCaseUsd: number;
  /** USD if cache hits were free on prefix (best case) — shown as range only. */
  bestCaseUsd: number;
  /** Human line for the gate */
  summaryLine: string;
  /** Explicit: we did not subtract cross-request cache reads */
  creditsCacheReads: false;
}

export function ratesForModel(model: string): { input: number; output: number } {
  return (
    MODEL_RATES_USD_PER_MTOK[model] ?? {
      input: 3,
      output: 15,
    }
  );
}

/**
 * Conservative batch cost: full prefix priced on every request × 50% batch.
 * Does **not** credit cross-request cache reads (U10 / KTD3 batch caveat).
 */
export function estimateBatchCost(opts: {
  captureCount: number;
  inputTokensPerRequest: number;
  model: string;
  assumedOutputTokens?: number;
  /**
   * Per-chunk sizes (U5). When given, the totals are summed over the chunks instead of multiplying
   * one sample by N — which chunking made wrong, because each chunk carries a differently sized
   * title block. `captureCount` and `inputTokensPerRequest` are then derived from these, never read.
   */
  chunks?: ChunkTokenCount[];
}): CostEstimate {
  const chunks = opts.chunks;
  const n = chunks
    ? chunks.reduce((s, c) => s + Math.max(0, c.captureCount), 0)
    : Math.max(0, opts.captureCount);
  const perOut = opts.assumedOutputTokens ?? ASSUMED_OUTPUT_TOKENS;
  const rates = ratesForModel(opts.model);
  const disc = BATCH_DISCOUNT;

  const worstCaseInputTokens = chunks
    ? chunks.reduce(
        (s, c) => s + Math.max(0, c.captureCount) * Math.max(0, c.inputTokensPerRequest),
        0,
      )
    : Math.max(0, opts.inputTokensPerRequest) * n;
  // Headline only — the weighted mean of what the chunks actually send.
  const perIn = chunks
    ? n > 0
      ? Math.round(worstCaseInputTokens / n)
      : 0
    : Math.max(0, opts.inputTokensPerRequest);
  const estimatedOutputTokens = perOut * n;

  // Batch = 50% of list price
  const worstCaseUsd =
    ((worstCaseInputTokens * rates.input + estimatedOutputTokens * rates.output) /
      1_000_000) *
    disc;

  // Best case: only pay for volatile capture suffix (~estimate 50 input tokens) + output
  const bestInput = Math.min(perIn, 80) * n;
  const bestCaseUsd =
    ((bestInput * rates.input + estimatedOutputTokens * rates.output) /
      1_000_000) *
    disc;

  const summaryLine =
    n === 0
      ? "No unmarked past captures to backfill."
      : `${n} capture(s) · ~$${worstCaseUsd.toFixed(2)} worst-case (batch 50% off, no cache credit)` +
        (bestCaseUsd < worstCaseUsd
          ? ` · best-case ~$${bestCaseUsd.toFixed(2)} if cache hits`
          : "");

  return {
    captureCount: n,
    model: opts.model,
    inputTokensPerRequest: perIn,
    ...(chunks ? { chunks } : {}),
    worstCaseInputTokens,
    estimatedOutputTokens,
    worstCaseUsd,
    bestCaseUsd,
    summaryLine,
    creditsCacheReads: false,
  };
}

export async function countTokensForClassifyRequest(opts: {
  apiKey: string;
  model: string;
  context: VaultContext;
  sampleCapture: string;
  request?: typeof requestUrl;
}): Promise<number> {
  const request = opts.request ?? requestUrl;
  const body = buildMessagesRequest({
    model: opts.model,
    capture: opts.sampleCapture,
    context: opts.context,
    cacheTtl: "1h",
  });
  // count_tokens uses the same shape minus some fields; send model+messages+system+tools
  const payload = {
    model: body.model,
    system: body.system,
    messages: body.messages,
  };

  const res = await request({
    url: COUNT_TOKENS_URL,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
    throw: false,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`count_tokens failed (HTTP ${res.status})`);
  }
  const json = (res.json ?? {}) as { input_tokens?: number };
  const n = Number(json.input_tokens ?? 0);
  if (!n) throw new Error("count_tokens returned no input_tokens");
  return n;
}

export function enumerateBackfillWork(
  notes: DailyNoteWithCaptures[],
): BackfillWorkItem[] {
  const work: BackfillWorkItem[] = [];
  let i = 0;
  for (const note of notes) {
    for (const capture of note.unprocessed) {
      work.push({
        customId: `cap-${i}-${note.date}-${capture.startLine}`,
        note,
        capture,
        index: i,
      });
      i += 1;
    }
  }
  return work;
}

/**
 * A calendar chunk of backfill work, with the one shortlist every capture in it is sent (U5).
 *
 * The context is resolved once per chunk and shared, so the note-title block is byte-identical
 * across the chunk's requests and can sit inside the cached prefix. `cacheTitles` is false for a
 * chunk of one, where there is no second request to read the entry back.
 */
export interface ResolvedBackfillChunk {
  key: string;
  work: BackfillWorkItem[];
  context: VaultContext;
  cacheTitles: boolean;
}

/** Split enumerated work into calendar chunks by the date of the daily note each capture came from. */
export function chunkBackfillWork(
  work: BackfillWorkItem[],
  granularity: ChunkGranularity = DEFAULT_CHUNK_GRANULARITY,
): Array<{ key: string; work: BackfillWorkItem[] }> {
  return groupIntoChunks(work, (w) => w.note.date, granularity).map((c) => ({
    key: c.key,
    work: c.items,
  }));
}

/**
 * Resolve one shortlist per chunk, oldest chunk first (U5, R4).
 *
 * Sequential on purpose. `onChunkResolved` is the caller's chance to run the chunk — submit its
 * batch, apply the results, and `run.addAtom()` whatever atoms it created — before the next chunk's
 * shortlist is derived. That is what makes an atom filed in January visible to a February capture:
 * the corpus the later chunk scores against has grown, without the run's corpus outliving the run
 * (KTD4a).
 */
export async function resolveBackfillChunks(opts: {
  run: ContextRun;
  work: BackfillWorkItem[];
  granularity?: ChunkGranularity;
  /**
   * The first chunk, already resolved against this same run before any atom was written.
   *
   * The cost gate resolves every chunk to price it, and chunk one is the one the confirm path would
   * otherwise derive a second time from a corpus that has not changed in between — nothing has been
   * submitted, so no atom exists in either pass. Later chunks are deliberately *not* reusable: their
   * whole point is to see what the chunks before them wrote.
   */
  firstChunk?: ResolvedBackfillChunk;
  onChunkResolved?: (chunk: ResolvedBackfillChunk) => Promise<void> | void;
}): Promise<ResolvedBackfillChunk[]> {
  const out: ResolvedBackfillChunk[] = [];
  for (const chunk of chunkBackfillWork(opts.work, opts.granularity)) {
    const reusable =
      out.length === 0 && opts.firstChunk?.key === chunk.key ? opts.firstChunk : null;
    const resolved: ResolvedBackfillChunk = reusable ?? {
      key: chunk.key,
      work: chunk.work,
      context: await opts.run.getChunkCandidates(chunk.work.map((w) => w.capture)),
      cacheTitles: shouldCacheChunkTitles(chunk.work.length),
    };
    out.push(resolved);
    await opts.onChunkResolved?.(resolved);
  }
  return out;
}

/** Batch request params with 1h cache TTL (U10). */
export function buildBatchRequestParams(opts: {
  model: string;
  capture: string;
  context: VaultContext;
  /** Chunked catch-up only — see `BuildRequestOptions.cacheTitles`. */
  cacheTitles?: boolean;
}): Record<string, unknown> {
  const full = buildMessagesRequest({
    model: opts.model,
    capture: opts.capture,
    context: opts.context,
    cacheTtl: "1h",
    cacheTitles: opts.cacheTitles,
  });
  return {
    model: full.model,
    max_tokens: full.max_tokens,
    system: full.system,
    messages: full.messages,
    output_config: full.output_config,
  };
}

export function buildBatchCreateBody(
  work: BackfillWorkItem[],
  model: string,
  context: VaultContext,
  cacheTitles = false,
): { requests: Array<{ custom_id: string; params: Record<string, unknown> }> } {
  return {
    requests: work.map((w) => ({
      custom_id: w.customId,
      params: buildBatchRequestParams({
        model,
        capture: w.capture.text,
        context,
        cacheTitles,
      }),
    })),
  };
}

/** One chunk's batch body. Every request in it carries the same titles block, by construction. */
export function buildChunkBatchCreateBody(
  chunk: ResolvedBackfillChunk,
  model: string,
): ReturnType<typeof buildBatchCreateBody> {
  return buildBatchCreateBody(chunk.work, model, chunk.context, chunk.cacheTitles);
}

export function assertBatchUsesHourCache(
  body: ReturnType<typeof buildBatchCreateBody>,
): boolean {
  if (body.requests.length === 0) return true;
  for (const req of body.requests) {
    const messages = req.params.messages as Array<{
      content: Array<{ cache_control?: { ttl?: string } }>;
    }>;
    const ttl = messages?.[0]?.content?.[0]?.cache_control?.ttl;
    if (ttl !== "1h") return false;
  }
  return true;
}

export interface BackfillEstimateResult {
  work: BackfillWorkItem[];
  estimate: CostEstimate;
  /** The run's static context — tags, vocabulary, hubs. Never the classify context; chunks own that. */
  context: VaultContext;
  /**
   * The open run behind the chunks. The caller **must** `end()` it, whether or not it goes on to
   * submit: the gate can be declined, and a declined estimate should not pin a whole vault's corpus
   * in memory (KTD4a).
   */
  run: ContextRun;
  chunks: ResolvedBackfillChunk[];
}

/**
 * Estimate, chunked (U5).
 *
 * The gate still fires before anything is submitted — this function only reads the vault and calls
 * `count_tokens`. What changed is that it prices the *chunks*: one `count_tokens` per chunk against
 * that chunk's own shortlist, rather than one sample against the whole vault's title list. A vault
 * whose full context no longer fits in the estimate is exactly the vault this branch exists for.
 *
 * `expandGraph: false` is not negotiable here. Graph expansion reaches atom → hub and stops at the
 * hub, so in a catch-up — where the only edges are to hubs — it contributes nothing and would spend
 * a walk per capture to prove it (KTD7).
 */
export async function prepareBackfillEstimate(opts: {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  atomFolder?: string;
  shortlistK?: number;
  granularity?: ChunkGranularity;
  /**
   * Derived recent-first range (KTD10). BYOK has no meter and nothing to reserve, but it takes
   * the same per-run cap as Plus, so the estimate must price the range the run will actually
   * submit — an unbounded scan here quotes a whole vault's history for a capped run.
   * Absent on the estimate-only diagnostic, which is deliberately unbounded.
   */
  since?: string;
  before?: string;
  request?: typeof requestUrl;
}): Promise<BackfillEstimateResult> {
  const listed = await getPastDailyNotesWithUnmarkedCaptures(opts.app, {
    since: opts.since,
    before: opts.before,
  });
  const work = enumerateBackfillWork(listed.notes);
  const run = await opts.contextProvider.beginRun({
    atomFolder: opts.atomFolder,
    shortlistK: opts.shortlistK,
    expandGraph: false,
  });
  const context = run.vaultContext;

  if (work.length === 0) {
    return {
      work,
      context,
      run,
      chunks: [],
      estimate: estimateBatchCost({
        captureCount: 0,
        inputTokensPerRequest: 0,
        model: opts.model,
      }),
    };
  }

  // Resolve every chunk up front. Nothing has been written yet, so no chunk can see another's
  // atoms — that visibility is what `runBackfillChunks` re-resolves for, once results exist.
  let chunks: ResolvedBackfillChunk[];
  const counts: ChunkTokenCount[] = [];
  try {
    chunks = await resolveBackfillChunks({
      run,
      work,
      granularity: opts.granularity,
    });

    for (const chunk of chunks) {
      const inputTokensPerRequest = await countTokensForClassifyRequest({
        apiKey: opts.apiKey,
        model: opts.model,
        context: chunk.context,
        sampleCapture: chunk.work[0]!.capture.text,
        request: opts.request,
      });
      counts.push({
        key: chunk.key,
        captureCount: chunk.work.length,
        inputTokensPerRequest,
      });
    }
  } catch (e) {
    // A failed estimate hands back no run, so it must not hold the corpus either.
    run.end();
    throw e;
  }

  return {
    work,
    context,
    run,
    chunks,
    estimate: estimateBatchCost({
      captureCount: work.length,
      inputTokensPerRequest: 0,
      model: opts.model,
      chunks: counts,
    }),
  };
}

export interface BatchSubmitResult {
  batchId: string;
  requestCount: number;
}

export async function submitMessageBatch(opts: {
  apiKey: string;
  body: ReturnType<typeof buildBatchCreateBody>;
  request?: typeof requestUrl;
}): Promise<BatchSubmitResult> {
  const request = opts.request ?? requestUrl;
  const res = await request({
    url: BATCHES_URL,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(opts.body),
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    const errType = (res.json as { error?: { type?: string } })?.error?.type;
    throw new Error(
      `Batch submit failed (HTTP ${res.status}${errType ? `: ${errType}` : ""})`,
    );
  }
  const json = res.json as { id?: string };
  if (!json.id) throw new Error("Batch submit returned no id");
  return { batchId: json.id, requestCount: opts.body.requests.length };
}

export async function getBatchStatus(opts: {
  apiKey: string;
  batchId: string;
  request?: typeof requestUrl;
}): Promise<{
  processing_status: string;
  request_counts?: Record<string, number>;
}> {
  const request = opts.request ?? requestUrl;
  const res = await request({
    url: `${BATCHES_URL}/${opts.batchId}`,
    method: "GET",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Batch status failed (HTTP ${res.status})`);
  }
  return res.json as {
    processing_status: string;
    request_counts?: Record<string, number>;
  };
}

/**
 * Poll until ended or timeout. processing_status: in_progress | ended
 */
export async function waitForBatchEnded(opts: {
  apiKey: string;
  batchId: string;
  request?: typeof requestUrl;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  intervalMs?: number;
  onTick?: (status: string) => void;
}): Promise<void> {
  const sleep =
    opts.sleep ?? ((ms) => new Promise((r) => window.setTimeout(r, ms)));
  const maxWait = opts.maxWaitMs ?? 30 * 60 * 1000;
  const interval = opts.intervalMs ?? 5000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const st = await getBatchStatus({
      apiKey: opts.apiKey,
      batchId: opts.batchId,
      request: opts.request,
    });
    opts.onTick?.(st.processing_status);
    if (st.processing_status === "ended") return;
    await sleep(interval);
  }
  throw new Error("Batch wait timed out");
}

export interface BatchResultLine {
  custom_id: string;
  result?: {
    type: string;
    message?: {
      content?: Array<{ type?: string; text?: string }>;
    };
    error?: { type?: string; message?: string };
  };
}

export function parseBatchResultsJsonl(text: string): BatchResultLine[] {
  const lines: BatchResultLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    lines.push(JSON.parse(t) as BatchResultLine);
  }
  return lines;
}

export function classificationFromBatchLine(
  line: BatchResultLine,
  activeVocabulary: string[],
): ClassificationResult | null {
  if (line.result?.type !== "succeeded") return null;
  const text = line.result.message?.content?.find(
    (b) => b.type === "text",
  )?.text;
  if (!text) return null;
  const parsed = JSON.parse(text) as ClassificationResult;
  parsed.tags = filterTagsToActive(parsed.tags ?? [], activeVocabulary);
  return parsed;
}

export async function fetchBatchResultsJsonl(opts: {
  apiKey: string;
  batchId: string;
  request?: typeof requestUrl;
}): Promise<string> {
  const request = opts.request ?? requestUrl;
  const res = await request({
    url: `${BATCHES_URL}/${opts.batchId}/results`,
    method: "GET",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Batch results failed (HTTP ${res.status})`);
  }
  // requestUrl may put body in .text
  if (typeof res.text === "string" && res.text.length) return res.text;
  if (typeof res.json === "string") return res.json;
  return JSON.stringify(res.json ?? "");
}

export interface ApplyBackfillReport {
  applied: number;
  failed: number;
  atomsCreated: number;
  markersAppended: number;
  proposedTags: string[];
}

export async function applyBackfillResults(opts: {
  app: App;
  work: BackfillWorkItem[];
  lines: BatchResultLine[];
  atomFolder: string;
  activeVocabulary: string[];
  /** Optional hubs for post-batch people repair (same as live classify). */
  personHubDetails?: Array<{
    canonicalTitle: string;
    matchKeys: string[];
    sections?: string[];
  }>;
  listHubDetails?: Array<{
    canonicalTitle: string;
    matchKeys: string[];
    sections?: string[];
  }>;
  enableHubProjection?: boolean;
  /**
   * The open run, when backfill is chunked. Atoms created here are appended to its corpus so the
   * *next* chunk can link them (KTD4a) — the same move `write.ts` makes between captures, one
   * granularity coarser.
   */
  run?: ContextRun;
}): Promise<ApplyBackfillReport> {
  const byId = new Map(opts.work.map((w) => [w.customId, w]));
  const existingAtoms = listAtomPaths(opts.app, opts.atomFolder);
  const dailyCache = new Map<string, string>();
  let applied = 0;
  let failed = 0;
  let atomsCreated = 0;
  let markersAppended = 0;
  const proposedIncoming: string[] = [];
  const atomPathsTouched: string[] = [];
  const hubs: PersonHub[] = (opts.personHubDetails ?? []).map((d) => ({
    canonicalTitle: d.canonicalTitle,
    matchKeys: d.matchKeys,
    path: "",
  }));

  for (const line of opts.lines) {
    const item = byId.get(line.custom_id);
    if (!item) {
      failed += 1;
      continue;
    }
    let result = classificationFromBatchLine(line, opts.activeVocabulary);
    if (!result) {
      failed += 1;
      continue;
    }
    result = applyClassificationQuality(item.capture.text, result, {
      titles: [],
      personHubs: hubs,
      personHubDetails: (opts.personHubDetails ?? []).map((d) => ({
        canonicalTitle: d.canonicalTitle,
        matchKeys: d.matchKeys,
        sections: d.sections ?? [],
      })),
      listHubDetails: (opts.listHubDetails ?? []).map((d) => ({
        canonicalTitle: d.canonicalTitle,
        matchKeys: d.matchKeys,
        sections: d.sections ?? [],
      })),
    });
    if (result.proposed_tags?.length) {
      proposedIncoming.push(...result.proposed_tags);
    }

    const plan = planWrite({
      result,
      capture: item.capture,
      dailyPath: item.note.path,
      dailyDate: item.note.date,
      atomFolder: opts.atomFolder,
      existingAtomPaths: existingAtoms,
    });
    if (
      plan.action.kind === "create_atom" ||
      plan.action.kind === "skip_existing_atom"
    ) {
      existingAtoms.add(plan.action.path);
    }

    let content = dailyCache.get(item.note.path);
    if (content === undefined) {
      const file = opts.app.vault.getAbstractFileByPath(item.note.path);
      if (!file || !("extension" in file)) {
        failed += 1;
        continue;
      }
      content = await opts.app.vault.read(
        file as import("obsidian").TFile,
      );
    }

    const { result: wr, newDailyContent } = await applyWrite(
      opts.app,
      plan,
      content,
    );
    if (wr.collisionBodyMismatch) {
      failed += 1;
      continue;
    }
    dailyCache.set(item.note.path, newDailyContent);
    applied += 1;
    if (wr.atomCreated) atomsCreated += 1;
    if (wr.markerAppended) markersAppended += 1;
    if (wr.atomCreated) {
      atomPathsTouched.push(wr.atomCreated);
      // Only newly created atoms: a collision skip means the file was already in the corpus.
      opts.run?.addWrittenAtom({
        path: wr.atomCreated,
        title: displayTitleForAtom(result.title),
        body: item.capture.text,
        tags: result.tags,
        links: result.links,
      });
    } else if (wr.atomUpdated) atomPathsTouched.push(wr.atomUpdated);
    else if (wr.atomSkippedCollision) atomPathsTouched.push(wr.atomSkippedCollision);
  }

  if (opts.enableHubProjection && atomPathsTouched.length) {
    const atomContents: string[] = [];
    for (const path of atomPathsTouched) {
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
      personHubTitles: (opts.personHubDetails ?? []).map((d) => d.canonicalTitle),
      personHubDetails: (opts.personHubDetails ?? []).map((d) => ({
        canonicalTitle: d.canonicalTitle,
        matchKeys: d.matchKeys,
        sections: d.sections ?? [],
      })),
    });
  }

  return {
    applied,
    failed,
    atomsCreated,
    markersAppended,
    proposedTags: mergeProposedTags([], proposedIncoming, opts.activeVocabulary),
  };
}

/**
 * Run a chunked backfill: one batch per calendar chunk, oldest first (U5, R4).
 *
 * Sequential is the whole point. A single batch over the entire history cannot give a February
 * capture the atom January produced, because at assembly time that atom does not exist — every
 * request is written before any result comes back. Submitting chunk by chunk, and applying each
 * chunk's results before the next chunk's shortlist is derived, is what recovers the 71% of in-run
 * links a frozen list loses. The cost of that ordering is wall-clock, not money: chunks queue
 * behind one another in the Batch API instead of running as one job.
 *
 * `runChunk` owns submit → wait → fetch → apply for one chunk. It is injected so the ordering can
 * be tested without an API.
 */
export async function runBackfillChunks(opts: {
  run: ContextRun;
  work: BackfillWorkItem[];
  model: string;
  granularity?: ChunkGranularity;
  /** Chunk one as the cost gate already resolved it — see `resolveBackfillChunks.firstChunk`. */
  firstChunk?: ResolvedBackfillChunk;
  runChunk: (
    chunk: ResolvedBackfillChunk,
    body: ReturnType<typeof buildBatchCreateBody>,
    position: { index: number; total: number },
  ) => Promise<ApplyBackfillReport>;
  activeVocabulary?: string[];
}): Promise<ApplyBackfillReport & { chunkCount: number }> {
  const total = chunkBackfillWork(opts.work, opts.granularity).length;
  const totals: ApplyBackfillReport = {
    applied: 0,
    failed: 0,
    atomsCreated: 0,
    markersAppended: 0,
    proposedTags: [],
  };
  let index = 0;

  await resolveBackfillChunks({
    run: opts.run,
    work: opts.work,
    granularity: opts.granularity,
    firstChunk: opts.firstChunk,
    onChunkResolved: async (chunk) => {
      const body = buildChunkBatchCreateBody(chunk, opts.model);
      const report = await opts.runChunk(chunk, body, { index, total });
      index += 1;
      totals.applied += report.applied;
      totals.failed += report.failed;
      totals.atomsCreated += report.atomsCreated;
      totals.markersAppended += report.markersAppended;
      totals.proposedTags = mergeProposedTags(
        totals.proposedTags,
        report.proposedTags,
        opts.activeVocabulary ?? [],
      );
    },
  });

  return { ...totals, chunkCount: total };
}

/**
 * What the confirm dialog is asking the user to spend, by engine (KTD11).
 *
 * A discriminant, not a widened `CostEstimate`: every Batch-API sentence in the old body was
 * false for a Plus user, whose captures go to the Atoms Plus proxy and never reach Anthropic
 * directly. Naming the wrong destination on the consent surface is the bug, and a shared body
 * with optional fields would let it come back.
 */
export type BackfillConfirmProps =
  | { engine: "byok"; estimate: CostEstimate }
  | {
      engine: "plus";
      /** The derived recent-first range this run would file. */
      run: Pick<
        RecentFirstRange,
        "captures" | "dailies" | "totalCaptures" | "overBudget"
      >;
      /**
       * Filings left in the period at last sync. **Omit** when the meter read failed or the
       * device is not signed in: a confidently wrong count on a consent surface is worse than
       * no count at all, so the copy falls back rather than guessing.
       */
      remaining?: number;
      /** Whole days left in the period, when known. */
      daysRemaining?: number | null;
    };

/** One paragraph of the dialog body. Muted lines take Obsidian's description styling. */
export interface BackfillConfirmLine {
  text: string;
  muted?: boolean;
}

export interface BackfillConfirmCopy {
  title: string;
  lines: BackfillConfirmLine[];
  /**
   * The aftermath of confirming, as its own visual block. Null when there is no aftermath to
   * state. It is a block and not another paragraph because the body is otherwise a flat list of
   * same-weight facts, and an aftermath sentence dropped into that list gets skimmed.
   */
  aftermath: { title: string; lines: string[] } | null;
  cancelLabel: string;
  confirmLabel: string;
}

/**
 * A leftover history this many top-ups deep is cheaper to run on the user's own key than to
 * drain in top-up increments, so that road gets named instead of only the expensive one.
 */
const OWN_KEY_ROAD_TOP_UPS = 5;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function byokCopy(estimate: CostEstimate): BackfillConfirmCopy {
  const lines: BackfillConfirmLine[] = [
    {
      text: "Uses the Anthropic Message Batches API (async, ~50% off). Results apply through the same write path (atoms + markers). Partial runs are safe — already-marked captures are skipped on resume.",
    },
    { text: `Captures: ${estimate.captureCount}` },
    // The money leads: dollars are the currency this user spends.
    { text: estimate.summaryLine },
    { text: `Model: ${estimate.model}`, muted: true },
    {
      text: estimate.chunks
        ? `Input tokens / request (count_tokens, mean over ${estimate.chunks.length} chunk(s)): ${estimate.inputTokensPerRequest}`
        : `Input tokens / request (count_tokens): ${estimate.inputTokensPerRequest}`,
      muted: true,
    },
  ];
  if (estimate.chunks) {
    lines.push({
      text: `Submitted as ${estimate.chunks.length} batch(es), oldest first — each one can link the atoms the previous one wrote.`,
      muted: true,
    });
  }
  lines.push(
    {
      text: `Worst-case input tokens (no cache credit): ${estimate.worstCaseInputTokens}`,
      muted: true,
    },
    {
      text: "Estimate does not credit cross-request batch cache hits (conservative).",
      muted: true,
    },
    {
      text: "Privacy: this sends historical captures and your title graph to Anthropic’s Batch API (server-retained for a window).",
      muted: true,
    },
  );
  return {
    title: "Backfill past captures",
    lines,
    aftermath: null,
    cancelLabel: "Cancel",
    confirmLabel: "Submit batch",
  };
}

const PLUS_PRIVACY: BackfillConfirmLine = {
  text: "Privacy: this sends the captures in range and your note titles to the Atoms Plus proxy, which files them for you.",
  muted: true,
};

function plusCopy(
  props: Extract<BackfillConfirmProps, { engine: "plus" }>,
): BackfillConfirmCopy {
  const title = "Backfill past captures";
  const { run, remaining } = props;

  // Nothing was read back from the meter, so there is no count this dialog can honestly show.
  if (remaining === undefined) {
    return {
      title,
      lines: [
        {
          text: "Your filing balance did not come back from the Plus service, so there is no count to show yet.",
        },
        {
          text: "Refresh status in Settings → Atoms, then open this again.",
          muted: true,
        },
        PLUS_PRIVACY,
      ],
      aftermath: null,
      cancelLabel: "Close",
      confirmLabel: "Refresh status",
    };
  }

  const leftOver = Math.max(0, run.totalCaptures - run.captures);

  if (run.overBudget) {
    const resetLine =
      typeof props.daysRemaining === "number" && props.daysRemaining > 0
        ? `Your filings reset in ${props.daysRemaining} ${plural(props.daysRemaining, "day", "days")}, and backfill picks up where it stopped. Nothing is lost while you wait.`
        : "Backfill picks up where it stopped when your filings reset. Nothing is lost while you wait.";
    const aftermathLines = [
      resetLine,
      `Or top up now: ${topUpPriceLabel()} for ${PLUS_PRICING.topUpFilings} more filings. Filings you spend back here are not there for new captures until the reset.`,
    ];
    if (leftOver >= PLUS_PRICING.topUpFilings * OWN_KEY_ROAD_TOP_UPS) {
      aftermathLines.push(
        `With your own Anthropic key, a history this size files for far less than topping up ${topUpPriceLabel()} at a time. Settings → Atoms.`,
      );
    }
    return {
      title,
      lines: [
        {
          text: "This period’s backfill filings do not reach the next day back yet, so nothing files right now.",
        },
        {
          text: `${leftOver} older ${plural(leftOver, "capture is", "captures are")} waiting further back.`,
          muted: true,
        },
        PLUS_PRIVACY,
      ],
      aftermath: { title: "What happens next", lines: aftermathLines },
      cancelLabel: "Close",
      confirmLabel: "Get more filings",
    };
  }

  const lines: BackfillConfirmLine[] = [
    {
      text: `Files ${run.captures} ${plural(run.captures, "capture", "captures")} from ${run.dailies} earlier ${plural(run.dailies, "day", "days")}, newest first.`,
    },
    // The filings count leads: filings are the currency this user spends.
    {
      text: `Uses ${run.captures} of the ${remaining} filings left in this period.`,
    },
  ];
  if (leftOver > 0) {
    lines.push({
      text: `${leftOver} older ${plural(leftOver, "capture stays", "captures stay")} where they are. The next run picks them up.`,
      muted: true,
    });
  }
  lines.push(
    {
      text: "Captures that already have an atom are skipped, so running this again is safe.",
      muted: true,
    },
    PLUS_PRIVACY,
  );

  return {
    title,
    lines,
    aftermath: null,
    cancelLabel: "Cancel",
    confirmLabel: "Start backfill",
  };
}

/** The dialog's words, resolved from the engine. Pure, so the consent copy is testable. */
export function backfillConfirmCopy(
  props: BackfillConfirmProps,
): BackfillConfirmCopy {
  return props.engine === "byok" ? byokCopy(props.estimate) : plusCopy(props);
}

/**
 * Confirmation modal — the run starts only if onConfirm runs.
 *
 * The modal knows nothing about what confirming means: the copy resolves the primary button's
 * words ("Start backfill", "Refresh status", "Get more filings") and the caller decides which
 * branch its own `onConfirm` runs, off the same offer the copy was resolved from.
 */
export class BackfillConfirmModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly props: BackfillConfirmProps,
    private readonly onConfirm: () => void | Promise<void>,
    /**
     * Closed without confirming — Cancel, Escape, or a click outside. Fires exactly once, and never
     * on the confirmed path, so it is the safe home for releasing whatever the gate was holding.
     *
     * The sheet closes *before* `onConfirm` runs, so the modal owns this answer rather than leaving
     * it to a flag at the call site. A caller that patched `onClose` and read a flag its own
     * `onConfirm` sets would read it one step too early and call every confirm a dismissal — which
     * is how the confirmed path came to release the run's corpus before submitting against it
     * (#438). Here `confirmed` is set before `close()`, so this can only fire on a real dismissal.
     */
    private readonly onDismiss?: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const copy = backfillConfirmCopy(this.props);
    contentEl.empty();
    contentEl.createEl("h2", { text: copy.title });

    for (const line of copy.lines) {
      contentEl.createEl("p", {
        text: line.text,
        ...(line.muted ? { cls: "setting-item-description" } : {}),
      });
    }

    if (copy.aftermath) {
      const block = contentEl.createDiv({ cls: "atoms-backfill-aftermath" });
      block.createEl("h3", { text: copy.aftermath.title });
      for (const text of copy.aftermath.lines) {
        block.createEl("p", { text });
      }
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(copy.cancelLabel).onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText(copy.confirmLabel)
          .setCta()
          .onClick(async () => {
            if (this.confirmed) return;
            this.confirmed = true;
            this.close();
            await this.onConfirm();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
    if (!this.confirmed) this.onDismiss?.();
  }
}

/** For tests: gate only fires submit when confirmed. */
export function createBackfillGate(opts: {
  estimate: CostEstimate;
  submit: () => void | Promise<void>;
}): { confirm: () => Promise<void>; wasSubmitted: () => boolean } {
  let submitted = false;
  return {
    wasSubmitted: () => submitted,
    confirm: async () => {
      if (opts.estimate.captureCount <= 0) return;
      submitted = true;
      await opts.submit();
    },
  };
}
