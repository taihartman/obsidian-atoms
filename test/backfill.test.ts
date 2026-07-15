import { describe, expect, it, vi } from "vitest";
import {
  assertBatchUsesHourCache,
  buildBatchCreateBody,
  buildBatchRequestParams,
  createBackfillGate,
  estimateBatchCost,
  enumerateBackfillWork,
  parseBatchResultsJsonl,
  classificationFromBatchLine,
  BATCH_DISCOUNT,
} from "../src/backfill";
import type { Capture, DailyNoteWithCaptures, VaultContext } from "../src/types";

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
