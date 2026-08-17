/**
 * #508 adversarial (chaos-user) pass. Each `describe` is one attack from the
 * QA attack list. Tests that FAIL here are proven holes in the issuer gate;
 * tests that pass are recorded so the ledger's "solid" verdicts have evidence.
 */
import { describe, expect, it } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  parsePlusSession,
  readPlusSession,
  resolveFilingAuth,
  serializePlusSession,
  LS_PLUS_SESSION,
  type IssuedBase,
  type LocalStorageLike,
  type PlusSession,
} from "../src/platform/filingAuth";
import { installPlusSession } from "../src/platform/plusSessionInstall";
import {
  normalizePlusBase,
  plusBaseMatches,
  type RequestFn,
} from "../src/platform/plusClient";
import {
  plusRefreshPresentation,
  plusRefreshRowRecord,
  refreshPlusEntitlementRecord,
  LS_PLUS_LAST_REFRESH,
} from "../src/platform/plusRefresh";
import {
  plusAddressAdvisory,
  plusAddressStateMessage,
  plusSessionStamp,
  verifyPlusBase,
  PLUS_BASE_ADDRESS_REFUSED_MESSAGE,
} from "../src/platform/plusBaseVerify";
import { resolveClassifyAuth } from "../src/platform/classifyAuth";

const BASE_X = "http://127.0.0.1:8787";
const BASE_Y = "http://127.0.0.1:8799";

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
    sessionToken: "sess_qa508",
    email: "qa508@example.com",
    status: "active",
    remaining: 50,
    periodEnd: "2026-12-01T00:00:00.000Z",
    plan: "monthly",
    refreshedAt: 1000,
    issuedBase: BASE_X as IssuedBase,
    verifiedBase: BASE_X,
    ...over,
  };
}

function appWith(s: PlusSession) {
  const app = fakeApp();
  app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(s));
  return app;
}

function mockRequest(
  handler: (p: RequestUrlParam) => Partial<RequestUrlResponse>,
): RequestFn {
  return async (params) => {
    const r = handler(params);
    return {
      status: r.status ?? 200,
      json: r.json ?? {},
      text: r.text ?? JSON.stringify(r.json ?? {}),
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse;
  };
}

/**
 * A base that answers /v1/me with a service-shaped 401 — the exact body the
 * plugin reads as `code: "auth"` ("invalid session" / "expired" markers,
 * plusClient.ts:143). This is what any plus-service instance says to a token
 * it did not mint.
 */
const refusing401 = mockRequest(() => ({
  status: 401,
  json: { error: "unauthorized", message: "invalid session" },
}));

/* ------------------------------------------------------------------ A4 --- */

describe("A4 — a base that refused the session must not be handed the sign-in CTA", () => {
  it("a 401 from a base the session was NOT issued by must not offer a sign-in link at that base", async () => {
    const s = session(); // stamped at BASE_X
    const app = appWith(s);

    // Settings' Refresh status is content-free and therefore ungated: it goes
    // to whatever `plusBaseUrl` says. Here that is BASE_Y, which never issued
    // this session and says so.
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: BASE_Y, request: refusing401 },
      s,
    );

    const view = plusRefreshPresentation(record);

    // `plusRefresh.ts:186-199` already refuses to offer this CTA when a live
    // base names a *different account*, with the reasoning that redeeming the
    // link runs `installPlusSession` and stamps that host as the issuer with
    // the gate never running. A 401 from a base the session is not stamped at
    // has the identical consequence and was not given the identical treatment.
    expect(plusSessionStamp(s)).toBe(normalizePlusBase(BASE_X));
    expect(plusBaseMatches(plusSessionStamp(s), BASE_Y)).toBe(false);

    // What we want: no laundering door at a base that just refused and never
    // issued this session.
    expect(view.recovery).toBeNull();
    expect(record.kind).not.toBe("rejected");
  });

  it("control: a 401 from the base that DID issue the session is a real expiry and should keep its CTA", async () => {
    const s = session();
    const app = appWith(s);
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: BASE_X, request: refusing401 },
      s,
    );
    expect(record.kind).toBe("rejected");
    expect(plusRefreshPresentation(record).recovery).toBe("magic-link");
  });
});

/* ------------------------------------------------------------------ A7 --- */

describe("A7 — a stale 'rejected' refresh record survives a successful re-link", () => {
  it("installPlusSession clears the refresh record, so a fresh sign-in never inherits 'Sign-in needed'", async () => {
    const s = session();
    const app = appWith(s);

    // 1. A refresh against a refusing base writes a `rejected` record.
    const rejected = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: BASE_X, request: refusing401 },
      s,
    );
    expect(rejected.kind).toBe("rejected");

    // 2. The user presses "Send me a sign-in link", opens it, and the
    //    magic-link resume installs a fresh session through the shared
    //    boundary (`plugin.installPlusSession` -> `installPlusSession`).
    //    Unlike the paste-a-session path (settings.ts:2808) and both sign-out
    //    paths (settings.ts:2160, :2190), this boundary never clears the record.
    await installPlusSession(
      {
        ...app,
        settings: { askMirrorEnabled: false } as never,
        saveSettings: async () => {},
        mirrorPermitted: () => false,
        cancelPendingSync: () => {},
      } as never,
      session({ sessionToken: "sess_fresh", refreshedAt: 2000 }),
      BASE_X as IssuedBase,
    );

    expect(readPlusSession(app)?.sessionToken).toBe("sess_fresh");

    // 3. The row is keyed only on "is there a session", so it renders the
    //    dead record against the brand-new session.
    const row = plusRefreshRowRecord(app);
    expect(row?.kind).not.toBe("rejected");
    expect(row && plusRefreshPresentation(row).recovery).not.toBe("magic-link");
  });

  it("a re-link to a different account never leaves a CTA aimed at the departed address", async () => {
    const s = session({ email: "old@example.com" });
    const app = appWith(s);
    await refreshPlusEntitlementRecord(
      app,
      { baseUrl: BASE_X, request: refusing401 },
      s,
    );
    await installPlusSession(
      {
        ...app,
        settings: { askMirrorEnabled: false } as never,
        saveSettings: async () => {},
        mirrorPermitted: () => false,
        cancelPendingSync: () => {},
      } as never,
      session({ sessionToken: "sess_new", email: "new@example.com" }),
      BASE_X as IssuedBase,
    );
    const row = plusRefreshRowRecord(app);
    // Asserts the invariant, not one particular remedy. `installPlusSession`
    // clears the record, so there is no row and no CTA at all; re-stamping it
    // with the incoming session would satisfy this too. What must never happen
    // is a rendered CTA carrying the address of the account that just left --
    // the row's magic link is sent to whatever `record.email` says. Before the
    // fix `row.email` was "old@example.com" and both assertions went red.
    expect(row?.email).not.toBe("old@example.com");
    expect(row && plusRefreshPresentation(row).recovery).not.toBe("magic-link");
  });

  it("control: sign-out clears the record, so sign-OUT then sign-in is clean", () => {
    const app = appWith(session());
    app.saveLocalStorage(
      LS_PLUS_LAST_REFRESH,
      JSON.stringify({ kind: "rejected", message: "x", at: 1 }),
    );
    // What signOutOfPlus does: clearPlusSession + clearPlusRefreshRecord.
    app.saveLocalStorage(LS_PLUS_SESSION, "");
    app.saveLocalStorage(LS_PLUS_LAST_REFRESH, "");
    expect(plusRefreshRowRecord(app)).toBeNull();
  });
});

/* ------------------------------------------- A1 / A2 / A3 / A13 / A16 --- */

describe("A1 — corrupt stamps off disk", () => {
  const garbage: unknown[] = [
    123,
    "",
    null,
    "   ",
    { deep: { nested: { obj: 1 } } },
    true,
    [],
    "x".repeat(10240),
  ];
  it("never reads as a match against a real base", () => {
    for (const v of garbage) {
      const parsed = parsePlusSession({
        sessionToken: "t",
        email: "a@b.co",
        issuedBase: v,
        verifiedBase: v,
      });
      expect(parsed).not.toBeNull();
      expect(plusBaseMatches(plusSessionStamp(parsed!), BASE_X)).toBe(false);
      expect(plusBaseMatches(plusSessionStamp(parsed!), "")).toBe(false);
    }
  });
  it("a non-URL string stamp is kept verbatim and still refuses", () => {
    const parsed = parsePlusSession({
      sessionToken: "t",
      email: "a@b.co",
      issuedBase: "not-a-url",
    });
    expect(parsed?.issuedBase).toBe("not-a-url");
    expect(plusBaseMatches("not-a-url", BASE_X)).toBe(false);
  });
});

describe("A2 — normalization boundaries (KTD2)", () => {
  const sameServer: [string, string][] = [
    ["HTTPS://H.COM", "https://h.com"],
    ["https://h.com/", "https://h.com"],
    ["https://h.com:443", "https://h.com"],
    ["http://h.com:80", "http://h.com"],
    ["https://user:pw@h.com", "https://h.com"],
    ["https://h.com/a/..", "https://h.com"],
    ["http://127.0.0.1:8787/", "http://127.0.0.1:8787"],
  ];
  const differentServer: [string, string][] = [
    ["https://h.com", "https://h.com.evil.net"],
    ["https://h.com", "https://h.com:8443"],
    ["https://h.com", "http://h.com"],
    ["https://h.com/path", "https://h.com/PATH"],
    ["https://plus.tryatoms.app", "https://plus.tryatoms.app.evil.net"],
    ["https://plus.tryatoms.app", "https://plus-tryatoms.app"],
  ];
  it("equal only when the same server", () => {
    for (const [a, b] of sameServer) expect(plusBaseMatches(a, b)).toBe(true);
  });
  it("never equal across different servers (fail-open check)", () => {
    for (const [a, b] of differentServer)
      expect(plusBaseMatches(a, b)).toBe(false);
  });
  it("userinfo cannot smuggle a host: the real host wins", () => {
    expect(normalizePlusBase("https://plus.tryatoms.app@evil.net")).toBe(
      "https://evil.net",
    );
    expect(plusBaseMatches("https://plus.tryatoms.app", "https://plus.tryatoms.app@evil.net")).toBe(false);
  });
});

describe("A3 — the stamp survives disk -> parse -> filingAuth -> classifyAuth", () => {
  it("reaches the gate with both stamps intact", async () => {
    const app = appWith(session());
    const parsed = readPlusSession(app);
    const filing = resolveFilingAuth({ byokApiKey: null, plusSession: parsed });
    expect(filing.mode).toBe("plus");
    let seen: { issuedBase?: string; verifiedBase?: string } | null = null;
    await resolveClassifyAuth(filing, {
      plusBaseUrl: BASE_X,
      verifyBase: async (i) => {
        seen = { issuedBase: i.session.issuedBase, verifiedBase: i.session.verifiedBase };
        return { kind: "verified", base: BASE_X, restamped: false };
      },
    });
    expect(seen).toEqual({ issuedBase: BASE_X, verifiedBase: BASE_X });
  });
});

describe("A13 — the email predicate is defeated by a host that echoes the address", () => {
  it("documented limitation: an echoing host is ACCEPTED and becomes the stamped issuer", async () => {
    const app = appWith(session());
    const echo = mockRequest(() => ({
      status: 200,
      json: { email: "qa508@example.com", status: "active", remaining: 50 },
    }));
    const verdict = await verifyPlusBase(
      { storage: app, request: echo },
      { session: session(), resolvedBase: BASE_Y, configuredBase: BASE_Y },
    );
    expect(verdict.kind).toBe("verified");
    expect(readPlusSession(app)?.verifiedBase).toBe(normalizePlusBase(BASE_Y));
    // issuedBase is immutable — the audit trail survives the takeover.
    expect(readPlusSession(app)?.issuedBase).toBe(BASE_X);
  });
  it("a host that does NOT know the address is refused", async () => {
    const app = appWith(session());
    const wrong = mockRequest(() => ({
      status: 200,
      json: { email: "someone@else.net", status: "active", remaining: 50 },
    }));
    const verdict = await verifyPlusBase(
      { storage: app, request: wrong },
      { session: session(), resolvedBase: BASE_Y, configuredBase: BASE_Y },
    );
    expect(verdict.kind).toBe("refused");
    expect(readPlusSession(app)?.verifiedBase).toBe(BASE_X);
  });
});

describe("A16 — one stamp present, the other absent", () => {
  it("issuedBase only: matches its own base, refuses another", () => {
    const s = session({ verifiedBase: undefined });
    expect(plusSessionStamp(s)).toBe(BASE_X);
    expect(plusBaseMatches(plusSessionStamp(s), BASE_Y)).toBe(false);
  });
  it("verifiedBase only: verifiedBase wins", () => {
    const s = session({ issuedBase: undefined, verifiedBase: BASE_Y });
    expect(plusSessionStamp(s)).toBe(BASE_Y);
  });
  it("neither: unknown, and with an empty field it is needs-address", () => {
    const s = session({ issuedBase: undefined, verifiedBase: undefined });
    expect(plusSessionStamp(s)).toBe("");
    expect(plusAddressStateMessage(s, "")).not.toBe("");
  });
});

/* ------------------------------------------------------------- A6 / A11 --- */

describe("A6 — the recovery row follows a recorded refusal, not an empty field", () => {
  // FIXED. This used to pin the gap: the row keyed only on an empty field, so a
  // user who typed a wrong-but-valid address lost it and the only way back was
  // to guess that CLEARING the field re-summons it. `plusAddressAdvisory` now
  // widens it to a base that has actually refused. The predicate deliberately
  // stops there — see the second test, which is what keeps the fix from
  // becoming a nag.
  it("an unstamped session with a WRONG but valid base gets the row back once that base refuses", () => {
    const upgrade = session({ issuedBase: undefined, verifiedBase: undefined });
    // The upgrade cohort's rescue row.
    expect(plusAddressAdvisory(upgrade, "", null)).toMatchObject({ kind: "needs-address" });
    // They type a wrong-but-valid address under Advanced instead of pressing it.
    // Every Process now refuses at BASE_Y and records it.
    expect(plusAddressAdvisory(upgrade, BASE_Y, { base: BASE_Y, at: 1 })).toEqual({
      kind: "refused",
      message: PLUS_BASE_ADDRESS_REFUSED_MESSAGE,
    });
  });

  it("but before anything has refused, it stays quiet: the transient state must not nag", () => {
    const upgrade = session({ issuedBase: undefined, verifiedBase: undefined });
    // Unstamped with a base that may well be right. The next Process probes and
    // stamps for real; alarming here would hit every upgrading hosted user
    // before their first filing.
    expect(plusAddressAdvisory(upgrade, BASE_Y, null)).toBeNull();
    // And a refusal recorded at some *other* address is not about this one.
    expect(plusAddressAdvisory(upgrade, BASE_Y, { base: BASE_X, at: 1 })).toBeNull();
  });
});

describe("A11 — re-probe ping-pong after a re-stamp", () => {
  it("setting the base back to the ORIGINAL issuer re-probes and re-announces a move", async () => {
    const app = appWith(session()); // issued+verified at X
    const ok = mockRequest(() => ({
      status: 200,
      json: { email: "qa508@example.com", status: "active", remaining: 50 },
    }));
    // Move to Y.
    const v1 = await verifyPlusBase(
      { storage: app, request: ok },
      { session: readPlusSession(app)!, resolvedBase: BASE_Y, configuredBase: BASE_Y },
    );
    expect(v1).toMatchObject({ kind: "verified", restamped: true, previousBase: BASE_X });
    // Now back to X — the base that actually issued this session.
    const v2 = await verifyPlusBase(
      { storage: app, request: ok },
      { session: readPlusSession(app)!, resolvedBase: BASE_X, configuredBase: BASE_X },
    );
    // A second network probe and a second "issuer moved" Notice, for the
    // session's own original issuer. Recorded, not asserted as correct.
    expect(v2).toMatchObject({ kind: "verified", restamped: true, previousBase: BASE_Y });
  });
});

/* ------------------------------------------------------------ A9 / A10 --- */

describe("A9/A10 — concurrent probe and refresh must not lose the other's write", () => {
  it("a probe landing mid-refresh keeps both verifiedBase and the new meter", async () => {
    const app = appWith(session({ remaining: 50 }));
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slowOk: RequestFn = async () => {
      await gate;
      return {
        status: 200,
        json: { email: "qa508@example.com", status: "active", remaining: 7 },
        text: "",
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      } as RequestUrlResponse;
    };
    const fastOk = mockRequest(() => ({
      status: 200,
      json: { email: "qa508@example.com", status: "active", remaining: 50 },
    }));
    const refreshP = refreshPlusEntitlementRecord(
      app,
      { baseUrl: BASE_X, request: slowOk },
      readPlusSession(app)!,
    );
    const verifyP = verifyPlusBase(
      { storage: app, request: fastOk },
      { session: readPlusSession(app)!, resolvedBase: BASE_Y, configuredBase: BASE_Y },
    );
    await verifyP;
    release!();
    await refreshP;
    const after = readPlusSession(app)!;
    expect(after.verifiedBase).toBe(normalizePlusBase(BASE_Y));
    expect(after.remaining).toBe(7);
  });
});
