import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Classify transport double, same seam `catchUp.test.ts` uses: `maybeAutoRun` builds its own
 * `classifyDeps` and exposes no request seam, so the stub has to sit where production puts it.
 * Nothing here should reach it — that several of these cases assert *zero* sends is the point.
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

import { readFileSync } from "node:fs";
import path from "node:path";
import AtomsPlugin from "../src/plugin/main";
import {
  EGRESS_ACK_VERSION,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_START_DAY,
  LS_AUTO_RUN_WINDOW_MIGRATED,
  localDateString,
  readAutoFilingWindowMigrated,
} from "../src/platform/autorun";
import {
  atomResult,
  contextProviderFor,
  fakeClassify,
  fakeVault,
  stubDailyNotes,
} from "./helpers/pipelineVault";

const DAY_MS = 86_400_000;
/** A local calendar day `n` days back from today — the clock the pass itself reads. */
const dayBack = (n: number): string =>
  localDateString(new Date(Date.now() - n * DAY_MS));

/* ------------------------------------------------------------------ *
 * Finding 1 — an unguarded migration takes the whole session's filing
 * ------------------------------------------------------------------ */

/**
 * `migrateAutoFilingWindow` runs on load, between the vault-index wait and the two things that
 * actually file: the onload pass and the hourly interval registration. Unguarded, a throw from it
 * — a full or hostile localStorage is enough — drops both, so filing is dead until the next
 * restart with nothing said. The migration itself is retryable; the session is not.
 */
describe("scheduleAutoRunLifecycle survives a throwing window migration", () => {
  /** The smallest `this` the lifecycle touches, with a store that refuses the migration write. */
  function lifecycleSelf(opts: { store: Record<string, unknown> }) {
    const runs: string[] = [];
    const intervals: number[] = [];
    const self = {
      app: {
        // Both throw, so `waitForVaultIndexReady` settles synchronously instead of on a timer.
        workspace: {
          onLayoutReady: () => {
            throw new Error("no layout in tests");
          },
        },
        metadataCache: {
          on: () => {
            throw new Error("no metadata cache in tests");
          },
        },
        vault: { getMarkdownFiles: () => [] },
        loadLocalStorage: (k: string) => opts.store[k] ?? null,
        saveLocalStorage: (k: string, v: unknown) => {
          if (k === LS_AUTO_RUN_START_DAY) throw new Error("localStorage is full");
          opts.store[k] = v;
        },
      },
      vaultIndexReady: false,
      resumeListenersArmed: false,
      pendingResumeWhenReady: false,
      registerInterval: (id: number) => {
        intervals.push(id);
        window.clearInterval(id);
        return id;
      },
      maybeAutoRun: async (source: string) => {
        runs.push(source);
        return { ran: false, reason: "empty" };
      },
      scheduleResumeCatchUp: () => {},
      runs,
      intervals,
    };
    return self;
  }

  const run = (self: ReturnType<typeof lifecycleSelf>): Promise<void> =>
    (
      AtomsPlugin.prototype as never as {
        scheduleAutoRunLifecycle: () => Promise<void>;
      }
    ).scheduleAutoRunLifecycle.call(self);

  it("still fires the onload pass and registers the hourly interval", async () => {
    // An upgraded device with filing on and no stamp yet — the one shape that reaches the write.
    const store: Record<string, unknown> = { [LS_AUTO_RUN_ENABLED]: true };
    const self = lifecycleSelf({ store });

    await run(self);

    expect(self.runs).toEqual(["onload"]);
    expect(self.intervals).toHaveLength(1);
    expect(self.vaultIndexReady).toBe(true);
  });

  it("leaves the migration unfinished so the next launch retries it", async () => {
    const store: Record<string, unknown> = { [LS_AUTO_RUN_ENABLED]: true };

    await run(lifecycleSelf({ store }));

    // Neither half of the migration landed: no stamp, and no flag claiming one happened.
    expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
    expect(store[LS_AUTO_RUN_WINDOW_MIGRATED]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Finding 2 — read-only surfaces must not mint device state
 * ------------------------------------------------------------------ */

/**
 * `showAutoRunStatus` is a diagnostic command. Resolving the bound through the *persisting*
 * resolver made it stamp the window start on an enabled device that had none — which is not just
 * a surprising write: `migrateAutoFilingWindow` only stamps when nothing is stored, so whoever
 * writes first wins, and the migration then skips without ever setting its flag. The user loses
 * the copy explaining why the sweep paused and just watches filing stop.
 */
describe("read-only surfaces resolve the bound without persisting it", () => {
  function statusSelf(store: Record<string, unknown>) {
    const vault = fakeVault({});
    stubDailyNotes([]);
    return {
      app: {
        ...(vault.app as unknown as Record<string, unknown>),
        loadLocalStorage: (k: string) => store[k] ?? null,
        saveLocalStorage: (k: string, v: unknown) => {
          store[k] = v;
        },
      },
      vaultIndexReady: true,
      autoRunInFlight: false,
      settings: { atomFolder: "Atoms" },
      resolveFilingAuth: () => ({ mode: "byok", apiKey: "k" }),
      getAutoRunSnapshot: (
        AtomsPlugin.prototype as never as {
          getAutoRunSnapshot: (...a: unknown[]) => unknown;
        }
      ).getAutoRunSnapshot,
      countPastUnprocessed: (
        AtomsPlugin.prototype as never as {
          countPastUnprocessed: (...a: unknown[]) => unknown;
        }
      ).countPastUnprocessed,
    };
  }

  const showStatus = (self: ReturnType<typeof statusSelf>): Promise<void> =>
    (
      AtomsPlugin.prototype as never as { showAutoRunStatus: () => Promise<void> }
    ).showAutoRunStatus.call(self);

  it("the status command writes no window start on an enabled device", async () => {
    const store: Record<string, unknown> = { [LS_AUTO_RUN_ENABLED]: true };

    await showStatus(statusSelf(store));

    expect(store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
  });

  it("the status command does not steal the migration's stamp", async () => {
    const store: Record<string, unknown> = { [LS_AUTO_RUN_ENABLED]: true };
    const load = (k: string) => store[k] ?? null;
    const save = (k: string, v: unknown) => {
      store[k] = v;
    };

    // Home's refresh and this command can both land before the migration, which waits on the
    // vault index. Running one first must leave the migration with work to do.
    await showStatus(statusSelf(store));
    const { migrateAutoFilingWindow } = await import("../src/platform/autorun");
    expect(migrateAutoFilingWindow(load, save, "2026-08-10")).toBe(true);
    expect(readAutoFilingWindowMigrated(load)).toBe(true);
  });

  it("home resolves the bound through the non-persisting reader", () => {
    // The bound home shows is a read. Calling the persisting resolver here is the ordering bug
    // above, arriving through the surface a user opens far more often than the command.
    const source = readFileSync(
      path.resolve(__dirname, "../src/home/atomsHomeView.ts"),
      "utf8",
    );
    expect(source).toContain("readAutoFilingSince");
    expect(source).not.toContain("resolveAutoFilingSince");
  });
});

/* ------------------------------------------------------------------ *
 * Findings 3 + 4 — the refused pass claims the lock, counts, and reports itself as filing
 * ------------------------------------------------------------------ */

describe("a refused pass claims nothing and files nothing", () => {
  afterEach(() => {
    classifyTransport.handler = null;
    vi.restoreAllMocks();
  });

  /** The smallest `this` `maybeAutoRun` touches, wired to a real vault double. */
  function filingSelf(opts: {
    store: Record<string, unknown>;
    files: Record<string, string>;
    dailies: Array<{ path: string; date: string }>;
  }) {
    const vault = fakeVault(opts.files);
    stubDailyNotes(opts.dailies);
    const store = opts.store;
    /** What `filingStartedAt` read at each point the pass passes through. */
    const seen: Array<{ at: string; filingStartedAt: number | null }> = [];
    const realCount = (
      AtomsPlugin.prototype as never as {
        countPastUnprocessed: (...a: unknown[]) => Promise<number>;
      }
    ).countPastUnprocessed;

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
      counts: 0,
      seen,
      async countPastUnprocessed(...args: unknown[]): Promise<number> {
        this.counts += 1;
        seen.push({ at: "count", filingStartedAt: this.filingStartedAt });
        return realCount.apply(this, args);
      },
    };
    return { self, vault };
  }

  const unattendedPass = (
    self: ReturnType<typeof filingSelf>["self"],
  ): Promise<{ ran: boolean; reason: string }> =>
    (
      AtomsPlugin.prototype as never as {
        maybeAutoRun: (
          source: string,
          catchUp?: { bypassEnabled?: boolean; silentHome?: boolean },
        ) => Promise<{ ran: boolean; reason: string }>;
      }
    ).maybeAutoRun.call(self, "interval");

  const tapSyncEverythingNow = (
    self: ReturnType<typeof filingSelf>["self"],
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

  /** Filing turned off, with the start day disabling preserved (KTD6) and real work behind it. */
  const disabledDeviceWithHistory = () =>
    filingSelf({
      store: {
        [LS_AUTO_RUN_ENABLED]: false,
        [LS_AUTO_RUN_START_DAY]: dayBack(30),
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
      },
      files: {
        [`Daily/${dayBack(20)}.md`]: "- a thought inside the old window\n",
        [`Daily/${dayBack(2)}.md`]: "- a more recent thought\n",
      },
      dailies: [
        { path: `Daily/${dayBack(20)}.md`, date: dayBack(20) },
        { path: `Daily/${dayBack(2)}.md`, date: dayBack(2) },
      ],
    });

  it("a disabled device never scans the window it is not going to file", async () => {
    const { self } = disabledDeviceWithHistory();

    const outcome = await unattendedPass(self);

    expect(outcome).toEqual({ ran: false, reason: "disabled" });
    // The refusal is knowable from device state alone: an hourly vault scan buys nothing.
    expect(self.counts).toBe(0);
  });

  it("a disabled device does not hold the filing lock against the catch-up", async () => {
    const { self, vault } = disabledDeviceWithHistory();
    const classify = fakeClassify([atomResult("A thought inside the old window")]);
    classifyTransport.handler = classify.request as never;

    // Same tick: the hourly pass and a tap on "Sync everything now". The hourly one is refused,
    // so it must not have claimed the slot the paid pass needs.
    const hourly = unattendedPass(self);
    const catchUp = await tapSyncEverythingNow(self);
    await hourly;

    expect(catchUp.reason).not.toBe("in_flight");
    expect(catchUp.ran).toBe(true);
    // And the bypass still files with the toggle off — the whole point of that path.
    expect(vault.read(`Daily/${dayBack(20)}.md`)).toContain("<!--linker-->");
  });

  it("a refused pass never reports itself as filing", async () => {
    // Enabled, but no privacy ack — the gate refuses after the count, which is exactly when
    // `filingStartedAt` used to already be set. `decideResumeStages` and home's filing card
    // read that field, so a refused pass showed as a pass in progress.
    const { self } = filingSelf({
      store: {
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_AUTO_RUN_START_DAY]: dayBack(30),
      },
      files: { [`Daily/${dayBack(2)}.md`]: "- a thought inside the window\n" },
      dailies: [{ path: `Daily/${dayBack(2)}.md`, date: dayBack(2) }],
    });

    const outcome = await unattendedPass(self);

    expect(outcome.reason).toBe("no_egress_ack");
    expect(self.seen.map((s) => s.filingStartedAt)).toEqual([null]);
    expect(self.filingStartedAt).toBeNull();
  });

  it("a pass that actually writes reports filing, and clears it after", async () => {
    const { self } = filingSelf({
      store: {
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_AUTO_RUN_START_DAY]: dayBack(30),
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
      },
      files: { [`Daily/${dayBack(2)}.md`]: "- a thought inside the window\n" },
      dailies: [{ path: `Daily/${dayBack(2)}.md`, date: dayBack(2) }],
    });
    const classify = fakeClassify([atomResult("A thought inside the window")]);
    classifyTransport.handler = classify.request as never;

    const outcome = await unattendedPass(self);

    expect(outcome.ran).toBe(true);
    // The recount runs after the write, so the field is live by then — and released at the end.
    const recount = self.seen.at(-1);
    expect(recount?.filingStartedAt).toBeTypeOf("number");
    expect(self.filingStartedAt).toBeNull();
  });
});
