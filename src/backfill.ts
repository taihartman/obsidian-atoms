import { requestUrl, type App, Modal, Notice, Setting } from "obsidian";
import { ANTHROPIC_VERSION, buildMessagesRequest } from "./classify";
import type { MetadataContextProvider } from "./context";
import { getPastDailyNotesWithUnmarkedCaptures } from "./daily";
import {
  applyWrite,
  listAtomPaths,
  planWrite,
} from "./render";
import type {
  Capture,
  ClassificationResult,
  DailyNoteWithCaptures,
  VaultContext,
} from "./types";
import { enrichPersonLinks, type PersonHub } from "./people";
import { enrichMediaLinks } from "./media";
import { filterTagsToActive, mergeProposedTags } from "./vocabulary";

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

export interface CostEstimate {
  captureCount: number;
  model: string;
  /** Tokens per request (input side from count_tokens). */
  inputTokensPerRequest: number;
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
}): CostEstimate {
  const n = Math.max(0, opts.captureCount);
  const perIn = Math.max(0, opts.inputTokensPerRequest);
  const perOut = opts.assumedOutputTokens ?? ASSUMED_OUTPUT_TOKENS;
  const rates = ratesForModel(opts.model);
  const disc = BATCH_DISCOUNT;

  const worstCaseInputTokens = perIn * n;
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

/** Batch request params with 1h cache TTL (U10). */
export function buildBatchRequestParams(opts: {
  model: string;
  capture: string;
  context: VaultContext;
}): Record<string, unknown> {
  const full = buildMessagesRequest({
    model: opts.model,
    capture: opts.capture,
    context: opts.context,
    cacheTtl: "1h",
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
): { requests: Array<{ custom_id: string; params: Record<string, unknown> }> } {
  return {
    requests: work.map((w) => ({
      custom_id: w.customId,
      params: buildBatchRequestParams({
        model,
        capture: w.capture.text,
        context,
      }),
    })),
  };
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
  context: VaultContext;
}

export async function prepareBackfillEstimate(opts: {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  request?: typeof requestUrl;
}): Promise<BackfillEstimateResult> {
  const listed = await getPastDailyNotesWithUnmarkedCaptures(opts.app);
  const work = enumerateBackfillWork(listed.notes);
  const context = opts.contextProvider.buildContext();

  if (work.length === 0) {
    return {
      work,
      context,
      estimate: estimateBatchCost({
        captureCount: 0,
        inputTokensPerRequest: 0,
        model: opts.model,
      }),
    };
  }

  const sample = work[0]!.capture.text;
  const inputTokensPerRequest = await countTokensForClassifyRequest({
    apiKey: opts.apiKey,
    model: opts.model,
    context,
    sampleCapture: sample,
    request: opts.request,
  });

  return {
    work,
    context,
    estimate: estimateBatchCost({
      captureCount: work.length,
      inputTokensPerRequest,
      model: opts.model,
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
    opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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
  personHubDetails?: Array<{ canonicalTitle: string; matchKeys: string[] }>;
}): Promise<ApplyBackfillReport> {
  const byId = new Map(opts.work.map((w) => [w.customId, w]));
  const existingAtoms = listAtomPaths(opts.app, opts.atomFolder);
  const dailyCache = new Map<string, string>();
  let applied = 0;
  let failed = 0;
  let atomsCreated = 0;
  let markersAppended = 0;
  const proposedIncoming: string[] = [];
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
    result = enrichPersonLinks(item.capture.text, result, hubs);
    result = enrichMediaLinks(item.capture.text, result, []);
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
    if (plan.action.kind === "create_atom") {
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
    dailyCache.set(item.note.path, newDailyContent);
    applied += 1;
    if (wr.atomCreated) atomsCreated += 1;
    if (wr.markerAppended) markersAppended += 1;
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
 * Confirmation modal — batch is submitted only if onConfirm runs.
 */
export class BackfillConfirmModal extends Modal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly estimate: CostEstimate,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Backfill past captures" });
    contentEl.createEl("p", {
      text: "Uses the Anthropic Message Batches API (async, ~50% off). Results apply through the same write path (atoms + markers). Partial runs are safe — already-marked captures are skipped on resume.",
    });

    contentEl.createEl("p", {
      text: `Captures: ${this.estimate.captureCount}`,
    });
    contentEl.createEl("p", { text: `Model: ${this.estimate.model}` });
    contentEl.createEl("p", {
      text: `Input tokens / request (count_tokens): ${this.estimate.inputTokensPerRequest}`,
    });
    contentEl.createEl("p", {
      text: `Worst-case input tokens (no cache credit): ${this.estimate.worstCaseInputTokens}`,
    });
    contentEl.createEl("p", {
      text: this.estimate.summaryLine,
    });
    contentEl.createEl("p", {
      text: "Estimate does not credit cross-request batch cache hits (conservative).",
      cls: "setting-item-description",
    });
    contentEl.createEl("p", {
      text: "Privacy: this sends historical captures and your title graph to Anthropic’s Batch API (server-retained for a window).",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Submit batch")
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
