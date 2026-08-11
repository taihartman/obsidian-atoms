import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBatchUsesHourCache,
  BackfillConfirmModal,
  buildBatchCreateBody,
  buildBatchRequestParams,
  buildChunkBatchCreateBody,
  chunkBackfillWork,
  createBackfillGate,
  estimateBatchCost,
  enumerateBackfillWork,
  parseBatchResultsJsonl,
  prepareBackfillEstimate,
  resolveBackfillChunks,
  runBackfillChunks,
  classificationFromBatchLine,
  BATCH_DISCOUNT,
  type ApplyBackfillReport,
  type BackfillConfirmProps,
} from "../src/pipeline/backfill";
import { UNDATED_CHUNK_KEY } from "../src/pipeline/context";
import {
  contextProviderFor as provider,
  fakeVault,
  stubDailyNotes,
} from "./helpers/pipelineVault";
import type { Capture, DailyNoteWithCaptures, VaultContext } from "../src/shared/types";

afterEach(() => vi.restoreAllMocks());

const ctx: VaultContext = {
  personHubs: [],
  personHubDetails: [],
  titles: ["Note A", "Note B"],
  tags: ["idea"],
  vocabulary: ["idea"],
};

const cap = (text: string, line = 0): Capture => ({
  text,
  timestamp: null,
  startLine: line,
  endLine: line,
  processed: false,
  markerKind: null,
  markerLine: null,
});

describe("estimateBatchCost", () => {
  it("does not credit cross-request cache reads (worst case = full prefix × N × batch discount)", () => {
    const n = 10;
    const perIn = 1000;
    const est = estimateBatchCost({
      captureCount: n,
      inputTokensPerRequest: perIn,
      model: "claude-haiku-4-5-20251001",
    });
    expect(est.creditsCacheReads).toBe(false);
    expect(est.worstCaseInputTokens).toBe(perIn * n);
    expect(est.captureCount).toBe(n);
    // Haiku $1/MTok input, $5/MTok output, 50% batch
    const rates = { input: 1, output: 5 };
    const expected =
      ((perIn * n * rates.input + est.estimatedOutputTokens * rates.output) /
        1_000_000) *
      BATCH_DISCOUNT;
    expect(est.worstCaseUsd).toBeCloseTo(expected, 6);
    expect(est.bestCaseUsd).toBeLessThanOrEqual(est.worstCaseUsd + 1e-9);
  });

  it("zero captures → zero cost", () => {
    const est = estimateBatchCost({
      captureCount: 0,
      inputTokensPerRequest: 999,
      model: "claude-sonnet-5",
    });
    expect(est.worstCaseUsd).toBe(0);
    expect(est.summaryLine).toMatch(/No unmarked/);
  });
});

describe("batch request shape", () => {
  it("uses cache_control ttl 1h on context breakpoint", () => {
    const params = buildBatchRequestParams({
      model: "claude-haiku-4-5-20251001",
      capture: "hello",
      context: ctx,
    });
    const messages = params.messages as Array<{
      content: Array<{ cache_control?: { ttl?: string; type?: string } }>;
    }>;
    expect(messages[0]!.content[0]!.cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    expect(messages[1]!.content[0]!.cache_control).toBeUndefined();
  });

  it("assertBatchUsesHourCache on full body", () => {
    const notes: DailyNoteWithCaptures[] = [
      {
        path: "Daily/2026-07-01.md",
        date: "2026-07-01",
        captures: [cap("a"), cap("b", 1)],
        unprocessed: [cap("a"), cap("b", 1)],
      },
    ];
    const work = enumerateBackfillWork(notes);
    expect(work).toHaveLength(2);
    const body = buildBatchCreateBody(work, "claude-haiku-4-5-20251001", ctx);
    expect(assertBatchUsesHourCache(body)).toBe(true);
    expect(body.requests[0]!.custom_id).toContain("cap-0");
  });
});

describe("confirmation gate", () => {
  it("does not submit until confirm", async () => {
    const submit = vi.fn(async () => {});
    const gate = createBackfillGate({
      estimate: estimateBatchCost({
        captureCount: 3,
        inputTokensPerRequest: 100,
        model: "claude-haiku-4-5-20251001",
      }),
      submit,
    });
    expect(gate.wasSubmitted()).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    await gate.confirm();
    expect(gate.wasSubmitted()).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("zero captures confirm does not submit", async () => {
    const submit = vi.fn(async () => {});
    const gate = createBackfillGate({
      estimate: estimateBatchCost({
        captureCount: 0,
        inputTokensPerRequest: 0,
        model: "m",
      }),
      submit,
    });
    await gate.confirm();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("BackfillConfirmModal dismissal (run lifetime)", () => {
  const gateProps: BackfillConfirmProps = {
    engine: "byok",
    estimate: estimateBatchCost({
      captureCount: 2,
      inputTokensPerRequest: 100,
      model: "claude-haiku-4-5-20251001",
    }),
  };

  const clickButton = (modal: BackfillConfirmModal, text: string) => {
    const btn = [...modal.contentEl.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    expect(btn, `no "${text}" button`).toBeTruthy();
    btn!.click();
  };

  it("does not fire onDismiss when confirmed, so the run survives into the submit", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([
      note("2026-01-05", ["sleep debt is wrecking me"]),
      note("2026-02-05", ["sleep debt again in february"]),
    ]);

    let submitted: Promise<void> = Promise.resolve();
    let submitError: unknown = null;
    const dismiss = vi.fn(() => run.end());

    const modal = new BackfillConfirmModal(
      v.app,
      gateProps,
      () => {
        // The sheet is already closed here — the ordering trap this test exists for. Every chunk
        // after the first derives its shortlist from this run, so it has to still hold its corpus.
        submitted = (async () => {
          try {
            await resolveBackfillChunks({ run, work });
          } catch (e) {
            submitError = e;
          } finally {
            run.end();
          }
        })();
        return submitted;
      },
      dismiss,
    );
    modal.open();
    clickButton(modal, "Submit batch");
    await submitted;

    expect(submitError).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("fires onDismiss exactly once when the sheet closes without confirming", async () => {
    const dismiss = vi.fn();
    const onConfirm = vi.fn();
    const modal = new BackfillConfirmModal(catchUpVault().app, gateProps, onConfirm, dismiss);
    modal.open();
    clickButton(modal, "Cancel");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);

    // Escape or a second close must not release the corpus twice.
    modal.close();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("fires onDismiss when the sheet is dismissed without a button (Escape)", () => {
    const dismiss = vi.fn();
    const modal = new BackfillConfirmModal(catchUpVault().app, gateProps, vi.fn(), dismiss);
    modal.open();
    modal.close();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("batch results parsing", () => {
  it("parses JSONL and extracts classification", () => {
    const line = {
      custom_id: "cap-0",
      result: {
        type: "succeeded",
        message: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                verdict: "task",
                title: "",
                tags: ["idea", "nope"],
                proposed_tags: ["x"],
                links: [],
              }),
            },
          ],
        },
      },
    };
    const jsonl = JSON.stringify(line) + "\n";
    const lines = parseBatchResultsJsonl(jsonl);
    expect(lines).toHaveLength(1);
    const cls = classificationFromBatchLine(lines[0]!, ["idea"]);
    expect(cls?.verdict).toBe("task");
    expect(cls?.tags).toEqual(["idea"]);
  });
});

// --- U5: chunked catch-up ------------------------------------------------------------------

const note = (date: string, texts: string[]): DailyNoteWithCaptures => ({
  path: `Daily/${date}.md`,
  date,
  captures: texts.map((t, i) => cap(t, i)),
  unprocessed: texts.map((t, i) => cap(t, i)),
});

const titlesBlockOf = (params: Record<string, unknown>): string => {
  const messages = params.messages as Array<{ content: Array<{ text?: string }> }>;
  return messages[0]!.content[1]!.text ?? "";
};
const titlesCacheOf = (params: Record<string, unknown>): unknown => {
  const messages = params.messages as Array<{
    content: Array<{ cache_control?: unknown }>;
  }>;
  return messages[0]!.content[1]!.cache_control;
};

/** Four atoms of clearly separate vocabulary, so a shortlist is checkable by eye. */
const catchUpVault = () =>
  fakeVault({
    "Atoms/Sleep debt compounds.md":
      "---\ntags:\n  - idea\n---\nsleep debt wrecked my focus all week\n",
    "Atoms/Espresso grind size.md":
      "---\ntags:\n  - idea\n---\nespresso grind size changed the extraction\n",
    "Atoms/Kayak portage route.md":
      "---\ntags:\n  - idea\n---\nthe kayak portage route was flooded\n",
    "Atoms/Sourdough starter timing.md":
      "---\ntags:\n  - idea\n---\nsourdough starter timing is everything\n",
  });

describe("chunkBackfillWork (U5)", () => {
  it("groups by calendar month, oldest chunk first", () => {
    const work = enumerateBackfillWork([
      note("2026-03-02", ["c"]),
      note("2026-01-05", ["a"]),
      note("2026-01-28", ["b"]),
    ]);
    const chunks = chunkBackfillWork(work);
    expect(chunks.map((c) => c.key)).toEqual(["2026-01", "2026-03"]);
    expect(chunks[0]!.work.map((w) => w.capture.text)).toEqual(["a", "b"]);
  });

  it("weekly is the measured alternative, not a hardcoded month", () => {
    const work = enumerateBackfillWork([
      note("2026-01-05", ["mon"]),
      note("2026-01-11", ["sun"]),
      note("2026-01-12", ["next mon"]),
    ]);
    expect(chunkBackfillWork(work, "month").map((c) => c.key)).toEqual(["2026-01"]);
    // ISO weeks: 5th–11th Jan is one week, the 12th starts the next.
    expect(chunkBackfillWork(work, "week").map((c) => c.key)).toEqual([
      "2026-W02",
      "2026-W03",
    ]);
  });

  it("an undated capture joins its nearest dated neighbour, never its own chunk", () => {
    const work = enumerateBackfillWork([
      note("", ["leading orphan"]),
      note("2026-01-05", ["dated"]),
      note("not-a-date", ["trailing orphan"]),
    ]);
    const chunks = chunkBackfillWork(work);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.key).toBe("2026-01");
    expect(chunks[0]!.work).toHaveLength(3);
  });

  it("only a wholly undated list gets the undated chunk", () => {
    const work = enumerateBackfillWork([note("", ["a"]), note("junk", ["b"])]);
    const chunks = chunkBackfillWork(work);
    expect(chunks.map((c) => c.key)).toEqual([UNDATED_CHUNK_KEY]);
  });
});

describe("chunk request shape (U5)", () => {
  it("every capture in a chunk gets a BYTE-IDENTICAL titles block, inside the cached prefix", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([
      note("2026-01-05", ["sleep debt is wrecking me"]),
      note("2026-01-20", ["espresso grind again", "kayak portage flooded"]),
    ]);
    const [chunk] = await resolveBackfillChunks({ run, work });
    expect(chunk!.work).toHaveLength(3);

    const body = buildChunkBatchCreateBody(chunk!, "claude-haiku-4-5-20251001");
    const blocks = body.requests.map((r) => titlesBlockOf(r.params));
    // Byte-identity, not "similar": the cached prefix is only read back on an exact match.
    expect(new Set(blocks).size).toBe(1);
    for (const b of blocks) expect(b).toBe(blocks[0]);
    // Captures still differ — it is the *titles* that are shared, not the request.
    const captures = body.requests.map(
      (r) =>
        (r.params.messages as Array<{ content: Array<{ text?: string }> }>)[1]!
          .content[0]!.text,
    );
    expect(new Set(captures).size).toBe(3);

    // The breakpoint that makes the identity pay: block B is cached too, at the batch TTL.
    for (const r of body.requests) {
      expect(titlesCacheOf(r.params)).toEqual({ type: "ephemeral", ttl: "1h" });
    }
    // Block A's breakpoint is untouched — assertBatchUsesHourCache still gates on index 0.
    expect(assertBatchUsesHourCache(body)).toBe(true);
    run.end();
  });

  it("a chunk of one capture does not cache its titles — nothing would read the entry back", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([note("2026-01-05", ["sleep debt again"])]);
    const [chunk] = await resolveBackfillChunks({ run, work });
    expect(chunk!.cacheTitles).toBe(false);
    const body = buildChunkBatchCreateBody(chunk!, "claude-haiku-4-5-20251001");
    expect(titlesCacheOf(body.requests[0]!.params)).toBeUndefined();
    expect(assertBatchUsesHourCache(body)).toBe(true);
    run.end();
  });

  it("tolerates an empty shortlist", async () => {
    const v = fakeVault({});
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([note("2026-01-05", ["a", "b"])]);
    const [chunk] = await resolveBackfillChunks({ run, work });
    expect(chunk!.context.titles).toEqual([]);
    const body = buildChunkBatchCreateBody(chunk!, "claude-haiku-4-5-20251001");
    expect(titlesBlockOf(body.requests[0]!.params)).toContain("(empty vault)");
    run.end();
  });
});

describe("cross-chunk visibility (U5, R4)", () => {
  it("an atom created in an earlier chunk is in a later chunk's shortlist", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([
      note("2026-01-05", ["the tandem brake cable snapped on the long descent"]),
      note("2026-02-05", ["the tandem brake cable frayed again on that descent"]),
    ]);

    const seen: string[][] = [];
    await resolveBackfillChunks({
      run,
      work,
      onChunkResolved: (chunk) => {
        seen.push(chunk.context.titles);
        if (chunk.key === "2026-01") {
          run.addAtom({
            path: "Atoms/Tandem brake cable snapped.md",
            title: "Tandem brake cable snapped",
            body: "the tandem brake cable snapped on the long descent",
            tags: ["idea"],
            links: [],
          });
        }
      },
    });

    expect(seen[0]).not.toContain("Tandem brake cable snapped");
    expect(seen[1]).toContain("Tandem brake cable snapped");
    run.end();
  });

  it("runBackfillChunks applies each chunk before resolving the next, oldest first", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([
      note("2026-01-05", ["january tandem brake cable"]),
      note("2026-02-05", ["february tandem brake cable"]),
      note("2026-03-05", ["march tandem brake cable"]),
    ]);
    const order: string[] = [];
    const empty: ApplyBackfillReport = {
      applied: 1,
      failed: 0,
      atomsCreated: 1,
      markersAppended: 1,
      proposedTags: [],
    };

    const report = await runBackfillChunks({
      run,
      work,
      model: "claude-haiku-4-5-20251001",
      runChunk: async (chunk, body, pos) => {
        order.push(`${chunk.key}:${pos.index + 1}/${pos.total}`);
        expect(body.requests).toHaveLength(1);
        run.addAtom({
          path: `Atoms/${chunk.key} tandem.md`,
          title: `${chunk.key} tandem`,
          body: `${chunk.key} tandem brake cable`,
          tags: [],
          links: [],
        });
        return empty;
      },
    });

    expect(order).toEqual(["2026-01:1/3", "2026-02:2/3", "2026-03:3/3"]);
    expect(report.chunkCount).toBe(3);
    expect(report.applied).toBe(3);
    expect(report.atomsCreated).toBe(3);
    run.end();
  });

  it("reuses the chunk the cost gate already resolved, and only that one", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([
      note("2026-01-05", ["january tandem brake cable"]),
      note("2026-02-05", ["february tandem brake cable"]),
    ]);

    // What the gate resolved: every chunk, against a corpus with nothing written yet.
    const priced = await resolveBackfillChunks({ run, work });
    const resolveSpy = vi.spyOn(run, "getChunkCandidates");

    const seen: typeof priced = [];
    await runBackfillChunks({
      run,
      work,
      model: "claude-haiku-4-5-20251001",
      firstChunk: priced[0],
      runChunk: async (chunk) => {
        seen.push(chunk);
        run.addAtom({
          path: `Atoms/${chunk.key} tandem.md`,
          title: `${chunk.key} tandem`,
          body: `${chunk.key} tandem brake cable`,
          tags: [],
          links: [],
        });
        return { applied: 1, failed: 0, atomsCreated: 1, markersAppended: 1, proposedTags: [] };
      },
    });

    // Chunk one is the priced object itself — not a recomputed lookalike.
    expect(seen[0]).toBe(priced[0]);
    // Chunk two is still re-resolved: it must see the atom chunk one just wrote (R4).
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(seen[1]!.context.titles).toContain("2026-01 tandem");
    run.end();
  });

  it("ignores a stale firstChunk whose key is not the first chunk of this work", async () => {
    const v = catchUpVault();
    const run = await provider(v.app).beginRun({ atomFolder: "Atoms" });
    const work = enumerateBackfillWork([note("2026-02-05", ["february tandem brake cable"])]);
    const stale = {
      key: "1999-01",
      work: [],
      context: { titles: ["nonsense"], tags: [], vocabulary: [], personHubs: [], personHubDetails: [] },
      cacheTitles: false,
    };

    const seen: string[] = [];
    await runBackfillChunks({
      run,
      work,
      model: "claude-haiku-4-5-20251001",
      firstChunk: stale,
      runChunk: async (chunk) => {
        seen.push(chunk.key);
        return { applied: 0, failed: 0, atomsCreated: 0, markersAppended: 0, proposedTags: [] };
      },
    });

    expect(seen).toEqual(["2026-02"]);
    run.end();
  });
});

describe("chunked cost estimate (U5)", () => {
  it("sums per-chunk sizes instead of multiplying one sample by N", () => {
    const est = estimateBatchCost({
      captureCount: 0,
      inputTokensPerRequest: 0,
      model: "claude-haiku-4-5-20251001",
      chunks: [
        { key: "2026-01", captureCount: 10, inputTokensPerRequest: 1000 },
        { key: "2026-02", captureCount: 30, inputTokensPerRequest: 2000 },
      ],
    });
    expect(est.captureCount).toBe(40);
    expect(est.worstCaseInputTokens).toBe(10 * 1000 + 30 * 2000);
    // Headline is the capture-weighted mean, not either chunk's own size.
    expect(est.inputTokensPerRequest).toBe(70000 / 40);
    const expected =
      ((70000 * 1 + est.estimatedOutputTokens * 5) / 1_000_000) * BATCH_DISCOUNT;
    expect(est.worstCaseUsd).toBeCloseTo(expected, 6);
  });

  it("gates before any submit, on shortlist-sized context, with expansion off", async () => {
    stubDailyNotes([
      { path: "Daily/2026-01-05.md", date: "2026-01-05" },
      { path: "Daily/2026-02-05.md", date: "2026-02-05" },
    ]);
    const merged = fakeVault({
      "Daily/2026-01-05.md": "- sleep debt wrecked my focus\n",
      "Daily/2026-02-05.md": "- espresso grind size again\n",
      "Atoms/Sleep debt compounds.md":
        "---\ntags:\n  - idea\n---\nsleep debt wrecked my focus all week\n",
      "Atoms/Espresso grind size.md":
        "---\ntags:\n  - idea\n---\nespresso grind size changed the extraction\n",
    });
    const mp = provider(merged.app);
    const spy = vi.spyOn(mp, "beginRun");

    const counted: Array<Record<string, unknown>> = [];
    const submitted = vi.fn();
    const request = (async (o: { body?: string }) => {
      const body = JSON.parse(o.body ?? "{}") as Record<string, unknown>;
      counted.push(body);
      return { status: 200, json: { input_tokens: 1234 } };
    }) as never;

    const prepared = await prepareBackfillEstimate({
      app: merged.app,
      contextProvider: mp,
      apiKey: "k",
      model: "claude-haiku-4-5-20251001",
      atomFolder: "Atoms",
      request,
    });

    // Nothing was submitted — count_tokens only.
    expect(submitted).not.toHaveBeenCalled();
    expect(prepared.chunks.map((c) => c.key)).toEqual(["2026-01", "2026-02"]);
    expect(prepared.estimate.chunks).toHaveLength(2);
    // R7/KTD7: a catch-up must never pay for the graph walk.
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ expandGraph: false }),
    );
    // One count_tokens per chunk, each carrying that chunk's shortlist rather than the vault.
    expect(counted).toHaveLength(2);
    const firstTitles = (
      (counted[0]!.messages as Array<{ content: Array<{ text?: string }> }>)[0]!
        .content[1]!.text ?? ""
    );
    expect(firstTitles).toContain("Sleep debt compounds");
    expect(firstTitles).not.toContain("2026-02-05");

    // The gate still owns submission.
    const gate = createBackfillGate({ estimate: prepared.estimate, submit: submitted });
    expect(gate.wasSubmitted()).toBe(false);
    prepared.run.end();
  });
});

describe("resume semantics", () => {
  it("enumerate only uses unprocessed list (marked already excluded upstream)", () => {
    const notes: DailyNoteWithCaptures[] = [
      {
        path: "Daily/a.md",
        date: "2026-07-01",
        captures: [cap("done"), cap("todo", 1)],
        unprocessed: [cap("todo", 1)],
      },
    ];
    const work = enumerateBackfillWork(notes);
    expect(work).toHaveLength(1);
    expect(work[0]!.capture.text).toBe("todo");
  });
});
