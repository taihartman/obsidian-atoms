/**
 * #280 — the post-checkout poll must announce readiness once per checkout,
 * not once per poll that happened to be in flight when entitlement flipped.
 *
 * The bug was check-then-act across an await: every caller past the
 * `isAwaitingCheckout` guard is committed to the notice, and four uncoordinated
 * triggers (load, 5s interval, visibilitychange, focus) feed the loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let noticeCount = 0;

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    Notice: class {
      constructor(_message: string, _timeout?: number) {
        noticeCount += 1;
      }
    },
  };
});

vi.mock("../src/platform/plusRefresh", () => ({
  refreshPlusEntitlementRecord: vi.fn(),
}));

import {
  LS_PLUS_SESSION,
  isAwaitingCheckout,
  serializePlusSession,
  setAwaitingCheckout,
  type LocalStorageLike,
  type PlusSession,
} from "../src/platform/filingAuth";
import { refreshPlusEntitlementRecord } from "../src/platform/plusRefresh";
import {
  refreshPlusSessionQuiet,
  type PlusResumeHost,
} from "../src/platform/plusResume";

function fakeApp(): LocalStorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    loadLocalStorage: (key) => store.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      store.set(key, String(value ?? ""));
    },
  };
}

const pending: PlusSession = {
  sessionToken: "sess_pending",
  email: "a@b.co",
  status: "incomplete",
  remaining: 0,
  periodEnd: null,
  refreshedAt: 1000,
};

/**
 * Gates are per-app on purpose: one shared gate would make every device wait
 * on every other device's refresh, which is the very coupling these tests
 * exist to rule out.
 */
const gates = new Map<LocalStorageLike, Promise<void>>();

/** A refresh whose completion the test controls, mimicking a slow cold start. */
function deferredRefresh(app: LocalStorageLike): () => void {
  let release!: () => void;
  gates.set(
    app,
    new Promise<void>((r) => {
      release = r;
    }),
  );
  return release;
}

/** Default: wait for this app's gate (if any), then persist the entitlement. */
function installRefreshMock() {
  vi.mocked(refreshPlusEntitlementRecord).mockImplementation(async (app) => {
    const gate = gates.get(app);
    if (gate) await gate;
    // What the real refresh does on success: persist the entitled session.
    app.saveLocalStorage(
      LS_PLUS_SESSION,
      serializePlusSession({ ...pending, status: "trialing", remaining: 150 }),
    );
    return { kind: "ok" } as Awaited<
      ReturnType<typeof refreshPlusEntitlementRecord>
    >;
  });
}

function hostFor(app: LocalStorageLike): PlusResumeHost {
  return {
    app: app as PlusResumeHost["app"],
    settings: { plusBaseUrl: "https://plus.example" },
    registerInterval: (id: number) => id,
  };
}

describe("#280 post-checkout readiness announcement", () => {
  beforeEach(() => {
    noticeCount = 0;
    gates.clear();
    vi.mocked(refreshPlusEntitlementRecord).mockReset();
    installRefreshMock();
  });

  it("announces once when several polls are in flight as entitlement flips", async () => {
    const app = fakeApp();
    app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(pending));
    setAwaitingCheckout(app, true);
    const release = deferredRefresh(app);
    const host = hostFor(app);

    // Four triggers land before any of them resolves — load, interval tick,
    // visibilitychange and focus all fire on return from Stripe.
    const inFlight = [
      refreshPlusSessionQuiet(host),
      refreshPlusSessionQuiet(host),
      refreshPlusSessionQuiet(host),
      refreshPlusSessionQuiet(host),
    ];
    release();
    const results = await Promise.all(inFlight);

    expect(noticeCount).toBe(1);
    // Every caller still learns the truth; only one of them announced it.
    expect(results.every((r) => r === true)).toBe(true);
    expect(isAwaitingCheckout(app)).toBe(false);
  });

  it("does the network work once, not once per concurrent caller", async () => {
    const app = fakeApp();
    app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(pending));
    setAwaitingCheckout(app, true);
    const release = deferredRefresh(app);
    const host = hostFor(app);

    const inFlight = [
      refreshPlusSessionQuiet(host),
      refreshPlusSessionQuiet(host),
      refreshPlusSessionQuiet(host),
    ];
    release();
    await Promise.all(inFlight);

    expect(vi.mocked(refreshPlusEntitlementRecord)).toHaveBeenCalledTimes(1);
  });

  it("announces again for a later checkout — the guard is not a permanent latch", async () => {
    const app = fakeApp();
    app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(pending));
    setAwaitingCheckout(app, true);
    const first = deferredRefresh(app);
    const host = hostFor(app);

    const a = refreshPlusSessionQuiet(host);
    first();
    await a;
    expect(noticeCount).toBe(1);

    // A second checkout on the same device (top-up, resubscribe).
    app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(pending));
    setAwaitingCheckout(app, true);
    const second = deferredRefresh(app);
    const b = refreshPlusSessionQuiet(host);
    second();
    await b;

    expect(noticeCount).toBe(2);
  });

  it("stays silent while entitlement has not landed yet", async () => {
    const app = fakeApp();
    app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(pending));
    setAwaitingCheckout(app, true);
    vi.mocked(refreshPlusEntitlementRecord).mockResolvedValue({
      kind: "ok",
    } as Awaited<ReturnType<typeof refreshPlusEntitlementRecord>>);

    const done = await refreshPlusSessionQuiet(hostFor(app));

    expect(done).toBe(false);
    expect(noticeCount).toBe(0);
    // Still awaiting — the poll must keep running.
    expect(isAwaitingCheckout(app)).toBe(true);
  });

  it("does not couple two devices' polls to each other", async () => {
    const deviceA = fakeApp();
    const deviceB = fakeApp();
    for (const app of [deviceA, deviceB]) {
      app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(pending));
      setAwaitingCheckout(app, true);
    }
    // Only A's refresh is gated; B must not be made to wait on it.
    const releaseA = deferredRefresh(deviceA);

    const b = await refreshPlusSessionQuiet(hostFor(deviceB));
    releaseA();
    await refreshPlusSessionQuiet(hostFor(deviceA));

    expect(b).toBe(true);
    expect(noticeCount).toBe(2);
  });
});
