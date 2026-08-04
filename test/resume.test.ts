import { describe, expect, it } from "vitest";
import {
  BACKLOG_GATE_THRESHOLD,
  decideResumeStages,
  FILING_BUDGET_CAP,
  FILING_COOLDOWN_MS,
  FILING_LIVENESS_MS,
  formatLastCatchupLine,
  LIVENESS_MS,
  pruneBudgetWindow,
  RESUME_MIN_INTERVAL_MS,
  WAIVED_FILING_PASS_CAP,
  type ResumeDecisionInput,
} from "../src/platform/resume";

function base(over: Partial<ResumeDecisionInput> = {}): ResumeDecisionInput {
  return {
    now: 1_000_000,
    resumeEnabled: true,
    manual: false,
    vaultIndexReady: true,
    egressNoticeAcked: true,
    lastResumePassAt: null,
    lastStageRunAt: {},
    lastStageFailAt: {},
    inFlightStartedAt: {},
    filingBudgetStamps: [],
    waivedFilingStamps: [],
    hasNewDrainedWork: false,
    waiverUsedThisSignal: false,
    ...over,
  };
}

describe("decideResumeStages", () => {
  it("first ever call runs all stages", () => {
    const d = decideResumeStages(base());
    expect(d.stages.drain.run).toBe(true);
    expect(d.stages.outbox.run).toBe(true);
    expect(d.stages.mirror.run).toBe(true);
    expect(d.stages.filing.run).toBe(true);
  });

  it("min interval blocks automated resume", () => {
    const now = 1_000_000;
    const d = decideResumeStages(
      base({
        now,
        lastResumePassAt: now - RESUME_MIN_INTERVAL_MS + 1,
      }),
    );
    expect(d.stages.drain).toEqual({ run: false, reason: "min_interval" });
  });

  it("exactly at min interval boundary runs", () => {
    const now = 1_000_000;
    const d = decideResumeStages(
      base({
        now,
        lastResumePassAt: now - RESUME_MIN_INTERVAL_MS,
      }),
    );
    expect(d.stages.drain.run).toBe(true);
  });

  it("kill switch blocks automated but not manual", () => {
    const auto = decideResumeStages(base({ resumeEnabled: false }));
    expect(auto.stages.drain).toEqual({ run: false, reason: "kill_switch" });
    const man = decideResumeStages(
      base({ resumeEnabled: false, manual: true }),
    );
    expect(man.stages.drain.run).toBe(true);
  });

  it("vault not ready blocks all", () => {
    const d = decideResumeStages(base({ vaultIndexReady: false }));
    expect(d.stages.filing).toEqual({
      run: false,
      reason: "vault_not_ready",
    });
  });

  it("filing cooldown refuses paid stage; cheap stages still run", () => {
    const now = 1_000_000;
    const d = decideResumeStages(
      base({
        now,
        lastStageRunAt: { filing: now - FILING_COOLDOWN_MS + 1000 },
      }),
    );
    expect(d.stages.drain.run).toBe(true);
    expect(d.stages.filing).toEqual({ run: false, reason: "cooldown" });
  });

  it("new work waives filing cooldown once per signal", () => {
    const now = 1_000_000;
    const d = decideResumeStages(
      base({
        now,
        lastStageRunAt: { filing: now - 1000 },
        hasNewDrainedWork: true,
        waiverUsedThisSignal: false,
      }),
    );
    expect(d.stages.filing).toEqual({ run: true, waivedCooldown: true });
    expect(d.grantWaiver).toBe(true);

    const again = decideResumeStages(
      base({
        now,
        lastStageRunAt: { filing: now - 1000 },
        hasNewDrainedWork: true,
        waiverUsedThisSignal: true,
      }),
    );
    expect(again.stages.filing).toEqual({ run: false, reason: "cooldown" });
  });

  it("waived filing pass cap stops further waivers", () => {
    const now = 1_000_000;
    const waived = Array.from({ length: WAIVED_FILING_PASS_CAP }, (_, i) =>
      now - i * 60_000,
    );
    const d = decideResumeStages(
      base({
        now,
        lastStageRunAt: { filing: now - 1000 },
        hasNewDrainedWork: true,
        waivedFilingStamps: waived,
      }),
    );
    expect(d.stages.filing).toEqual({ run: false, reason: "cooldown" });
    expect(d.grantWaiver).toBe(false);
  });

  it("rolling filing budget blocks paid stage", () => {
    const now = 1_000_000;
    const stamps = Array.from({ length: FILING_BUDGET_CAP }, () => now - 1000);
    const d = decideResumeStages(base({ now, filingBudgetStamps: stamps }));
    expect(d.stages.filing).toEqual({ run: false, reason: "budget" });
    expect(d.stages.drain.run).toBe(true);
  });

  it("in-flight younger than liveness is refused; older is dead", () => {
    const now = 1_000_000;
    const young = decideResumeStages(
      base({
        now,
        inFlightStartedAt: { drain: now - LIVENESS_MS + 1000 },
      }),
    );
    expect(young.stages.drain).toEqual({ run: false, reason: "in_flight" });

    const dead = decideResumeStages(
      base({
        now,
        inFlightStartedAt: { drain: now - LIVENESS_MS - 1 },
      }),
    );
    expect(dead.stages.drain.run).toBe(true);
  });

  it("filing uses longer liveness ceiling", () => {
    const now = 1_000_000;
    const mid = decideResumeStages(
      base({
        now,
        inFlightStartedAt: {
          filing: now - LIVENESS_MS - 1, // past general, inside filing
        },
      }),
    );
    expect(mid.stages.filing).toEqual({ run: false, reason: "in_flight" });

    const dead = decideResumeStages(
      base({
        now,
        inFlightStartedAt: { filing: now - FILING_LIVENESS_MS - 1 },
      }),
    );
    expect(dead.stages.filing.run).toBe(true);
  });

  it("clock jump backwards does not satisfy cooldown", () => {
    const now = 1_000_000;
    const d = decideResumeStages(
      base({
        now,
        lastStageRunAt: { filing: now + 60_000 }, // "future" stamp
      }),
    );
    expect(d.stages.filing).toEqual({ run: false, reason: "cooldown" });
  });

  it("egress notice blocks filing only", () => {
    const d = decideResumeStages(base({ egressNoticeAcked: false }));
    expect(d.stages.drain.run).toBe(true);
    expect(d.stages.filing).toEqual({ run: false, reason: "egress_notice" });
  });

  it("exports backlog threshold", () => {
    expect(BACKLOG_GATE_THRESHOLD).toBe(50);
  });
});

describe("pruneBudgetWindow", () => {
  it("forward clock jump does not empty the window", () => {
    const stamps = [1000, 2000, 3000];
    // jump far forward — newest is still 3000 after clamp of future entries only
    const pruned = pruneBudgetWindow(stamps, 3_000_000);
    expect(pruned.length).toBe(3);
  });

  it("clamps future stamps to now", () => {
    const now = 5000;
    const pruned = pruneBudgetWindow([1000, 9000], now);
    expect(pruned.every((t) => t <= now)).toBe(true);
  });
});

describe("formatLastCatchupLine", () => {
  it("formats relative time", () => {
    const now = 1_000_000;
    const line = formatLastCatchupLine(
      { at: now - 5 * 60_000, filed: 2, drained: 1 },
      now,
    );
    expect(line).toMatch(/5m ago/);
    expect(line).toMatch(/filed 2/);
  });
});
