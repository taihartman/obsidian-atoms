/**
 * Resume catch-up decision core (plan U3 / KTD4).
 * Pure — no Obsidian imports. DOM wiring stays in main.ts.
 */

/** Coalesce visibility+focus into one leading-edge pass. */
export const RESUME_COALESCE_MS = 750;
/** Minimum wall between resume-triggered passes. */
export const RESUME_MIN_INTERVAL_MS = 30_000;
/** Paid classify stage cooldown. */
export const FILING_COOLDOWN_MS = 10 * 60_000;
/** Rolling filing budget window. */
export const FILING_BUDGET_WINDOW_MS = 60 * 60_000;
/** Max captures counted in the rolling window. */
export const FILING_BUDGET_CAP = 15;
/** General stage liveness (drain / outbox / mirror). */
export const LIVENESS_MS = 10 * 60_000;
/** Filing stage liveness (classify can run long). */
export const FILING_LIVENESS_MS = 30 * 60_000;
/** Waived filing passes per rolling hour (new-work cooldown waivers). */
export const WAIVED_FILING_PASS_CAP = 4;
/** First-run backlog banner threshold (inbox-stranded captures). */
export const BACKLOG_GATE_THRESHOLD = 50;
/** Consecutive mirror refusals before one Notice. */
export const REFUSAL_STREAK_NOTICE = 3;

export const LS_RESUME_ENABLED = "atoms-resume-enabled-v1";
export const LS_FILING_BUDGET = "atoms-filing-budget-v1";
export const LS_EGRESS_NOTICE = "atoms-egress-notice-v1";
export const LS_LAST_CATCHUP = "atoms-last-catchup-v1";
export const LS_BACKLOG_GATE = "atoms-backlog-gate-v1";
export const LS_QUARANTINE = "atoms-quarantine-v1";

export type ResumeStage =
  | "drain"
  | "outbox"
  | "mirror"
  | "filing";

export type StageDecision =
  | { run: true; waivedCooldown?: boolean }
  | {
      run: false;
      reason:
        | "cooldown"
        | "min_interval"
        | "budget"
        | "in_flight"
        | "failure_backoff"
        | "kill_switch"
        | "vault_not_ready"
        | "egress_notice"
        | "manual_only";
    };

export type ResumeDecisionInput = {
  /** Monotonic-ish now (ms). */
  now: number;
  /** Kill switch: false blocks automated resume (not manual). */
  resumeEnabled: boolean;
  /** Caller is the manual "Sync everything now" path. */
  manual: boolean;
  vaultIndexReady: boolean;
  /** Device acknowledged widened egress notice. */
  egressNoticeAcked: boolean;
  lastResumePassAt: number | null;
  lastStageRunAt: Partial<Record<ResumeStage, number | null>>;
  lastStageFailAt: Partial<Record<ResumeStage, number | null>>;
  /** In-flight stage start times; null if idle. */
  inFlightStartedAt: Partial<Record<ResumeStage, number | null>>;
  /** Capture timestamps in the rolling filing budget (ms). */
  filingBudgetStamps: number[];
  /** Waived filing pass timestamps in the rolling hour. */
  waivedFilingStamps: number[];
  /** Drain produced work not seen by the previous filing pass. */
  hasNewDrainedWork: boolean;
  /** Waivers already granted for this resume signal. */
  waiverUsedThisSignal: boolean;
};

export type ResumeDecision = {
  stages: Record<ResumeStage, StageDecision>;
  /** Grant a filing-cooldown waiver for this pass (caller records stamp). */
  grantWaiver: boolean;
};

function clampStamps(stamps: number[], now: number): number[] {
  return stamps.map((t) => (t > now ? now : t));
}

function newestStamp(stamps: number[], now: number): number {
  if (!stamps.length) return now;
  return Math.max(...clampStamps(stamps, now));
}

/** Retire budget entries by forward progress from newest stamp (KTD4). */
export function pruneBudgetWindow(
  stamps: number[],
  now: number,
  windowMs: number = FILING_BUDGET_WINDOW_MS,
): number[] {
  const clamped = clampStamps(stamps, now);
  if (!clamped.length) return [];
  const newest = Math.max(...clamped);
  const start = newest - windowMs;
  return clamped.filter((t) => t >= start);
}

function cooldownRemaining(
  lastAt: number | null | undefined,
  now: number,
  cooldownMs: number,
): number {
  if (lastAt == null) return 0;
  const elapsed = now - lastAt;
  if (elapsed < 0) return cooldownMs; // clock went backwards → treat as no progress
  return Math.max(0, cooldownMs - elapsed);
}

function isDeadInFlight(
  startedAt: number | null | undefined,
  now: number,
  ceilingMs: number,
): boolean {
  if (startedAt == null) return false;
  const age = now - startedAt;
  if (age < 0) return false;
  return age > ceilingMs;
}

/**
 * Pure stage gate for resume / manual catch-up.
 */
export function decideResumeStages(input: ResumeDecisionInput): ResumeDecision {
  const stages = {} as Record<ResumeStage, StageDecision>;
  const all: ResumeStage[] = ["drain", "outbox", "mirror", "filing"];

  if (!input.vaultIndexReady) {
    for (const s of all) {
      stages[s] = { run: false, reason: "vault_not_ready" };
    }
    return { stages, grantWaiver: false };
  }

  if (!input.manual && !input.resumeEnabled) {
    for (const s of all) {
      stages[s] = { run: false, reason: "kill_switch" };
    }
    return { stages, grantWaiver: false };
  }

  if (
    !input.manual &&
    input.lastResumePassAt != null &&
    cooldownRemaining(input.lastResumePassAt, input.now, RESUME_MIN_INTERVAL_MS) >
      0
  ) {
    for (const s of all) {
      stages[s] = { run: false, reason: "min_interval" };
    }
    return { stages, grantWaiver: false };
  }

  // Cheap stages: drain, outbox, mirror — short cooldowns via min interval only
  for (const s of ["drain", "outbox", "mirror"] as const) {
    const started = input.inFlightStartedAt[s];
    if (started != null && !isDeadInFlight(started, input.now, LIVENESS_MS)) {
      stages[s] = { run: false, reason: "in_flight" };
      continue;
    }
    const failAt = input.lastStageFailAt[s];
    if (
      failAt != null &&
      cooldownRemaining(failAt, input.now, RESUME_MIN_INTERVAL_MS) > 0
    ) {
      stages[s] = { run: false, reason: "failure_backoff" };
      continue;
    }
    stages[s] = { run: true };
  }

  // Filing (paid)
  const fStarted = input.inFlightStartedAt.filing;
  if (
    fStarted != null &&
    !isDeadInFlight(fStarted, input.now, FILING_LIVENESS_MS)
  ) {
    stages.filing = { run: false, reason: "in_flight" };
    return { stages, grantWaiver: false };
  }

  if (!input.egressNoticeAcked) {
    stages.filing = { run: false, reason: "egress_notice" };
    return { stages, grantWaiver: false };
  }

  const budget = pruneBudgetWindow(input.filingBudgetStamps, input.now);
  if (budget.length >= FILING_BUDGET_CAP) {
    stages.filing = { run: false, reason: "budget" };
    return { stages, grantWaiver: false };
  }

  const failAt = input.lastStageFailAt.filing;
  if (
    failAt != null &&
    cooldownRemaining(failAt, input.now, FILING_COOLDOWN_MS) > 0
  ) {
    stages.filing = { run: false, reason: "failure_backoff" };
    return { stages, grantWaiver: false };
  }

  const lastFiling = input.lastStageRunAt.filing ?? null;
  const cooling =
    cooldownRemaining(lastFiling, input.now, FILING_COOLDOWN_MS) > 0;

  let grantWaiver = false;
  if (cooling) {
    const waived = pruneBudgetWindow(
      input.waivedFilingStamps,
      input.now,
      FILING_BUDGET_WINDOW_MS,
    );
    const canWaiver =
      input.hasNewDrainedWork &&
      !input.waiverUsedThisSignal &&
      waived.length < WAIVED_FILING_PASS_CAP;
    if (canWaiver) {
      grantWaiver = true;
      stages.filing = { run: true, waivedCooldown: true };
    } else {
      stages.filing = { run: false, reason: "cooldown" };
    }
  } else {
    stages.filing = { run: true };
  }

  return { stages, grantWaiver };
}

export function readResumeEnabled(load: (key: string) => unknown): boolean {
  const v = load(LS_RESUME_ENABLED);
  // Default on when unset
  if (v === false || v === "false") return false;
  return true;
}

export function writeResumeEnabled(
  save: (key: string, data: unknown) => void,
  enabled: boolean,
): void {
  save(LS_RESUME_ENABLED, enabled);
}

export function readEgressNoticeAcked(load: (key: string) => unknown): boolean {
  return load(LS_EGRESS_NOTICE) === true;
}

export function writeEgressNoticeAcked(
  save: (key: string, data: unknown) => void,
): void {
  save(LS_EGRESS_NOTICE, true);
}

export type LastCatchupRecord = {
  at: number;
  drained?: number;
  filed?: number;
  mirrored?: number;
  outbox?: number;
};

export function readLastCatchup(
  load: (key: string) => unknown,
): LastCatchupRecord | null {
  const raw = load(LS_LAST_CATCHUP);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "number") return null;
  return {
    at: o.at,
    ...(typeof o.drained === "number" ? { drained: o.drained } : {}),
    ...(typeof o.filed === "number" ? { filed: o.filed } : {}),
    ...(typeof o.mirrored === "number" ? { mirrored: o.mirrored } : {}),
    ...(typeof o.outbox === "number" ? { outbox: o.outbox } : {}),
  };
}

export function writeLastCatchup(
  save: (key: string, data: unknown) => void,
  rec: LastCatchupRecord,
): void {
  save(LS_LAST_CATCHUP, rec);
}

export function readFilingBudgetStamps(
  load: (key: string) => unknown,
  now: number,
): number[] {
  const raw = load(LS_FILING_BUDGET);
  if (!Array.isArray(raw)) return [];
  const stamps = raw.filter((t): t is number => typeof t === "number");
  return pruneBudgetWindow(stamps, now);
}

export function appendFilingBudgetStamps(
  load: (key: string) => unknown,
  save: (key: string, data: unknown) => void,
  now: number,
  count: number,
): void {
  if (count <= 0) return;
  const prev = readFilingBudgetStamps(load, now);
  const next = pruneBudgetWindow(
    [...prev, ...Array.from({ length: count }, () => now)],
    now,
  );
  save(LS_FILING_BUDGET, next);
}

/** Format passive "last caught up" line for home / settings. */
export function formatLastCatchupLine(
  rec: LastCatchupRecord | null,
  now: number = Date.now(),
): string | null {
  if (!rec) return null;
  const mins = Math.max(0, Math.round((now - rec.at) / 60_000));
  const when =
    mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  const parts: string[] = [];
  if (rec.filed) parts.push(`filed ${rec.filed}`);
  if (rec.drained) parts.push(`drained ${rec.drained}`);
  if (rec.outbox) parts.push(`outbox ${rec.outbox}`);
  if (rec.mirrored) parts.push(`mirrored ${rec.mirrored}`);
  const detail = parts.length ? parts.join(" · ") : "caught up";
  return `Last catch-up ${when}: ${detail}`;
}
