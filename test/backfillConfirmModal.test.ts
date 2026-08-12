/**
 * #433 U5 (KTD11) — the backfill confirm dialog branches on engine, not on a widened estimate.
 *
 * The bug this file pins: the modal named Anthropic's Batch API as the destination on every
 * line, including the privacy sentence, for a Plus user whose captures never touch it. Consent
 * that names the wrong destination is not consent, so the headline assertions are absences.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureObsidianUi,
  stopCapturingObsidianUi,
  type UiCapture,
} from "./mocks/obsidian";
import {
  BackfillConfirmModal,
  backfillConfirmCopy,
  estimateBatchCost,
  type BackfillConfirmProps,
} from "../src/pipeline/backfill";
import { PLUS_PRICING } from "../src/shared/plusPricing";

let ui: UiCapture;

beforeEach(() => {
  ui = captureObsidianUi();
  return () => stopCapturingObsidianUi();
});

const estimate = estimateBatchCost({
  captureCount: 12,
  model: "claude-sonnet-4-5",
  inputTokensPerRequest: 900,
});

function open(props: BackfillConfirmProps): void {
  const modal = new BackfillConfirmModal({} as never, props, () => {});
  modal.open();
}

/** Everything the dialog put on screen, as one blob. */
function screen(): string {
  return ui.strings.join(" \n ");
}

const plus = (
  over: Partial<Extract<BackfillConfirmProps, { engine: "plus" }>> = {},
): BackfillConfirmProps => ({
  engine: "plus",
  run: { captures: 42, dailies: 6, totalCaptures: 90, overBudget: false },
  remaining: 88,
  daysRemaining: 12,
  ...over,
});

describe("BackfillConfirmModal — engine branches", () => {
  it("never names the Batch API or Anthropic-direct retention on the Plus branch", () => {
    open(plus());
    const text = screen();
    expect(text).not.toMatch(/batch/i);
    expect(text).not.toMatch(/anthropic/i);
    expect(text).not.toMatch(/server-retained/i);
  });

  it("names the Atoms Plus proxy as the destination on the Plus branch", () => {
    open(plus());
    expect(screen()).toMatch(/Atoms Plus proxy/);
  });

  it("keeps the Batch API privacy sentence on the BYOK branch", () => {
    open({ engine: "byok", estimate });
    const text = screen();
    expect(text).toMatch(/Privacy:/);
    expect(text).toMatch(/Batch API/);
    expect(text).toMatch(/server-retained/i);
  });

  it("prices Plus in filings and BYOK in dollars", () => {
    open(plus());
    expect(screen()).toMatch(/42 of the 88 filings/);
    expect(screen()).not.toMatch(/\$/);

    stopCapturingObsidianUi();
    ui = captureObsidianUi();
    open({ engine: "byok", estimate });
    expect(screen()).toContain(estimate.summaryLine);
    expect(screen()).toMatch(/\$/);
  });
});

describe("BackfillConfirmModal — over budget", () => {
  const overBudget = plus({
    run: { captures: 0, dailies: 0, totalCaptures: 120, overBudget: true },
    remaining: 4,
  });

  it("states the aftermath in its own block and offers the top-up, without refusing", () => {
    open(overBudget);
    const text = screen();
    expect(text).toMatch(/reset/i);
    expect(text).toContain(`${PLUS_PRICING.topUpFilings} more filings`);
    expect(text).toContain(`$${PLUS_PRICING.topUpUsd}`);
    // No refusal, and no permanent-loss framing for a per-period allowance.
    expect(text).not.toMatch(/not enough|don’t have|don't have|insufficient|can’t|cannot/i);

    const copy = backfillConfirmCopy(overBudget);
    expect(copy.aftermath?.lines.length).toBeGreaterThan(0);
  });

  it("names the cheaper own-key road only when the history left over is large", () => {
    const small = backfillConfirmCopy(overBudget);
    expect(small.aftermath?.lines.join(" ")).not.toMatch(/your own Anthropic key/i);

    const large = backfillConfirmCopy(
      plus({
        run: {
          captures: 0,
          dailies: 0,
          totalCaptures: PLUS_PRICING.topUpFilings * 5 + 1,
          overBudget: true,
        },
        remaining: 4,
      }),
    );
    expect(large.aftermath?.lines.join(" ")).toMatch(/your own Anthropic key/i);
  });
});

describe("BackfillConfirmModal — unreadable meter", () => {
  it("falls back instead of stating a filings count it cannot source", () => {
    open(plus({ remaining: undefined }));
    const text = screen();
    expect(text).toMatch(/Refresh status/);
    expect(text).not.toMatch(/\d+ of the \d+ filings/);
    expect(text).not.toMatch(/more than your plan/i);
    expect(backfillConfirmCopy(plus({ remaining: undefined })).aftermath).toBeNull();
  });
});
