import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskCoordinator } from "../src/plugin/askCoordinator";
import { fireAndForgetAsk } from "../src/shared/fireAndForget";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import {
  ASK_PRIVACY_ACK_VERSION,
  ASK_WRITE_ACK_VERSION,
} from "../src/shared/askAck";
import { stripLegacyAskMirrorHashes } from "../src/platform/askMirror";
import type { AskMirrorHost } from "../src/platform/askMirror";
import type { ConfirmRequest, ConfirmVerdict } from "../src/shared/confirm";

/** Modals the coordinator opened, newest last. */
const openedModals: FakeConfirmModal[] = [];

class FakeConfirmModal {
  opened = false;
  closed = false;
  constructor(
    readonly app: unknown,
    readonly request: ConfirmRequest,
    private readonly onVerdict: (verdict: ConfirmVerdict) => void,
  ) {
    openedModals.push(this);
  }
  open(): void {
    this.opened = true;
  }
  close(): void {
    // Mirrors the real modal: closing without choosing is a dismissal.
    this.closed = true;
    this.onVerdict("dismissed");
  }
}

/** The host object the coordinator handed to runAskMirrorSync. */
let capturedHost: AskMirrorHost | null = null;
/**
 * Every batch that reached the network stub, in order. This is the assertion the
 * #323 tests need: note bodies leaving the device is the defect, and a settings
 * flag reading `""` is only a proxy for it.
 */
const upserts: unknown[][] = [];
/** How many mirror passes started. A follow-up pass is pass 2. */
let mirrorPasses = 0;
/** Runs at the top of each pass, so a test can move the world mid-flight. */
let onMirrorPass: ((pass: number) => void) | null = null;

/** Expand backfills the coordinator fired, and what the network did with them. */
let outboxPulls = 0;
let expandBackfillCalls = 0;
let expandBackfillImpl: () => Promise<unknown> = async () => ({ ok: true });

// Same reason as the plusClient mock below, plus a stamp: these tests are about
// coordinator wiring, and an unstamped session would make every one of them a
// test of the #508 gate instead. The gate has its own file.
/** The stored session's #508 stamp, so a test can take it away. */
const stamped = vi.hoisted(() => ({ base: "https://plus.example" as string | undefined }));

vi.mock("../src/platform/filingAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/platform/filingAuth")>()),
  readPlusSession: () => ({
    sessionToken: "test-token",
    email: "a@b.co",
    issuedBase: stamped.base,
    verifiedBase: stamped.base,
  }),
}));

// Spread the real module rather than replacing it: `plusBaseVerify` (the #508
// gate) imports its comparison helpers and its refusal copy from here, and a
// bare object mock leaves those undefined at call time.
vi.mock("../src/platform/plusClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/platform/plusClient")>()),
  DEFAULT_PLUS_BASE_URL: "https://plus.example",
  plusFetchRequest: async () => ({ ok: true }),
  askMirrorUpsert: async (_cfg: unknown, _token: string, atoms: unknown[]) => {
    upserts.push(atoms);
    return { ok: true };
  },
  askMirrorDelete: async () => ({ ok: true }),
  askMirrorReconcile: async () => ({ ok: true }),
  askMirrorStatus: async () => ({ ok: true, count: 0 }),
  askOutboxPull: async () => {
    outboxPulls += 1;
    return { ok: true, items: [] };
  },
  askOutboxAck: async () => ({ ok: true }),
  askMirrorExpandBackfill: () => {
    expandBackfillCalls += 1;
    return expandBackfillImpl();
  },
}));

vi.mock("../src/settings/settings", () => ({
  AskMirrorDeleteConfirmModal: FakeConfirmModal,
}));

vi.mock("../src/platform/askMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform/askMirror")>();
  return {
    ...actual,
    // Stands in for the real planner, but pushes through the host's own `upsert`
    // so the network stub above records a real body leaving.
    runAskMirrorSync: async (host: AskMirrorHost) => {
      capturedHost = host;
      mirrorPasses += 1;
      onMirrorPass?.(mirrorPasses);
      await host.upsert([{ path: "Atoms/A.md", title: "A", body: "secret" }] as never);
      return { kind: "ok", uploaded: 1, deleted: 0, scanned: 1 };
    },
  };
});

const GRANTED_AT = "2026-08-04T00:00:00.000Z";

function makeCoordinator() {
  const plugin = {
    app: {
      vault: { getMarkdownFiles: () => [], read: async () => "" },
      metadataCache: { getFirstLinkpathDest: () => null },
      loadLocalStorage: () => null,
      saveLocalStorage: () => undefined,
    },
    settings: {
      ...DEFAULT_SETTINGS,
      askEnabled: true,
      askPrivacyAckAt: GRANTED_AT,
      askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
      plusBaseUrl: "",
    },
    refreshAtomsHomeLeaves: async () => undefined,
  };
  const coordinator = new AskCoordinator(plugin as never);
  /**
   * What Sync landing another device's withdrawal looks like from in here.
   *
   * Timestamp and version move together, because that is what every withdrawal path in the
   * plugin writes (#360). A helper that cleared only one would be testing a state the app
   * cannot produce.
   */
  const withdrawConsent = () => {
    plugin.settings.askPrivacyAckAt = "";
    plugin.settings.askPrivacyAckVersion = "";
  };
  const grantConsent = () => {
    plugin.settings.askPrivacyAckAt = GRANTED_AT;
    plugin.settings.askPrivacyAckVersion = ASK_PRIVACY_ACK_VERSION;
  };
  return { coordinator, plugin, withdrawConsent, grantConsent };
}

describe("askCoordinator glue (post-#226 residual peel)", () => {
  it("fireAndForgetAsk never rejects to Process caller", async () => {
    let callerFailed = false;
    try {
      fireAndForgetAsk(Promise.reject(new Error("mirror down")));
      await new Promise((r) => setTimeout(r, 0));
    } catch {
      callerFailed = true;
    }
    expect(callerFailed).toBe(false);
  });

  it("U6 already landed: DEFAULT_SETTINGS has no askMirrorHashes", () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty("askMirrorHashes");
  });

  it("U6 strip still clears legacy key from raw settings blob", () => {
    const raw: Record<string, unknown> = {
      askEnabled: true,
      askMirrorHashes: { "Atoms/A.md": "h1" },
    };
    expect(stripLegacyAskMirrorHashes(raw)).toBe(true);
    expect(raw).not.toHaveProperty("askMirrorHashes");
  });
});

// The gate's confirm-withdrawal fix (#248) is inert unless the *real* host
// implements cancelConfirm — the fake host in askMirrorGate.adversarial.test.ts
// cannot catch a peel that drops the wiring. This locks the production object.
describe("askCoordinator mirror host: confirm dialog withdrawal", () => {
  beforeEach(() => {
    openedModals.length = 0;
    capturedHost = null;
  });

  it("exposes cancelConfirm on the host it hands to runAskMirrorSync", async () => {
    await makeCoordinator().coordinator.sync({ force: true });
    expect(capturedHost).not.toBeNull();
    expect(typeof capturedHost?.cancelConfirm).toBe("function");
  });

  it("cancelConfirm closes the modal that confirm opened", async () => {
    await makeCoordinator().coordinator.sync({ force: true });
    const host = capturedHost!;
    const request: ConfirmRequest = {
      kind: "ask-mirror-deletion",
      evidenceCount: 400,
      scannedCount: 400,
      lastKnownServerCount: 400,
      reason: "scan-incomplete",
    };

    const verdict = host.confirm(request);
    expect(openedModals).toHaveLength(1);
    expect(openedModals[0]!.opened).toBe(true);

    host.cancelConfirm!();

    expect(openedModals[0]!.closed).toBe(true);
    // A withdrawn dialog must settle as "leave the mirror untouched".
    await expect(verdict).resolves.toBe("dismissed");
  });

  it("cancelConfirm is a no-op when no dialog is open", async () => {
    await makeCoordinator().coordinator.sync({ force: true });
    expect(() => capturedHost!.cancelConfirm!()).not.toThrow();
    expect(openedModals).toHaveLength(0);
  });
});

/**
 * #323 F1 — a consent withdrawn on another device lands *between* mirror passes.
 *
 * `sync()` checks consent once, before the single-flight lock; `runMirrorSingleFlight`
 * then loops back into `once()`, never into `sync()`. So the pass that runs after a
 * withdrawal used to cross no gate at all.
 *
 * These assert on `upserts` — bodies that actually reached the network stub — because
 * the defect is egress. Asserting `settings.askPrivacyAckAt === ""` would stay green
 * through the whole leak, which is exactly what the first round of tests did.
 */
describe("#323 F1 — consent withdrawn mid-flight stops the follow-up push", () => {
  beforeEach(() => {
    upserts.length = 0;
    mirrorPasses = 0;
    onMirrorPass = null;
    openedModals.length = 0;
    capturedHost = null;
  });

  it("refuses the follow-up pass a vault edit queued before the withdrawal", async () => {
    const { coordinator, withdrawConsent } = makeCoordinator();
    onMirrorPass = (pass) => {
      if (pass !== 1) return;
      // A vault edit during the push. Consent still stands, so this legitimately
      // queues a follow-up inside the running flight.
      coordinator.scheduleSync();
      // ...and *then* the phone's withdrawal replaces plugin.settings.
      withdrawConsent();
    };

    const outcome = await coordinator.sync({ force: false });

    expect(mirrorPasses).toBe(1);
    expect(upserts).toHaveLength(1);
    // The follow-up ran and was turned away at the gate, rather than uploading.
    expect(outcome).toEqual({ kind: "failed", message: "Ask mirror is off" });
  });

  it("cancelPendingSync retires the follow-up so the run ends clean", async () => {
    const { coordinator, withdrawConsent } = makeCoordinator();
    onMirrorPass = (pass) => {
      if (pass !== 1) return;
      coordinator.scheduleSync();
      withdrawConsent();
      // What onExternalSettingsChange does once it sees a state the mirror may
      // not push under: nothing is owed any more, so pass 2 never starts.
      coordinator.cancelPendingSync();
    };

    const outcome = await coordinator.sync({ force: false });

    expect(mirrorPasses).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(outcome).toEqual({ kind: "worked", uploaded: 1, deleted: 0 });
  });

  it("cancelPendingSync disarms the debounce, so a re-grant does not fire the cancelled push", async () => {
    vi.useFakeTimers();
    try {
      const { coordinator, withdrawConsent, grantConsent } = makeCoordinator();
      // A vault edit with nothing in flight arms the 2s debounce.
      coordinator.scheduleSync();
      withdrawConsent();
      coordinator.cancelPendingSync();
      // The user re-grants inside the debounce window. Without the timer clear the
      // armed callback would now find consent in place and push the batch that was
      // scheduled under the *old* grant.
      grantConsent();

      await vi.advanceTimersByTimeAsync(3000);

      expect(mirrorPasses).toBe(0);
      expect(upserts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a push started under withdrawn consent never reaches the network", async () => {
    const { coordinator, withdrawConsent } = makeCoordinator();
    withdrawConsent();

    const outcome = await coordinator.sync({ force: true });

    expect(mirrorPasses).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(outcome).toEqual({ kind: "failed", message: "Ask mirror is off" });
  });
});

describe("#339 F1 — Sync never waits on the expand backfill", () => {
  beforeEach(() => {
    upserts.length = 0;
    mirrorPasses = 0;
    onMirrorPass = null;
    capturedHost = null;
    expandBackfillCalls = 0;
    expandBackfillImpl = async () => ({ ok: true });
  });

  it("returns while the backfill is still running", async () => {
    // The server side expands one row per model call. Awaiting it held "Sync
    // now" open for minutes on a first sync; here it simply never settles.
    let release: () => void = () => undefined;
    expandBackfillImpl = () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      });

    const outcome = await coordinatorSync();

    expect(outcome).toEqual({ kind: "worked", uploaded: 1, deleted: 0 });
    expect(expandBackfillCalls).toBe(1);
    release();
  });

  it("a failing backfill does not fail the Sync", async () => {
    expandBackfillImpl = async () => {
      throw new Error("expand upstream 502");
    };

    const outcome = await coordinatorSync();

    expect(outcome).toEqual({ kind: "worked", uploaded: 1, deleted: 0 });
    expect(expandBackfillCalls).toBe(1);
    // The rejection is swallowed by fireAndForgetAsk, not left unhandled.
    await new Promise((r) => setTimeout(r, 0));
  });
});

/** One forced push through the mocked mirror planner. */
async function coordinatorSync() {
  const { coordinator } = makeCoordinator();
  const outcome = await coordinator.sync({ force: true });
  // The fired backfill resolves its dynamic import after the return; let it
  // start, so a coordinator that never fired it is still a failure here.
  await new Promise((r) => setTimeout(r, 0));
  return outcome;
}

/**
 * #508 U5 — the mirror is the path that carries atom *bodies*, so it refuses a
 * base this session was not shown to belong to.
 *
 * Both assertions are that the network layer was never reached, not that an
 * error came back: an atom body that leaves the device is the failure, and a
 * returned verdict object only proves a branch was chosen.
 */
describe("#508 — the mirror refuses an unverified base", () => {
  beforeEach(() => {
    mirrorPasses = 0;
    outboxPulls = 0;
    upserts.length = 0;
    stamped.base = "https://plus.example";
  });

  afterEach(() => {
    stamped.base = "https://plus.example";
  });

  it("never reaches runAskMirrorSync, so no atom body is built", async () => {
    // An unstamped session with an empty field: the KTD1 carve-out, and the
    // exact state a self-hoster upgrades into.
    stamped.base = undefined;
    const { coordinator } = makeCoordinator();
    const outcome = await coordinator.sync({ force: true });
    expect(mirrorPasses).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(outcome.kind).toBe("failed");
  });

  it("refuses a stamp that names a different server", async () => {
    stamped.base = "https://someone.elses.host";
    const { coordinator } = makeCoordinator();
    await coordinator.sync({ force: true });
    expect(mirrorPasses).toBe(0);
    expect(upserts).toHaveLength(0);
  });

  it("the outbox ack path stops too, silently", async () => {
    // `askOutboxAck` sends `plan.reason`, which is free text from the vault.
    // Sorting the ack as content-free was the wrong axis.
    stamped.base = undefined;
    const { coordinator, plugin } = makeCoordinator();
    plugin.settings.askWriteAckAt = GRANTED_AT;
    plugin.settings.askWriteAckVersion = ASK_WRITE_ACK_VERSION;
    const outcome = await coordinator.applyOutbox();
    expect(outboxPulls).toBe(0);
    expect(outcome).toEqual({ kind: "worked", landed: 0, rejected: 0 });
  });

  it("a stamped session still syncs, so the gate is not just off", async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.sync({ force: true });
    expect(mirrorPasses).toBe(1);
  });
});
