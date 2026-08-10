import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The classify transport, swapped for the whole file (U6).
 *
 * `maybeAutoRun` builds its own `classifyDeps` and deliberately exposes no `request` seam — the
 * point of the catch-up tests below is to drive the *real* filing path, so the double has to sit
 * where production puts it. The stock `obsidian` mock's `requestUrl` throws, so overriding it
 * cannot change any other test in this file.
 */
const classifyTransport = vi.hoisted(() => ({
  handler: null as null | ((opts: unknown) => Promise<unknown>),
}));
vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestUrl: (opts: unknown) =>
    classifyTransport.handler
      ? classifyTransport.handler(opts)
      : Promise.reject(new Error("no classify stub installed")),
}));

import AtomsPlugin from "../src/plugin/main";
import {
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_START_DAY,
  EGRESS_ACK_VERSION,
  localDateString,
} from "../src/platform/autorun";
import {
  atomResult,
  contextProviderFor,
  fakeClassify,
  fakeVault,
  stubDailyNotes,
} from "./helpers/pipelineVault";
import {
  applyOutboxItemToVault,
  runAskOutboxApply,
  runMirrorSingleFlight,
  type AskOutboxHost,
  type AskOutboxItem,
  type MirrorSingleFlightHost,
  type MirrorSingleFlightState,
  type OutboxApplyResult,
} from "../src/plugin/catchUp";
import {
  describeMirrorRefusal,
  syncNowNotice,
  type MirrorSyncOutcome,
} from "../src/shared/mirrorOutcome";
import type { MirrorDeletionRefusal } from "../src/shared/confirm";

type AckRecord = { id: string; status: string; error?: string };

/**
 * A fake Plus + vault. The point of the model is the gap the ack rule guards:
 * `applyToVault` puts an atom in the *vault*, and only a mirror push that
 * actually ran puts it in the *cloud*. A `joined` push moves nothing.
 */
function fakeHost(opts: {
  items: AskOutboxItem[];
  /** Outcome for the Nth mirror push (1-based); defaults to a real push. */
  mirror?: (call: number) => MirrorSyncOutcome;
  apply?: (item: AskOutboxItem) => OutboxApplyResult;
  busy?: boolean;
  /** Live consent, re-asked per item — a case withdraws mid-pass by returning false. */
  writePermitted?: () => boolean;
}) {
  /** Un-acked items, in server order. A pull peeks; an ack retires. */
  const pending = [...opts.items];
  const acks: AckRecord[] = [];
  const vault: string[] = [];
  const cloud: string[] = [];
  /** What the vault held at each push *attempt*, whatever the push then did. */
  const pushes: string[][] = [];
  const notices: string[] = [];
  let mirrorCalls = 0;
  let busy = opts.busy ?? false;
  let passes = 0;

  const host: AskOutboxHost = {
    beginPass: () => {
      if (busy) return false;
      busy = true;
      passes++;
      return true;
    },
    endPass: () => {
      busy = false;
    },
    pullOne: async () => pending[0] ?? null,
    ack: async (id, ack) => {
      acks.push({
        id,
        status: ack.status,
        ...(ack.error ? { error: ack.error } : {}),
      });
      const i = pending.findIndex((it) => it.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    // Consent, asked live before every item. Default granted so the existing cases read as
    // before; `opts.writePermitted` is how a case withdraws mid-pass.
    writePermitted: () => opts.writePermitted?.() ?? true,
    applyToVault: async (payload) => {
      const result = opts.apply?.({ id: "", payload }) ?? {
        kind: "applied" as const,
      };
      if (result.kind === "applied") vault.push(payload.title);
      return result;
    },
    syncMirror: async () => {
      mirrorCalls++;
      pushes.push([...vault]);
      const outcome = opts.mirror?.(mirrorCalls) ?? {
        kind: "worked" as const,
        uploaded: 1,
        deleted: 0,
      };
      // Only a push that ran reaches the cloud. `joined` was absorbed into an
      // in-flight pass that has already built its own payload; `refused` and
      // `failed` never converged.
      if (outcome.kind === "worked") {
        for (const title of vault) if (!cloud.includes(title)) cloud.push(title);
      }
      return outcome;
    },
    notice: (m) => notices.push(m),
    onLanded: () => {},
  };

  return {
    host,
    acks,
    cloud,
    vault,
    pushes,
    notices,
    pendingIds: () => pending.map((i) => i.id),
    passes: () => passes,
  };
}

const item = (id: string, title: string): AskOutboxItem => ({
  id,
  payload: { title, body: `body of ${title}` },
});

describe("runAskOutboxApply", () => {
  it("acks nothing when the mirror push was deferred to an in-flight pass", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea"), item("o2", "Coffee")],
      mirror: () => ({ kind: "joined" }),
    });

    const outcome = await runAskOutboxApply(f.host);

    // One push was attempted, carrying the first atom — and it moved nothing,
    // so nothing may be acked and the loop must not reach the second item.
    expect(f.pushes).toEqual([["Tea"]]);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1", "o2"]);
    // Not "worked, 0 landed" — the work is still owed.
    expect(outcome).toEqual({ kind: "joined", landed: 0, rejected: 0 });
  });

  it("acks nothing when the mirror hard-fails mid-loop", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea"), item("o2", "Coffee")],
      mirror: () => ({ kind: "failed", message: "network" }),
    });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.pushes).toEqual([["Tea"]]);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1", "o2"]);
    expect(outcome).toEqual({
      kind: "failed",
      landed: 0,
      rejected: 0,
      message: "network",
    });
  });

  it("acks nothing when the mirror refused to converge", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea")],
      mirror: () => ({
        kind: "refused",
        uploaded: 0,
        reason: "scan-incomplete",
      }),
    });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.pushes).toEqual([["Tea"]]);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1"]);
    expect(outcome).toEqual({
      kind: "refused",
      landed: 0,
      rejected: 0,
      reason: "scan-incomplete",
    });
  });

  it("acks each entry exactly once when the push is confirmed", async () => {
    const f = fakeHost({ items: [item("o1", "Tea"), item("o2", "Coffee")] });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.cloud).toEqual(["Tea", "Coffee"]);
    expect(f.acks).toEqual([
      { id: "o1", status: "applied" },
      { id: "o2", status: "applied" },
    ]);
    expect(f.pendingIds()).toEqual([]);
    expect(outcome).toEqual({ kind: "worked", landed: 2, rejected: 0 });
    expect(f.notices).toEqual(["Ask: landed 2 atom(s)"]);
  });

  it("acks the item whose push landed and leaves the deferred one pending", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea"), item("o2", "Coffee")],
      // Item 1's push runs; item 2's is absorbed by an in-flight pass — the
      // exact shape the production bug produced.
      mirror: (n) =>
        n === 1
          ? { kind: "worked", uploaded: 1, deleted: 0 }
          : { kind: "joined" },
    });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.pushes).toEqual([["Tea"], ["Tea", "Coffee"]]);
    // Half one: a confirmed ack stands — the fix must not over-correct and
    // re-open an entry the cloud already took.
    expect(f.acks).toEqual([{ id: "o1", status: "applied" }]);
    expect(f.cloud).toEqual(["Tea"]);
    // Half two: the deferred entry is still owed, and the pass stopped there.
    expect(f.pendingIds()).toEqual(["o2"]);
    expect(outcome).toEqual({ kind: "joined", landed: 1, rejected: 0 });
    expect(f.notices).toEqual(["Ask: landed 1 atom(s)"]);
  });

  it("re-running after a deferred push acks the entries that then land", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea")],
      // First pass deferred; the retry pass gets a real push.
      mirror: (n) =>
        n === 1
          ? { kind: "joined" }
          : { kind: "worked", uploaded: 1, deleted: 0 },
    });

    await runAskOutboxApply(f.host);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1"]);

    const second = await runAskOutboxApply(f.host);

    expect(f.cloud).toEqual(["Tea"]);
    expect(f.acks).toEqual([{ id: "o1", status: "applied" }]);
    expect(second).toEqual({ kind: "worked", landed: 1, rejected: 0 });
  });

  it("tells a busy caller it joined, not that it did zero work", async () => {
    const busy = fakeHost({ items: [item("o1", "Tea")], busy: true });
    expect(await runAskOutboxApply(busy.host)).toEqual({
      kind: "joined",
      landed: 0,
      rejected: 0,
    });
    expect(busy.passes()).toBe(0);
    expect(busy.acks).toEqual([]);

    const idle = fakeHost({ items: [] });
    expect(await runAskOutboxApply(idle.host)).toEqual({
      kind: "worked",
      landed: 0,
      rejected: 0,
    });
  });

  it("rejects an unusable payload without touching the mirror", async () => {
    const f = fakeHost({ items: [{ id: "o1", payload: { body: "orphan" } }] });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.acks).toEqual([
      { id: "o1", status: "rejected", error: "invalid_payload" },
    ]);
    // "without touching the mirror": no push was even attempted.
    expect(f.pushes).toEqual([]);
    expect(outcome).toEqual({ kind: "worked", landed: 0, rejected: 1 });
  });

  it("acks a vault-level rejection with its own reason", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea")],
      apply: () => ({ kind: "rejected", error: "path_exists" }),
    });

    await runAskOutboxApply(f.host);

    expect(f.acks).toEqual([
      { id: "o1", status: "rejected", error: "path_exists" },
    ]);
  });

  it("releases the single-flight lock so the next pass can run", async () => {
    const f = fakeHost({ items: [item("o1", "Tea")] });
    await runAskOutboxApply(f.host);
    await runAskOutboxApply(f.host);
    expect(f.passes()).toBe(2);
  });

  it("releases the single-flight lock when a push throws mid-loop", async () => {
    const f = fakeHost({ items: [item("o1", "Tea")] });
    f.host.syncMirror = async () => {
      throw new Error("boom");
    };

    await expect(runAskOutboxApply(f.host)).rejects.toThrow("boom");
    expect(f.acks).toEqual([]);

    // A thrown push must not park the outbox forever: the lock is released, so
    // a later pass still does the work.
    f.host.syncMirror = async () => ({
      kind: "worked",
      uploaded: 1,
      deleted: 0,
    });
    expect(await runAskOutboxApply(f.host)).toEqual({
      kind: "worked",
      landed: 1,
      rejected: 0,
    });
    expect(f.passes()).toBe(2);
  });

  it("retries a deferred item through the real vault write, idempotently", async () => {
    const files: Record<string, string> = {};
    const port = {
      readIfExists: async (p: string) => files[p] ?? null,
      ensureFolder: async () => {},
      create: async (p: string, content: string) => {
        if (p in files) throw new Error("exists");
        files[p] = content;
      },
    };
    const f = fakeHost({
      items: [item("o1", "Tea")],
      mirror: (n) =>
        n === 1
          ? { kind: "joined" }
          : { kind: "worked", uploaded: 1, deleted: 0 },
    });
    f.host.applyToVault = (payload) =>
      applyOutboxItemToVault(port, "Atoms", payload);

    await runAskOutboxApply(f.host);
    const afterFirst = files["Atoms/Tea.md"];
    expect(afterFirst).toBeDefined();
    expect(f.acks).toEqual([]);

    // The retry meets the file the first pass already created. That is the
    // idempotent path, not a spurious "path_exists" rejection, and the body
    // written the first time is left alone.
    expect(await runAskOutboxApply(f.host)).toEqual({
      kind: "worked",
      landed: 1,
      rejected: 0,
    });
    expect(f.acks).toEqual([{ id: "o1", status: "applied" }]);
    expect(files["Atoms/Tea.md"]).toBe(afterFirst);
  });
});

describe("applyOutboxItemToVault", () => {
  function fakeVault(files: Record<string, string> = {}) {
    const folders: string[] = [];
    return {
      files,
      folders,
      port: {
        readIfExists: async (p: string) => files[p] ?? null,
        ensureFolder: async (p: string) => {
          folders.push(p);
        },
        create: async (p: string, content: string) => {
          if (p in files) throw new Error("exists");
          files[p] = content;
        },
      },
    };
  }

  const payload = { title: "Tea", body: "I prefer tea." };

  it("creates the atom flat in the configured folder", async () => {
    const v = fakeVault();
    expect(await applyOutboxItemToVault(v.port, "Atoms", payload)).toEqual({
      kind: "applied",
    });
    expect(Object.keys(v.files)).toEqual(["Atoms/Tea.md"]);
    expect(v.folders).toEqual(["Atoms"]);
  });

  it("rejects rather than rewriting a body already at that path", async () => {
    const v = fakeVault({ "Atoms/Tea.md": "someone else's words" });
    expect(await applyOutboxItemToVault(v.port, "Atoms", payload)).toEqual({
      kind: "rejected",
      error: "path_exists",
    });
    expect(v.files["Atoms/Tea.md"]).toBe("someone else's words");
  });

  it("rejects when the create failed and nothing is there to re-plan against", async () => {
    const v = fakeVault();
    v.port.create = async () => {
      throw new Error("EACCES");
    };
    expect(await applyOutboxItemToVault(v.port, "Atoms", payload)).toEqual({
      kind: "rejected",
      error: "create_failed",
    });
  });
});

describe("syncNowNotice", () => {
  it("reports reconciled, uploaded, joined and refused as four distinct lines", () => {
    const lines = [
      syncNowNotice({ kind: "worked", uploaded: 0, deleted: 0 }),
      syncNowNotice({ kind: "worked", uploaded: 3, deleted: 0 }),
      syncNowNotice({ kind: "joined" }),
      syncNowNotice({ kind: "refused", uploaded: 0, reason: "scan-incomplete" }),
    ];
    expect(lines[0]).toBe("Ask mirror reconciled");
    expect(lines[1]).toBe("Ask mirror: uploaded 3 atom(s)");
    expect(new Set(lines).size).toBe(4);
  });

  it("never reads as success when the sync was refused", () => {
    for (const reason of [
      "scan-incomplete",
      "no-server-count",
      "server-count-tripwire",
    ] as const) {
      const line = syncNowNotice({ kind: "refused", uploaded: 0, reason })!;
      expect(line).toContain("refused");
      expect(line).not.toContain("reconciled");
      expect(line).not.toContain("uploaded");
    }
  });

  it("leaves a hard failure to the push's own Notice", () => {
    expect(syncNowNotice({ kind: "failed", message: "network" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
/**
 * H2. The single-flight force flag is shared state a *joining* caller writes,
 * which is what makes it dangerous: `force` authorises a full keepPaths
 * reconcile, so a flag that survives its own run hands an unforced background
 * push the authority to delete every cloud row the scan does not name.
 */
describe("runMirrorSingleFlight force follow-up", () => {
  /** A run whose passes resolve when the test says so. */
  function fakeFlight(outcomes: Array<Exclude<MirrorSyncOutcome, { kind: "joined" }>>) {
    const state: MirrorSingleFlightState = {
      inFlight: false,
      followUp: false,
      forceFollowUp: false,
    };
    const forces: boolean[] = [];
    let release: (() => void) | null = null;
    const host: MirrorSingleFlightHost = {
      state,
      onBegin: () => {},
      once: async (force) => {
        forces.push(force);
        // Park the first pass so a concurrent call can join mid-`await` —
        // the only window in which the leak can be written.
        if (forces.length === 1) {
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return outcomes[forces.length - 1] ?? { kind: "worked", uploaded: 0, deleted: 0 };
      },
    };
    return {
      state,
      forces,
      host,
      release: () => {
        release?.();
      },
    };
  }

  it("drops a joined force when the run exits on failure", async () => {
    const f = fakeFlight([{ kind: "failed", message: "network" }]);
    const run = runMirrorSingleFlight(f.host, false);
    // A user taps Sync now while the background push is in the air.
    expect(await runMirrorSingleFlight(f.host, true)).toEqual({ kind: "joined" });
    expect(f.state.forceFollowUp).toBe(true);
    f.release();
    expect(await run).toEqual({ kind: "failed", message: "network" });

    expect(f.state.forceFollowUp).toBe(false);
    // The next vault edit must not inherit that gesture.
    await runMirrorSingleFlight(f.host, false);
    expect(f.forces).toEqual([false, false]);
  });

  it("drops a joined force when the run exits refused", async () => {
    const f = fakeFlight([{ kind: "refused", uploaded: 2, reason: "scan-incomplete" }]);
    const run = runMirrorSingleFlight(f.host, false);
    await runMirrorSingleFlight(f.host, true);
    f.release();
    await run;

    expect(f.state.forceFollowUp).toBe(false);
    await runMirrorSingleFlight(f.host, false);
    expect(f.forces).toEqual([false, false]);
  });

  it("still honours a joined force when the run keeps looping", async () => {
    // The flag is not merely disarmed — dropping it on the *early* exits must
    // not cost the feature its reason to exist.
    const f = fakeFlight([
      { kind: "worked", uploaded: 1, deleted: 0 },
      { kind: "worked", uploaded: 0, deleted: 3 },
    ]);
    const run = runMirrorSingleFlight(f.host, false);
    await runMirrorSingleFlight(f.host, true);
    f.release();

    expect(await run).toEqual({ kind: "worked", uploaded: 1, deleted: 3 });
    expect(f.forces).toEqual([false, true]);
    expect(f.state).toEqual({
      inFlight: false,
      followUp: false,
      forceFollowUp: false,
    });
  });

  it("leaves no flag set for the next caller after any exit", async () => {
    for (const outcome of [
      { kind: "failed" } as const,
      { kind: "refused", uploaded: 0 } as const,
      { kind: "worked", uploaded: 0, deleted: 0 } as const,
    ]) {
      const f = fakeFlight([outcome]);
      const run = runMirrorSingleFlight(f.host, true);
      await runMirrorSingleFlight(f.host, true);
      f.release();
      await run;
      expect(f.state).toEqual({
        inFlight: false,
        followUp: false,
        forceFollowUp: false,
      });
    }
  });
});

describe("describeMirrorRefusal covers every reason", () => {
  // The switch has no `default`, so this list and the union must agree or the
  // build breaks. The bug it replaces: `baseline-unreadable` fell through to
  // "vault scan looks incomplete" while the modal for the same refusal said
  // the baseline could not be read.
  const reasons: MirrorDeletionRefusal[] = [
    "scan-incomplete",
    "no-server-count",
    "server-count-tripwire",
    "baseline-unreadable",
  ];

  it("gives each reason its own sentence", () => {
    const lines = reasons.map((r) => describeMirrorRefusal(r));
    expect(new Set(lines).size).toBe(reasons.length);
    for (const line of lines) expect(line).toMatch(/nothing was deleted/);
  });

  it("says the baseline is unreadable rather than blaming the scan", () => {
    expect(describeMirrorRefusal("baseline-unreadable")).toMatch(/baseline/i);
    expect(describeMirrorRefusal("baseline-unreadable")).not.toMatch(
      /scan looks incomplete/,
    );
  });

  it("falls back to the scan wording only when no reason was given", () => {
    expect(describeMirrorRefusal(undefined)).toMatch(/scan looks incomplete/);
  });
});

describe("syncNowNotice is honest about a joined push", () => {
  it("does not claim the joined work happened", () => {
    // A joining caller's request is absorbed, and if the running pass exits on
    // failed/refused the absorbed work never runs. "joined it" read as done.
    const line = syncNowNotice({ kind: "joined" }) ?? "";
    expect(line).not.toMatch(/joined it/);
    expect(line).toMatch(/already running/);
    expect(line).toMatch(/again/);
  });
});

/**
 * The pass's own single-flight claim, which is not the same latch as `runMirrorSingleFlight`
 * above: this one guards the whole drain → outbox → mirror → filing pass.
 *
 * The flag was read at the top and written seventy lines later, with two `await`s between, so
 * two presses landing in the same tick both read it while it was still false and both ran a
 * full pass. Exercised through the real method rather than a copy of its logic, because the
 * bug was entirely in *where* the write sat relative to the awaits.
 */
describe("runCatchUpPass single-flight", () => {
  /**
   * The smallest `this` the method touches before it returns. `vaultIndexReady: false` makes
   * `decideResumeStages` block every stage, so the first call returns early — after the awaits
   * that the second call has to survive.
   */
  function fakePlugin() {
    return {
      catchUpInFlight: false,
      app: { loadLocalStorage: () => null, saveLocalStorage: () => {} },
      vaultIndexReady: false,
      lastInboxPendingCount: 0,
      lastResumePassAt: 0,
      drainStartedAt: null,
      filingStartedAt: null,
      waivedFilingStamps: [] as number[],
      pendingNewDrainWork: 0,
      waiverUsedThisSignal: false,
      stageInput: (AtomsPlugin.prototype as never as {
        stageInput: (...a: unknown[]) => unknown;
      }).stageInput,
    };
  }

  const runPass = (
    self: ReturnType<typeof fakePlugin>,
  ): Promise<{ ran: boolean; reason: string }> =>
    (
      AtomsPlugin.prototype as never as {
        runCatchUpPass: (o: { manual: boolean; silent: boolean }) => Promise<{
          ran: boolean;
          reason: string;
        }>;
      }
    ).runCatchUpPass.call(self, { manual: false, silent: true });

  it("turns away a second press landing in the same tick", async () => {
    const self = fakePlugin();

    // No `await` between them: exactly what a double tap on Sync everything now produces, and
    // what a manual run racing a resume signal produces.
    const first = runPass(self);
    const second = runPass(self);

    expect((await second).reason).toBe("in_flight");
    await first;
  });

  it("releases the claim when the pass returns early, so the next press is not refused", async () => {
    const self = fakePlugin();

    expect((await runPass(self)).ran).toBe(false);
    expect(self.catchUpInFlight).toBe(false);
    // The early return sits inside the `try`, so its `finally` still clears the claim.
    expect((await runPass(self)).reason).not.toBe("in_flight");
  });
});

// ---------------------------------------------------------------------------
/**
 * "Sync everything now" against the filing window (U6 / KTD4).
 *
 * The catch-up passes `bypassEnabled: manual`, so it files with the auto-run toggle *off* — which
 * is exactly what makes it the candidate for a new silent full-history sweep. These cases drive
 * the real `maybeAutoRun` with catch-up arguments, against a writable fake vault and the real
 * `runAutoFilingCycle` → `resolveAutoFilingSince` → `runWritePath` chain, so what is asserted is
 * the bound production actually resolves rather than a restatement of the rule.
 */
describe("manual catch-up is scoped to the filing window", () => {
  afterEach(() => {
    classifyTransport.handler = null;
    vi.restoreAllMocks();
  });

  const DAY_MS = 86_400_000;
  /** A local calendar day `n` days back from today — the clock the pass itself reads. */
  const dayBack = (n: number): string =>
    localDateString(new Date(Date.now() - n * DAY_MS));

  /**
   * The smallest `this` `maybeAutoRun` touches, wired to a real vault double.
   *
   * `countPastUnprocessed` is the production method, not a stand-in: the window bound has to
   * reach the count and the write as one value, and a hand-written counter would be the one
   * place that could not drift.
   */
  function catchUpSelf(opts: {
    store: Record<string, unknown>;
    files: Record<string, string>;
    dailies: Array<{ path: string; date: string }>;
  }) {
    const vault = fakeVault(opts.files);
    stubDailyNotes(opts.dailies);
    const store = opts.store;
    const self = {
      app: {
        ...(vault.app as unknown as Record<string, unknown>),
        loadLocalStorage: (k: string) => store[k] ?? null,
        saveLocalStorage: (k: string, v: unknown) => {
          store[k] = v;
        },
      },
      vaultIndexReady: true,
      contextProvider: contextProviderFor(vault.app),
      settings: {
        model: "claude-sonnet-5",
        activeVocabulary: ["idea"],
        atomFolder: "Atoms",
        enableHubProjection: false,
        proposedTags: [],
      },
      autoRunInFlight: false,
      filingStartedAt: null as number | null,
      lastWriteReport: null as unknown,
      resolveFilingAuth: () => ({ mode: "byok", apiKey: "k" }),
      saveSettings: async () => {},
      hasOpenAtomsHome: () => false,
      refreshAtomsHomeLeaves: async () => {},
      landPeakFromWrite: () => null,
      finishHomeRun: () => {},
      countPastUnprocessed: (
        AtomsPlugin.prototype as never as {
          countPastUnprocessed: (...a: unknown[]) => unknown;
        }
      ).countPastUnprocessed,
    };
    return { self, vault };
  }

  /** What "Sync everything now" reaches when it decides to file (main.ts:818-825). */
  const tapSyncEverythingNow = (
    self: ReturnType<typeof catchUpSelf>["self"],
  ): Promise<{ ran: boolean; reason: string }> =>
    (
      AtomsPlugin.prototype as never as {
        maybeAutoRun: (
          source: string,
          catchUp?: { bypassEnabled?: boolean; silentHome?: boolean },
        ) => Promise<{ ran: boolean; reason: string }>;
      }
    ).maybeAutoRun.call(self, "manual", {
      bypassEnabled: true,
      silentHome: true,
    });

  it("files inside the window only, with the auto-run toggle off", async () => {
    const preWindow = "- an old thought from long before the window\n";
    const inWindow = "- a thought from inside the window\n";
    const { self, vault } = catchUpSelf({
      // Filing was on once and has since been turned off, so the stamp survives (KTD6). The
      // toggle being off is the whole point: `bypassEnabled` files anyway.
      store: {
        [LS_AUTO_RUN_ENABLED]: false,
        [LS_AUTO_RUN_START_DAY]: dayBack(7),
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
      },
      files: {
        [`Daily/${dayBack(40)}.md`]: preWindow,
        [`Daily/${dayBack(2)}.md`]: inWindow,
      },
      dailies: [
        { path: `Daily/${dayBack(40)}.md`, date: dayBack(40) },
        { path: `Daily/${dayBack(2)}.md`, date: dayBack(2) },
      ],
    });
    const classify = fakeClassify([atomResult("A thought inside the window")]);
    classifyTransport.handler = classify.request as never;

    const outcome = await tapSyncEverythingNow(self);

    expect(outcome.ran).toBe(true);
    // Only the in-window capture was ever sent, and only its daily gained a marker.
    expect(classify.captures).toHaveLength(1);
    expect(classify.captures[0]).toContain("a thought from inside the window");
    expect(vault.read(`Daily/${dayBack(2)}.md`)).toContain("<!--linker-->");
    expect(vault.read(`Daily/${dayBack(40)}.md`)).toBe(preWindow);
  });

  it("is bounded, not unbounded, on a device that never enabled automatic filing", async () => {
    // The hole KTD2 fails closed against: no stamp, toggle never on, and a tap on a control
    // named "Sync everything now". An unbounded resolve here would file the user's whole
    // history in one tap, silently and unpriced.
    const preWindow = "- an old thought from long before the window\n";
    const alsoOld = "- another old thought, from a different day\n";
    const { self, vault } = catchUpSelf({
      store: { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION },
      files: {
        [`Daily/${dayBack(400)}.md`]: preWindow,
        [`Daily/${dayBack(3)}.md`]: alsoOld,
      },
      dailies: [
        { path: `Daily/${dayBack(400)}.md`, date: dayBack(400) },
        { path: `Daily/${dayBack(3)}.md`, date: dayBack(3) },
      ],
    });
    const classify = fakeClassify([atomResult("Never filed")]);
    classifyTransport.handler = classify.request as never;

    await tapSyncEverythingNow(self);

    // Byte-identical: not "no atom created", not "fewer markers" — untouched.
    expect(vault.read(`Daily/${dayBack(400)}.md`)).toBe(preWindow);
    expect(vault.read(`Daily/${dayBack(3)}.md`)).toBe(alsoOld);
    // Nothing was even sent to the model, so nothing was paid for either.
    expect(classify.captures).toEqual([]);
    expect(vault.paths()).toEqual([
      `Daily/${dayBack(400)}.md`,
      `Daily/${dayBack(3)}.md`,
    ]);
  });

  it("never reaches today's daily, whatever bypassEnabled says", async () => {
    // `includeTodayForRun` allows today for the enable tap alone. The catch-up passes no
    // attended options, and `bypassEnabled` must not become a back door to today.
    const todayText = "- something captured mid-day, still being edited\n";
    const inWindow = "- a thought from inside the window\n";
    const { self, vault } = catchUpSelf({
      store: {
        [LS_AUTO_RUN_ENABLED]: false,
        [LS_AUTO_RUN_START_DAY]: dayBack(7),
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
      },
      files: {
        [`Daily/${dayBack(0)}.md`]: todayText,
        [`Daily/${dayBack(2)}.md`]: inWindow,
      },
      dailies: [
        { path: `Daily/${dayBack(0)}.md`, date: dayBack(0) },
        { path: `Daily/${dayBack(2)}.md`, date: dayBack(2) },
      ],
    });
    const classify = fakeClassify([atomResult("A thought inside the window")]);
    classifyTransport.handler = classify.request as never;

    await tapSyncEverythingNow(self);

    expect(vault.read(`Daily/${dayBack(2)}.md`)).toContain("<!--linker-->");
    expect(vault.read(`Daily/${dayBack(0)}.md`)).toBe(todayText);
    expect(classify.captures).toHaveLength(1);
    expect(classify.captures[0]).not.toContain("still being edited");
  });

  it("stamps no window start on a device that never enabled automatic filing", async () => {
    // Tapping catch-up is not turning filing on. A stamp written here would age: every later
    // tap would resolve to that first-tap day and widen the window it was meant to bound.
    const store: Record<string, unknown> = {
      [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
    };
    const { self } = catchUpSelf({
      store,
      files: { [`Daily/${dayBack(30)}.md`]: "- an old thought\n" },
      dailies: [{ path: `Daily/${dayBack(30)}.md`, date: dayBack(30) }],
    });
    classifyTransport.handler = fakeClassify([atomResult("Never")]).request as never;

    await tapSyncEverythingNow(self);
    await tapSyncEverythingNow(self);

    expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
    expect(store[LS_AUTO_RUN_ENABLED]).toBeUndefined();
  });
});
