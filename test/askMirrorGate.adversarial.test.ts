/**
 * Adversarial regression suite for the mirror deletion gate (#225).
 *
 * Written as a break-it probe during the adversarial QA pass, kept because
 * three of its scenarios were red against the shipped gate — all three were
 * H1, the stored server count authorising a reconcile it had no standing to
 * authorise. Mirrors test/askMirror.test.ts's fake host so every scenario runs
 * against the real `runAskMirrorSync`, not a re-implementation of it.
 */
import { describe, expect, it } from "vitest";
import type { ConfirmRequest, ConfirmVerdict } from "../src/shared/confirm";
import type {
  AskMirrorHost,
  AskMirrorSyncResult,
} from "../src/platform/askMirror";
import {
  ASK_MIRROR_REFUSAL_ESCALATION_NOTICE,
  LS_ASK_MIRROR_HASHES,
  LS_ASK_MIRROR_REFUSAL,
  LS_ASK_MIRROR_SCAN_HIGHWATER,
  LS_ASK_MIRROR_SERVER_COUNT,
  mirrorCompletenessFloor,
  runAskMirrorSync,
} from "../src/platform/askMirror";

/**
 * Narrow a sync result to its `ok` arm before asserting on counts.
 *
 * `uploaded` and `refusalReason` live only on `ok`; a `failed` result carries a
 * message instead. Reaching for them on the bare union used to be invisible
 * because `tsconfig.json` excluded `test/` — see tsconfig.test.json. Throwing
 * here also turns "the run failed for an unrelated reason" into a legible test
 * failure rather than an `undefined` compared against an expected value.
 */
function okResult(
  r: AskMirrorSyncResult,
): Extract<AskMirrorSyncResult, { kind: "ok" }> {
  if (r.kind !== "ok") {
    throw new Error(`expected an ok sync result, got: ${JSON.stringify(r)}`);
  }
  return r;
}


const NOW = Date.parse("2026-08-01T12:00:00Z");
const atomPath = (i: number) => `Atoms/A${i}.md`;

type Opts = {
  evidence: number;
  scanned: number;
  serverCount?: number | null;
  statusCount?: number;
  statusFails?: boolean;
  verdict?: ConfirmVerdict;
  /** Modal that never resolves — the backgrounded-on-mobile case. */
  confirmNeverAnswers?: boolean;
  confirmTimeoutMs?: number;
  highWaterRaw?: string;
  hashesRaw?: string;
  now?: number;
};

function makeFakeHost(opts: Opts) {
  const store: Record<string, string> = {};
  const evidence: Record<string, string> = {};
  for (let i = 0; i < opts.evidence; i++) evidence[atomPath(i)] = `h${i}`;
  store[LS_ASK_MIRROR_HASHES] =
    opts.hashesRaw ?? JSON.stringify(evidence);
  if (opts.serverCount !== null && opts.serverCount !== undefined) {
    store[LS_ASK_MIRROR_SERVER_COUNT] = String(opts.serverCount);
  }
  if (opts.highWaterRaw !== undefined) {
    store[LS_ASK_MIRROR_SCAN_HIGHWATER] = opts.highWaterRaw;
  }
  let scanned = opts.scanned;
  // Explicit path list, for scenarios where *which* paths the scan found
  // matters and not just how many. Default stays the first `scanned` evidence
  // paths, so every existing scenario is unaffected.
  let scannedPaths: string[] | null = null;
  const deleted: string[] = [];
  const reconciles: { keepPaths: string[]; confirmEmpty: boolean; sid?: string }[] =
    [];
  const confirmRequests: ConfirmRequest[] = [];
  const notices: string[] = [];
  let statusCalls = 0;
  let cancelled = 0;

  const host: AskMirrorHost = {
    async scanAtoms() {
      const paths =
        scannedPaths ??
        Array.from({ length: scanned }, (_, i) => atomPath(i));
      return paths.map((path, i) => ({
        path,
        basename: path.replace(/^Atoms\//, "").replace(/\.md$/, ""),
        content: `---\ntags: []\n---\nbody ${i}\n`,
      }));
    },
    async resolveHubs() {
      return [];
    },
    load: (k) => store[k],
    save: (k, v) => {
      store[k] = v;
    },
    async upsert(atoms) {
      return { ok: true, upserted: atoms.length };
    },
    async deletePaths(paths) {
      deleted.push(...paths);
      return { ok: true };
    },
    async reconcile(o) {
      reconciles.push({
        keepPaths: o.keepPaths,
        confirmEmpty: o.confirmEmpty,
        ...(o.reconcileSessionId ? { sid: o.reconcileSessionId } : {}),
      });
      return { ok: true };
    },
    async status() {
      statusCalls++;
      if (opts.statusFails) return { ok: false, message: "offline" };
      return { ok: true, count: opts.statusCount ?? opts.serverCount ?? 0 };
    },
    async confirm(request) {
      confirmRequests.push(request);
      if (opts.confirmNeverAnswers) return new Promise<ConfirmVerdict>(() => {});
      return opts.verdict ?? "dismissed";
    },
    cancelConfirm: () => {
      cancelled++;
    },
    notice: (m) => notices.push(m),
    now: () => opts.now ?? NOW,
    ...(opts.confirmTimeoutMs !== undefined
      ? { confirmTimeoutMs: opts.confirmTimeoutMs }
      : {}),
  };
  return {
    host,
    store,
    deleted,
    reconciles,
    confirmRequests,
    notices,
    statusCalls: () => statusCalls,
    cancelledConfirms: () => cancelled,
    setScanned: (n: number) => {
      scanned = n;
    },
    setScannedPaths: (paths: string[]) => {
      scannedPaths = paths;
    },
  };
}

// ---------------------------------------------------------------------------
// H1 — the tripwire is never consulted against a FRESH server count when the
// STALE stored count already clears the evidence floor.
// ---------------------------------------------------------------------------
describe("H1 stale server count defeats the reconcile tripwire", () => {
  it("a forced reconcile wipes 400 rows another device pushed since", async () => {
    // Device A: 84 atoms, fully scanned, and its stored server count is what
    // *it* last saw (84). Device B has since pushed 400 more atoms, so the
    // cloud really holds 484.
    const f = makeFakeHost({
      evidence: 84,
      scanned: 84,
      serverCount: 84, // stale, present, and parseable
      statusCount: 484, // what the cloud actually holds right now
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });

    // ceil(484 × 0.8) = 388, and this device scanned 84. The tripwire should
    // refuse and route to the modal.
    expect(r.refused).toBe(true);
    expect(okResult(r).refusalReason).toBe("server-count-tripwire");
    expect(f.reconciles).toEqual([]);
  });

  it("blast radius: 84 keepPaths committed against a 484-row cloud", async () => {
    const f = makeFakeHost({
      evidence: 84,
      scanned: 84,
      serverCount: 84,
      statusCount: 484,
      verdict: "dismissed",
    });
    await runAskMirrorSync(f.host, { force: true });
    // The only status() call is the success-tail refresh, which happens AFTER
    // the irreversible reconcile has already gone out.
    expect({
      keepPaths: f.reconciles.map((r) => r.keepPaths.length),
      asked: f.confirmRequests.length,
    }).toEqual({ keepPaths: [], asked: 1 });
  });
});

// ---------------------------------------------------------------------------
// Class A — corrupt / degenerate gate inputs
// ---------------------------------------------------------------------------
describe("A: corrupt gate inputs", () => {
  const badHighWater = ["0", "-5", "abc", '"7"', "null", "[]", "{}", '{"count":-1}'];
  for (const raw of badHighWater) {
    it(`high-water ${JSON.stringify(raw)} fails closed`, async () => {
      const f = makeFakeHost({
        evidence: 400,
        scanned: 350,
        serverCount: 400,
        highWaterRaw: raw,
      });
      const r = await runAskMirrorSync(f.host, { force: false });
      expect({ raw, refused: r.refused, deleted: f.deleted.length }).toEqual({
        raw,
        refused: true,
        deleted: 0,
      });
    });
  }

  it("high-water empty string reads as ABSENT (evidence baseline), not corrupt", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 350,
      serverCount: 400,
      highWaterRaw: "",
    });
    const r = await runAskMirrorSync(f.host, { force: false });
    // 350 >= floor(400) = 320 -> allowed. Documented behaviour, not a bug.
    expect(r.refused).toBe(false);
    expect(f.deleted.length).toBe(50);
  });

  it("an absurdly large high-water only bites when there is a delete to plan", async () => {
    // Nothing to delete => the gate is never consulted, so the inflated mark
    // is inert. It refuses the moment a delete appears. Documented, not a bug.
    const inert = makeFakeHost({
      evidence: 84,
      scanned: 84,
      serverCount: 84,
      highWaterRaw: JSON.stringify({
        count: 5000,
        setAt: new Date(NOW).toISOString(),
      }),
    });
    expect((await runAskMirrorSync(inert.host, { force: false })).refused).toBe(
      false,
    );
    const biting = makeFakeHost({
      evidence: 84,
      scanned: 80,
      serverCount: 84,
      highWaterRaw: JSON.stringify({
        count: 5000,
        setAt: new Date(NOW).toISOString(),
      }),
    });
    const r = await runAskMirrorSync(biting.host, { force: false });
    expect(r.refused).toBe(true);
    expect(okResult(r).refusalReason).toBe("scan-incomplete");
  });

  // "1e3" is deliberately excluded: Number("1e3") === 1000 is a real integer,
  // so it is accepted. Only cosmetic — formatAskMirrorServerCount renders the
  // raw string "1e3" to the user.
  const badServer = ["0", "-1", "abc", "", "  ", "3.5"];
  for (const raw of badServer) {
    it(`stored server count ${JSON.stringify(raw)} refuses on delta`, async () => {
      const f = makeFakeHost({ evidence: 400, scanned: 350 });
      f.store[LS_ASK_MIRROR_SERVER_COUNT] = raw;
      const r = await runAskMirrorSync(f.host, { force: false });
      expect({ raw, refused: r.refused, deleted: f.deleted.length }).toEqual({
        raw,
        refused: true,
        deleted: 0,
      });
    });
  }

  it("corrupt evidence map on a DELTA pass plans zero deletes", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 350,
      serverCount: 400,
      hashesRaw: "{not json",
    });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(f.deleted.length).toBe(0);
    expect(r.refused).toBe(false);
  });

  it("corrupt evidence map + absent high-water zeroes the completeness floor", async () => {
    // Only the server tripwire is left standing, and it runs on the STALE
    // stored count (see H1).
    expect(mirrorCompletenessFloor(0, 0)).toBe(0);
    const f = makeFakeHost({
      evidence: 400,
      scanned: 10,
      serverCount: 12, // stale-low: this device once saw a nearly-empty cloud
      statusCount: 400, // the cloud actually holds 400
      hashesRaw: "{not json",
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(r.refused).toBe(true);
    expect(f.reconciles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Class B — boundaries around max(5, …)
// ---------------------------------------------------------------------------
describe("B: floor boundaries", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 5],
    [7, 6],
    [10, 8],
    [5000, 4000],
  ])("baseline %i -> floor %i", (baseline, floor) => {
    expect(mirrorCompletenessFloor(baseline, baseline)).toBe(floor);
  });

  it("a 1-atom vault is not wedged", async () => {
    const f = makeFakeHost({ evidence: 1, scanned: 1, serverCount: 1 });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(r.refused).toBe(false);
    expect(f.confirmRequests).toEqual([]);
  });

  it("a 0-atom vault cannot force away a non-empty cloud", async () => {
    const f = makeFakeHost({
      evidence: 0,
      scanned: 0,
      serverCount: 1,
      statusCount: 1,
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect({
      refused: r.refused,
      reason: okResult(r).refusalReason,
      reconciles: f.reconciles.length,
      asked: f.confirmRequests.length,
    }).toEqual({
      refused: true,
      reason: "server-count-tripwire",
      reconciles: 0,
      asked: 1,
    });
  });

  it("one below the floor refuses; exactly at the floor passes", async () => {
    const at = makeFakeHost({ evidence: 10, scanned: 8, serverCount: 10 });
    const below = makeFakeHost({ evidence: 10, scanned: 7, serverCount: 10 });
    const ra = await runAskMirrorSync(at.host, { force: false });
    const rb = await runAskMirrorSync(below.host, { force: false });
    expect([ra.refused, rb.refused]).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// Class C — sequences
// ---------------------------------------------------------------------------
describe("C: sequences", () => {
  it("escalation notice fires once at pass 3 and never again", async () => {
    const f = makeFakeHost({ evidence: 400, scanned: 3, serverCount: 400 });
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await runAskMirrorSync(f.host, { force: false });
      seen.push(f.notices.length);
    }
    expect(seen).toEqual([0, 0, 1, 1, 1, 1]);
    expect(f.notices[0]).toBe(ASK_MIRROR_REFUSAL_ESCALATION_NOTICE);
  });

  it("a confirmed prune then an immediate delta issues no spurious delete", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 350,
      serverCount: null,
      statusCount: 400,
      verdict: "confirmed",
    });
    const forced = await runAskMirrorSync(f.host, { force: true });
    expect(forced.refused).toBe(false);
    const before = f.deleted.length;
    const delta = await runAskMirrorSync(f.host, { force: false });
    expect({ refused: delta.refused, newDeletes: f.deleted.length - before }).toEqual({
      refused: false,
      newDeletes: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Class D — network
// ---------------------------------------------------------------------------
describe("D: network", () => {
  it("unreachable status() on a forced pass fails closed and never asks", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      statusFails: true,
      verdict: "confirmed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect({
      refused: r.refused,
      reason: okResult(r).refusalReason,
      asked: f.confirmRequests.length,
      reconciles: f.reconciles.length,
    }).toEqual({
      refused: true,
      reason: "no-server-count",
      asked: 0,
      reconciles: 0,
    });
  });

  it("unreachable status() fails closed even when the stored count would allow (H1)", async () => {
    // H1. A complete scan against a stale-but-parseable stored count is
    // locally indistinguishable from the catastrophe: the phone holding 3 of
    // 400 atoms also scans 100% of its own evidence, and its stored count also
    // matches that scan. No local signal separates the two — only this
    // moment's server count does. So an unreachable status() on the reconcile
    // path refuses, rather than letting a stored number authorise a delete.
    const f = makeFakeHost({
      evidence: 84,
      scanned: 84,
      serverCount: 84,
      statusFails: true,
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect({
      refused: r.refused,
      reason: okResult(r).refusalReason,
      reconciles: f.reconciles.length,
    }).toEqual({
      refused: true,
      reason: "no-server-count",
      reconciles: 0,
    });
  });

  it("bodyless-2xx-as-failure on a forced pass fails closed", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: null,
      statusFails: true,
      verdict: "confirmed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(okResult(r).refusalReason).toBe("no-server-count");
    expect(f.reconciles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F1 — reconcile session id collision
// ---------------------------------------------------------------------------
describe("F: reconcile session id", () => {
  it("two same-millisecond chunked reconciles get different session ids", async () => {
    const mk = () =>
      makeFakeHost({
        evidence: 600,
        scanned: 600,
        serverCount: 600,
        now: NOW,
      });
    const a = mk();
    const b = mk();
    await runAskMirrorSync(a.host, { force: true });
    await runAskMirrorSync(b.host, { force: true });
    const sidA = a.reconciles[0]!.sid!;
    const sidB = b.reconciles[0]!.sid!;
    expect(sidA).toMatch(/^rec-\d+-[a-z0-9]{6,8}$/);
    expect(sidA).not.toBe(sidB);
  });
});

// ---------------------------------------------------------------------------
// The completeness floor's numerator must be evidence, not vault cardinality.
// Found post-merge: `scannedCount` was bound to `vaultPaths.size` while `floor`
// derived from evidence, so the two counted different sets and a newly created
// atom paid for a missing one.
// ---------------------------------------------------------------------------
describe("G: new atoms cannot pay for missing ones", () => {
  it("a mixed set at full cardinality still refuses (evidence 400, 230 survive + 100 new)", async () => {
    // The device holds 400 evidence paths. Its vault currently shows 230 of
    // them plus 100 atoms created since — 330 files, against a floor of 320.
    // By cardinality alone that clears. By evidence it does not: 170 of this
    // device's own paths are missing, and deleting them is the exact
    // partially-synced wipe the gate exists to stop.
    const f = makeFakeHost({ evidence: 400, scanned: 230, serverCount: 400 });
    f.setScannedPaths([
      ...Array.from({ length: 230 }, (_, i) => atomPath(i)),
      ...Array.from({ length: 100 }, (_, i) => `Atoms/New${i}.md`),
    ]);
    const r = await runAskMirrorSync(f.host, { force: false });

    expect({
      refused: r.refused,
      reason: okResult(r).refusalReason,
      deleted: f.deleted.length,
    }).toEqual({
      refused: true,
      reason: "scan-incomplete",
      deleted: 0,
    });
  });

  it("the same vault without the new atoms refuses identically", async () => {
    // Control: the refusal is about the 170 missing paths, not about the 100
    // new ones. Cardinality 230 is plainly below the floor either way.
    const f = makeFakeHost({ evidence: 400, scanned: 230, serverCount: 400 });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect({ refused: r.refused, deleted: f.deleted.length }).toEqual({
      refused: true,
      deleted: 0,
    });
  });

  it("a genuinely complete vault that also grew still passes", async () => {
    // The guard must not wedge the ordinary case: every evidence path is
    // present, and 100 new atoms sit on top. Nothing to delete, nothing to
    // refuse.
    const f = makeFakeHost({ evidence: 400, scanned: 400, serverCount: 400 });
    f.setScannedPaths([
      ...Array.from({ length: 400 }, (_, i) => atomPath(i)),
      ...Array.from({ length: 100 }, (_, i) => `Atoms/New${i}.md`),
    ]);
    const r = await runAskMirrorSync(f.host, { force: false });
    expect({ refused: r.refused, deleted: f.deleted.length }).toEqual({
      refused: false,
      deleted: 0,
    });
  });

  it("a confirmed prune clears the refusal banner it had to raise", async () => {
    // Being below the floor is *why* the prune had to ask, so the banner is
    // still up when the pass reaches its success tail. Without the
    // confirmation arm the status line reads "sync refused" while the toast
    // for the same click reads "reconciled".
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 3,
      verdict: "confirmed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(r.refused).toBe(false);
    expect(JSON.parse(f.store[LS_ASK_MIRROR_REFUSAL] ?? "{}")).toEqual({
      count: 0,
      noticed: false,
    });
  });
});

// ---------------------------------------------------------------------------
// The dialog's lifetime. Losing the race is not the same as the question going
// away: an abandoned modal still shows a live "Delete from cloud" button, and
// tapping it resolves an already-settled promise — the user authorises an
// irreversible delete and nothing happens.
// ---------------------------------------------------------------------------
describe("H: confirm dialog lifecycle", () => {
  it("withdraws the dialog when the confirm times out", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      confirmNeverAnswers: true,
      confirmTimeoutMs: 5,
    });
    const r = await runAskMirrorSync(f.host, { force: true });

    expect({
      asked: f.confirmRequests.length,
      cancelled: f.cancelledConfirms(),
      refused: r.refused,
      reconciles: f.reconciles.length,
    }).toEqual({ asked: 1, cancelled: 1, refused: true, reconciles: 0 });
  });

  it("leaves an answered dialog alone", async () => {
    // The host closes it itself on a real verdict; cancelling again would be a
    // second close on a modal that is already gone.
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      verdict: "declined",
    });
    await runAskMirrorSync(f.host, { force: true });
    expect(f.cancelledConfirms()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A refusal has to name the threshold that actually refused. The hand-built
// no-server-count branch reported itself even when the real reason was a
// corrupt baseline, which decideMirrorDeletion checks first.
// ---------------------------------------------------------------------------
describe("I: the refusal names its true reason", () => {
  it("an unreachable status() on a corrupt baseline says baseline-unreadable", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 400,
      serverCount: 400,
      statusFails: true,
      highWaterRaw: "abc",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect({ refused: r.refused, reason: okResult(r).refusalReason }).toEqual({
      refused: true,
      reason: "baseline-unreadable",
    });
  });

  it("an unreachable status() on a readable baseline still says no-server-count", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 400,
      serverCount: 400,
      statusFails: true,
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect({ refused: r.refused, reason: okResult(r).refusalReason }).toEqual({
      refused: true,
      reason: "no-server-count",
    });
  });
});
