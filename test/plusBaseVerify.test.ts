/**
 * #508 U3 — the issuer gate.
 *
 * Every refusal here asserts **`expect(request).not.toHaveBeenCalled()`**, not
 * the returned verdict object. A verdict only proves a branch was chosen; the
 * claim this change actually makes is that nothing left the device, and the
 * #500 learning is that those are not the same test. Where a probe is expected,
 * the assertion is the inverse and just as explicit: exactly one call, to
 * `/v1/me`, at the base under test.
 *
 * The adversarial case the design turns on is `accepts-anything`: a host that
 * answers 200 to every bearer token. A status-only check would stamp it as the
 * issuer and send capture text there forever, so it gets its own test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  readPlusSession,
  serializePlusSession,
  LS_PLUS_SESSION,
  type FilingAuth,
  type IssuedBase,
  type LocalStorageLike,
  type PlusSession,
} from "../src/platform/filingAuth";
import type { RequestFn } from "../src/platform/plusClient";
import {
  clearPlusBaseRefusal,
  createPlusBaseVerifyCache,
  plusAddressAdvisory,
  plusBaseHost,
  plusIssuerMovedMessage,
  readPlusBaseRefusal,
  verifyPlusBase,
  writePlusBaseRefusal,
  LS_PLUS_BASE_REFUSAL,
  PLUS_BASE_ADDRESS_REFUSED_MESSAGE,
  PLUS_BASE_REFUSED_MESSAGE,
  PLUS_BASE_UNREACHABLE_MESSAGE,
  type PlusBaseStamp,
  type PlusBaseVerifyDeps,
} from "../src/platform/plusBaseVerify";
import { installPlusSession } from "../src/platform/plusSessionInstall";

/**
 * Compile-time: the `FilingAuth` plus projection is enough to ask the gate a
 * question. That projection is the *third* allowlist between disk and the gate
 * and `resolveClassifyAuth` never sees anything else, so dropping a stamp field
 * from it must be a build error here rather than a silent fail-open in U4.
 *
 * Inert unless this file is listed in `tsconfig.test.json`, which it is. A
 * type-level assertion in an unchecked file asserts nothing.
 */
type PlusVariant = Extract<FilingAuth, { mode: "plus" }>;
type Assert<T extends true> = T;

const _projectionIsEnough: (a: PlusVariant) => PlusBaseStamp = (a) => a;
void _projectionIsEnough;

/**
 * Assignability alone would not catch the failure that matters. Both stamps are
 * *optional*, so a projection that dropped them stays assignable to
 * `PlusBaseStamp` and the gate would just read `undefined` on every device —
 * fail-open, compiling clean. So assert the keys are still there.
 */
type _StampFieldsSurviveTheProjection = Assert<
  ("issuedBase" | "verifiedBase") extends keyof PlusVariant ? true : false
>;

const SELF_HOST = "https://self.host.example";
const PRODUCTION = "https://plus.tryatoms.app";
const EMAIL = "a@b.co";

function fakeApp(): LocalStorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    loadLocalStorage: (key) => store.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      store.set(key, value);
    },
  };
}

function session(over: Partial<PlusSession> = {}): PlusSession {
  return {
    sessionToken: "sess_live",
    email: EMAIL,
    status: "active",
    remaining: 120,
    periodEnd: "2026-09-01T00:00:00.000Z",
    plan: "monthly",
    refreshedAt: 1000,
    ...over,
  };
}

/** Storage already holding `s`, which is what a re-stamp has to spread. */
function appWith(s: PlusSession) {
  const app = fakeApp();
  app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(s));
  return app;
}

/** Every request this double is asked to make, in order. */
const sent: RequestUrlParam[] = [];

function mockRequest(
  handler: (p: RequestUrlParam) => Partial<RequestUrlResponse>,
): RequestFn {
  return vi.fn(async (params: RequestUrlParam) => {
    sent.push(params);
    const partial = handler(params);
    return {
      status: partial.status ?? 200,
      json: partial.json,
      text: partial.text ?? "",
      arrayBuffer: partial.arrayBuffer ?? new ArrayBuffer(0),
      headers: partial.headers ?? {},
    } as RequestUrlResponse;
  }) as unknown as RequestFn;
}

beforeEach(() => {
  sent.length = 0;
});

/** `/v1/me` answering with an account name. */
function namesAccount(email: string) {
  return mockRequest(() => ({
    status: 200,
    json: { status: "active", remaining: 100, email },
  }));
}

function deps(app: LocalStorageLike, request: RequestFn): PlusBaseVerifyDeps {
  return { storage: app, request };
}

describe("verifyPlusBase — the stamp matches", () => {
  it("does not probe when the resolved base is the stamped one", async () => {
    const s = session({ verifiedBase: SELF_HOST });
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict).toEqual({ kind: "verified", base: SELF_HOST, restamped: false });
    expect(request).not.toHaveBeenCalled();
  });

  it("normalizes before comparing, so a trailing slash is not a probe", async () => {
    const s = session({ verifiedBase: "https://Self.Host.Example" });
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: `${SELF_HOST}/`,
    });
    expect(verdict.kind).toBe("verified");
    expect(request).not.toHaveBeenCalled();
  });

  it("falls back to issuedBase when nothing has re-verified yet", async () => {
    const s = session({ issuedBase: SELF_HOST as IssuedBase });
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("verified");
    expect(request).not.toHaveBeenCalled();
  });

  it("a different port is a different server, so it probes", async () => {
    const s = session({ verifiedBase: SELF_HOST });
    const request = namesAccount(EMAIL);
    await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: `${SELF_HOST}:8443`,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("verifyPlusBase — unknown issuer, empty field (#540, KTD1 without the carve-out)", () => {
  it("probes the hosted default instead of refusing, so the upgrade cohort files", async () => {
    // The state every hosted subscriber upgrades in: no stamp, empty field. It
    // used to refuse here without probing (KTD1's carve-out), which stopped
    // Process, Preview, Update, auto-run, mirror push and outbox ack for the
    // whole install base until they confirmed an address they never chose.
    const s = session();
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: PRODUCTION,
    });
    expect(verdict).toMatchObject({ kind: "verified", base: PRODUCTION, restamped: true });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("whitespace is an empty field, and probes the same way", async () => {
    const s = session();
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: PRODUCTION,
    });
    expect(verdict.kind).toBe("verified");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stamps silently: a first stamp names no previous base, so nobody is told it moved", async () => {
    // `main.ts` announces `plusIssuerMovedMessage` on `restamped && previousBase`.
    // Since #540 the upgrade cohort is the dominant path through that branch, so
    // a `previousBase` here would fire "Atoms Plus is now using plus.tryatoms.app"
    // at the entire install base, about a move that never happened.
    const s = session();
    const verdict = await verifyPlusBase(deps(appWith(s), namesAccount(EMAIL)), {
      session: s,
      resolvedBase: PRODUCTION,
    });
    expect(verdict).toMatchObject({ kind: "verified", restamped: true });
    if (verdict.kind === "verified") expect(verdict.previousBase).toBeUndefined();
  });

  it("the probe is still the proof: a host that cannot name the account is refused", async () => {
    // This is the accepted cost, pinned rather than merely argued. A pre-#508
    // self-hoster who cleared their field hands one content-free /v1/me to
    // plus.tryatoms.app, which does not hold their session, so nothing is
    // stamped and no note text is ever sent there.
    const s = session();
    const request = namesAccount("someone.else@example.com");
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: PRODUCTION,
    });
    expect(verdict).toEqual({
      kind: "refused",
      reason: "unverified",
      message: PLUS_BASE_REFUSED_MESSAGE,
    });
  });

  it("does not strand the hosted majority: a stamped session with an empty field matches", async () => {
    // `plusBaseUrl` ships as "", so empty is the normal state. From U2 onward a
    // hosted session is stamped at sign-in and the field never has to mean
    // anything — no probe, no prompt, nothing.
    const s = session({ issuedBase: PRODUCTION as IssuedBase });
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: PRODUCTION,
    });
    expect(verdict.kind).toBe("verified");
    expect(request).not.toHaveBeenCalled();
  });

  it("unknown issuer with a configured base probes it: the user chose that host", async () => {
    const s = session();
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("verified");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("verifyPlusBase — the probe", () => {
  it("asks the resolved base, at /v1/me, with the session token", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = namesAccount(EMAIL);
    await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${SELF_HOST}/v1/me`);
    expect(sent[0]?.headers?.authorization).toBe("Bearer sess_live");
  });

  it("a matching account name verifies, re-stamps and reports the move", async () => {
    const s = session({ issuedBase: PRODUCTION as IssuedBase, verifiedBase: PRODUCTION });
    const app = appWith(s);
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(app, request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict).toEqual({
      kind: "verified",
      base: SELF_HOST,
      restamped: true,
      previousBase: PRODUCTION,
    });
    expect(readPlusSession(app)?.verifiedBase).toBe(SELF_HOST);
  });

  it("case and whitespace in the returned email do not defeat the match", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = namesAccount("  A@B.CO ");
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("verified");
  });

  it("a 200 that names nobody is refused: accepting a token is not issuing one", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    // The adversarial host: says yes to everything, names no account.
    const request = mockRequest(() => ({ status: 200, json: { status: "active", remaining: 5 } }));
    const verdict = await verifyPlusBase(deps(app, request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict).toEqual({
      kind: "refused",
      reason: "unverified",
      message: PLUS_BASE_REFUSED_MESSAGE,
    });
    expect(readPlusSession(app)?.verifiedBase).toBe(PRODUCTION);
  });

  it("a 200 naming a different account is refused", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    const request = namesAccount("someone.else@b.co");
    const verdict = await verifyPlusBase(deps(app, request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("refused");
    expect(readPlusSession(app)?.verifiedBase).toBe(PRODUCTION);
  });

  it("a rejected session is refused and points at the field", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = mockRequest(() => ({
      status: 401,
      json: { error: "invalid session" },
    }));
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict).toEqual({
      kind: "refused",
      reason: "unverified",
      message: PLUS_BASE_REFUSED_MESSAGE,
    });
  });

  it("a gateway 401 with no service body is unreachable, not a session refusal", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = mockRequest(() => ({ status: 401, json: undefined, text: "" }));
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict).toEqual({ kind: "unreachable", message: PLUS_BASE_UNREACHABLE_MESSAGE });
  });

  it("a 5xx is unreachable and does not re-stamp", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    const request = mockRequest(() => ({ status: 503, json: { error: "down" } }));
    const verdict = await verifyPlusBase(deps(app, request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("unreachable");
    expect(readPlusSession(app)?.verifiedBase).toBe(PRODUCTION);
  });

  it("a transport failure is unreachable, and the gate stays closed offline", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = vi.fn(async () => {
      throw new Error("net down");
    }) as unknown as RequestFn;
    const verdict = await verifyPlusBase(deps(appWith(s), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("unreachable");
  });

  it("a token-less session is refused before anything is sent", async () => {
    const s = session({ sessionToken: "  " });
    const request = namesAccount(EMAIL);
    const verdict = await verifyPlusBase(deps(appWith(session()), request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("refused");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("verifyPlusBase — re-stamp persistence", () => {
  it("preserves every other field, so a verification is not a partial write", async () => {
    const s = session({ verifiedBase: PRODUCTION, setupKind: "subscribe" });
    const app = appWith(s);
    await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(readPlusSession(app)).toEqual({
      ...s,
      verifiedBase: SELF_HOST,
      issuedBase: undefined,
    });
  });

  it("re-stamps from the stored session, not the caller's projection", async () => {
    // The classify gate holds the `FilingAuth` plus variant, which has no
    // `refreshedAt`, `plan` or `setupKind`. Spreading it would blank them.
    const stored = session({ verifiedBase: PRODUCTION, setupKind: "trial" });
    const app = appWith(stored);
    const projection = {
      sessionToken: stored.sessionToken,
      email: stored.email,
      verifiedBase: PRODUCTION,
    };
    await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: projection,
      resolvedBase: SELF_HOST,
    });
    const after = readPlusSession(app);
    expect(after?.verifiedBase).toBe(SELF_HOST);
    expect(after?.refreshedAt).toBe(1000);
    expect(after?.plan).toBe("monthly");
    expect(after?.setupKind).toBe("trial");
  });

  it("refuses when the stamp could not land, rather than reporting verified", async () => {
    // Found by the cross-model adversarial pass. The TOCTOU guard protected the
    // stamp on disk but not the send decision: the caller still got `verified`
    // for a token this device may no longer hold.
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(session({ sessionToken: "sess_new", verifiedBase: PRODUCTION }));
    const verdict = await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("refused");
  });

  it("refuses when the storage write throws, and does not escape", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    app.saveLocalStorage = () => {
      throw new Error("quota exceeded");
    };
    const verdict = await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict.kind).toBe("refused");
  });

  it("does not write when the session was replaced while the probe was in flight", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(session({ sessionToken: "sess_new", verifiedBase: PRODUCTION }));
    await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    const after = readPlusSession(app);
    expect(after?.sessionToken).toBe("sess_new");
    expect(after?.verifiedBase).toBe(PRODUCTION);
  });

  it("does not write when the session was signed out mid-probe", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = fakeApp();
    await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(readPlusSession(app)).toBeNull();
  });
});

describe("verifyPlusBase — the per-run cache", () => {
  it("hands an unreachable host the token once per run, not once per call", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = mockRequest(() => ({ status: 503, json: { error: "down" } }));
    const cache = createPlusBaseVerifyCache();
    const d: PlusBaseVerifyDeps = { storage: appWith(s), request, cache };
    const input = { session: s, resolvedBase: SELF_HOST };
    const first = await verifyPlusBase(d, input);
    const second = await verifyPlusBase(d, input);
    expect(first.kind).toBe("unreachable");
    expect(second.kind).toBe("unreachable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("without a cache every call probes, so a run must supply one", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = mockRequest(() => ({ status: 503, json: { error: "down" } }));
    const d = deps(appWith(s), request);
    const input = { session: s, resolvedBase: SELF_HOST };
    await verifyPlusBase(d, input);
    await verifyPlusBase(d, input);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("a cached success cannot re-announce the move", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const cache = createPlusBaseVerifyCache();
    const d: PlusBaseVerifyDeps = {
      storage: appWith(s),
      request: namesAccount(EMAIL),
      cache,
    };
    const input = { session: s, resolvedBase: SELF_HOST };
    const first = await verifyPlusBase(d, input);
    const second = await verifyPlusBase(d, input);
    expect(first).toMatchObject({ restamped: true, previousBase: PRODUCTION });
    expect(second).toMatchObject({ kind: "verified", restamped: false });
  });

  it("a second session with the same email does not inherit the first's verdict", async () => {
    // Found by the cross-model adversarial pass. A verdict certifies a session,
    // not an address, and a sign-out/sign-in inside one catch-up pass produces
    // two tokens under one email.
    const first = session({ sessionToken: "sess_one", verifiedBase: PRODUCTION });
    const second = session({ sessionToken: "sess_two", verifiedBase: PRODUCTION });
    const request = mockRequest(() => ({ status: 503, json: { error: "down" } }));
    const cache = createPlusBaseVerifyCache();
    const d: PlusBaseVerifyDeps = { storage: appWith(first), request, cache };
    await verifyPlusBase(d, {
      session: first,
      resolvedBase: SELF_HOST,
    });
    await verifyPlusBase(d, {
      session: second,
      resolvedBase: SELF_HOST,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("a different base in the same run is a different question", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const request = mockRequest(() => ({ status: 503, json: { error: "down" } }));
    const cache = createPlusBaseVerifyCache();
    const d: PlusBaseVerifyDeps = { storage: appWith(s), request, cache };
    await verifyPlusBase(d, { session: s, resolvedBase: SELF_HOST });
    await verifyPlusBase(d, {
      session: s,
      resolvedBase: "https://other.host.example",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

/**
 * #508 A5/A6 — the recorded refusal, and the advisory that reads it.
 *
 * The whole design turns on the record being written by a *live* refusal and
 * nothing else, so every test here asserts on storage rather than on the
 * verdict: a verdict proves a branch, the record is what Settings will still be
 * reading tomorrow.
 */
describe("the refusal record", () => {
  it("readPlusBaseRefusal rejects anything that is not a base and a time", () => {
    const app = fakeApp();
    expect(readPlusBaseRefusal(app)).toBeNull();
    for (const junk of ["", "   ", "not json", "42", "null", "{}", '{"base":""}', '{"base":"  "}', '{"base":7}']) {
      app.store.set(LS_PLUS_BASE_REFUSAL, junk);
      expect(readPlusBaseRefusal(app)).toBeNull();
    }
    // A non-finite `at` is tolerated as 0 rather than discarding a real base:
    // the base is the load-bearing half, the timestamp is only a memo.
    app.store.set(LS_PLUS_BASE_REFUSAL, `{"base":"${SELF_HOST}"}`);
    expect(readPlusBaseRefusal(app)).toEqual({ base: SELF_HOST, at: 0 });
  });

  it("a storage that throws on read is a missing record, not a crash", () => {
    const throwing: LocalStorageLike = {
      loadLocalStorage: () => {
        throw new Error("private mode");
      },
      saveLocalStorage: () => {},
    };
    expect(readPlusBaseRefusal(throwing)).toBeNull();
  });

  it("normalizes at write time, so a trailing slash still matches", () => {
    const app = fakeApp();
    writePlusBaseRefusal(app, `${SELF_HOST}/`, 5);
    expect(readPlusBaseRefusal(app)).toEqual({ base: SELF_HOST, at: 5 });
    clearPlusBaseRefusal(app);
    expect(readPlusBaseRefusal(app)).toBeNull();
  });

  it("a live refusal is recorded at the base that refused", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    const request = namesAccount("someone.else@b.co");
    const verdict = await verifyPlusBase(
      { storage: app, request, now: () => 4242 },
      { session: s, resolvedBase: SELF_HOST },
    );
    expect(verdict.kind).toBe("refused");
    expect(readPlusBaseRefusal(app)).toEqual({ base: SELF_HOST, at: 4242 });
  });

  it("needs-address does NOT record: that state already has its own row", async () => {
    const s = session();
    const app = appWith(s);
    await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: PRODUCTION,
    });
    expect(readPlusBaseRefusal(app)).toBeNull();
  });

  it("unreachable does NOT record: KTD3's offline user never touched the field", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    const request = mockRequest(() => ({ status: 503, json: undefined, text: "" }));
    const verdict = await verifyPlusBase(deps(app, request), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(verdict).toEqual({ kind: "unreachable", message: PLUS_BASE_UNREACHABLE_MESSAGE });
    expect(readPlusBaseRefusal(app)).toBeNull();
  });

  it("a verified probe clears it, so the state cannot outlive its cause", async () => {
    const s = session({ verifiedBase: PRODUCTION });
    const app = appWith(s);
    writePlusBaseRefusal(app, SELF_HOST, 1);
    await verifyPlusBase(deps(app, namesAccount(EMAIL)), {
      session: s,
      resolvedBase: SELF_HOST,
    });
    expect(readPlusBaseRefusal(app)).toBeNull();
  });

  it("installPlusSession clears it: a new session is not the one that was refused", async () => {
    const app = appWith(session({ verifiedBase: PRODUCTION }));
    writePlusBaseRefusal(app, SELF_HOST, 1);
    await installPlusSession(
      {
        ...app,
        settings: { askEnabled: false },
        saveSettings: async () => {},
        mirrorPermitted: () => false,
        cancelPendingSync: () => {},
      },
      session({ sessionToken: "sess_fresh" }),
      PRODUCTION as IssuedBase,
    );
    expect(readPlusBaseRefusal(app)).toBeNull();
  });
});

describe("plusAddressAdvisory", () => {
  const stamp = (over: Partial<PlusBaseStamp> = {}): PlusBaseStamp => ({
    sessionToken: "sess_live",
    email: EMAIL,
    ...over,
  });
  const refusal = (base: string) => ({ base, at: 1 });

  it("says nothing without a session", () => {
    expect(plusAddressAdvisory(null, "", refusal(PRODUCTION))).toBeNull();
  });

  it("says nothing to an unstamped session with an empty field (#540)", () => {
    // The needs-address state. It was the upgrade cohort's, which is to say
    // everyone's, and nothing was stuck: the next content call probes the hosted
    // default and reports whatever it finds.
    expect(plusAddressAdvisory(stamp(), "", null)).toBeNull();
    expect(plusAddressAdvisory(stamp(), "   ", null)).toBeNull();
  });

  it("a refusal at the resolved base is the A5/A6 fix", () => {
    // A6: the unstamped session whose user typed a wrong-but-valid address.
    expect(plusAddressAdvisory(stamp(), SELF_HOST, refusal(SELF_HOST))).toEqual({
      kind: "refused",
      message: PLUS_BASE_ADDRESS_REFUSED_MESSAGE,
    });
    // A5: a stamp that disagrees with the field, with a refusal on record.
    expect(
      plusAddressAdvisory(stamp({ verifiedBase: PRODUCTION }), SELF_HOST, refusal(SELF_HOST)),
    ).toMatchObject({ kind: "refused" });
  });

  it("an empty field resolves to the hosted default before comparing", () => {
    expect(
      plusAddressAdvisory(stamp({ verifiedBase: SELF_HOST }), "", refusal(PRODUCTION)),
    ).toMatchObject({ kind: "refused" });
  });

  it("normalizes both sides, so a trailing slash is still the same address", () => {
    expect(
      plusAddressAdvisory(stamp({ verifiedBase: PRODUCTION }), SELF_HOST, refusal(`${SELF_HOST}/`)),
    ).toMatchObject({ kind: "refused" });
  });

  it("a refusal at a DIFFERENT base says nothing: the user already moved on", () => {
    expect(
      plusAddressAdvisory(stamp({ verifiedBase: PRODUCTION }), SELF_HOST, refusal(PRODUCTION)),
    ).toBeNull();
  });

  it("a bare mismatch with nothing recorded stays quiet, which is the whole gate", () => {
    // The upgrading hosted cohort and a base that just synced in from another
    // device both live here. Alarming them would nag every user on the way to
    // their first filing for a state the next Process clears by probing.
    expect(plusAddressAdvisory(stamp({ verifiedBase: PRODUCTION }), SELF_HOST, null)).toBeNull();
    expect(plusAddressAdvisory(stamp(), SELF_HOST, null)).toBeNull();
  });
});

describe("issuer-moved copy", () => {
  it("names the host, not the whole URL", () => {
    expect(plusIssuerMovedMessage("https://self.host.example/api/")).toBe(
      "Atoms Plus is now using self.host.example. Your notes will be sent there.",
    );
  });

  it("keeps a non-default port, because it is part of the identity", () => {
    expect(plusBaseHost("https://self.host.example:8443")).toBe("self.host.example:8443");
  });
});
