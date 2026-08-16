import { describe, expect, it } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  clearPlusSession,
  readPlusSession,
  serializePlusSession,
  LS_PLUS_SESSION,
  type IssuedBase,
  type LocalStorageLike,
  type PlusSession,
} from "../src/platform/filingAuth";
import {
  upstreamRefusedMessage,
  PLUS_BASE_REFUSED_MESSAGE,
  type RequestFn,
} from "../src/platform/plusClient";
import {
  clearPlusRefreshRecord,
  plusRefreshPresentation,
  plusRefreshRowRecord,
  readPlusRefreshRecord,
  refreshPlusEntitlementRecord,
  PLUS_REFRESH_REJECTED_MESSAGE,
  PLUS_REFRESH_SAVE_FAILED_MESSAGE,
  PLUS_REFRESH_SESSION_CHANGED_MESSAGE,
  PLUS_REFRESH_UNREACHABLE_MESSAGE,
} from "../src/platform/plusRefresh";

/** Device-local storage double — same shape settings/plusResume pass in. */
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

const live: PlusSession = {
  sessionToken: "sess_live",
  email: "a@b.co",
  status: "trialing",
  remaining: 150,
  periodEnd: "2026-08-15T00:00:00.000Z",
  refreshedAt: 1000,
};

function appWithLiveSession() {
  const app = fakeApp();
  app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(live));
  return app;
}

function mockRequest(
  handler: (p: RequestUrlParam) => Partial<RequestUrlResponse>,
): RequestFn {
  return async (params) => {
    const partial = handler(params);
    return {
      status: partial.status ?? 200,
      json: partial.json,
      text: partial.text ?? "",
      arrayBuffer: partial.arrayBuffer ?? new ArrayBuffer(0),
      headers: partial.headers ?? {},
    } as RequestUrlResponse;
  };
}

const base = "https://plus.test";

describe("plusRefresh", () => {
  it("confirmed entitlement updates the session and records a success time", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 120, email: "a@b.co" },
    }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("ok");
    expect(record.lastOkAt).toBe(5000);
    expect(readPlusSession(app)?.status).toBe("active");
    expect(readPlusSession(app)?.remaining).toBe(120);
  });

  /**
   * #508 U1. This is one of two mutation paths that write a session without
   * going through `installPlusSession`. It spreads the existing session today,
   * so the issuer stamp survives — but a future refactor to a fresh object
   * literal would blank it, and an unstamped session fails the gate open.
   */
  it("a refresh preserves the issuer stamp it did not set", async () => {
    const app = fakeApp();
    const stamped: PlusSession = {
      ...live,
      issuedBase: "https://my.host" as IssuedBase,
      verifiedBase: "https://my.host",
    };
    app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(stamped));
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 120, email: "a@b.co" },
    }));

    await refreshPlusEntitlementRecord(app, { baseUrl: base, request }, stamped, 5000);

    expect(readPlusSession(app)?.issuedBase).toBe("https://my.host");
    expect(readPlusSession(app)?.verifiedBase).toBe("https://my.host");
  });

  it("401 records a rejected session and offers the sign-in link recovery", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 401,
      json: { message: "Invalid session" },
    }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("rejected");
    expect(record.message).toBe(PLUS_REFRESH_REJECTED_MESSAGE);
    expect(record.email).toBe("a@b.co");
    expect(plusRefreshPresentation(record).recovery).toBe("magic-link");
    // The token stays: the user may recover it with a fresh link, not a wipe.
    expect(readPlusSession(app)).toEqual(live);
  });

  it("network failure records a transport problem and preserves the session", async () => {
    const app = appWithLiveSession();
    const request: RequestFn = async () => {
      throw new Error("offline");
    };
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("failed");
    expect(record.message).toBe(PLUS_REFRESH_UNREACHABLE_MESSAGE);
    expect(record.message.toLowerCase()).not.toContain("sign in");
    expect(plusRefreshPresentation(record).recovery).toBeNull();
    expect(readPlusSession(app)).toEqual(live);
  });

  it("unparseable 200 is an error — stored session is unchanged", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: undefined,
      text: "<html>gateway</html>",
    }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("failed");
    expect(readPlusSession(app)).toEqual(live);
  });

  it("partial 200 (no remaining) never downgrades a trialing session", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: { email: "a@b.co" },
    }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("failed");
    expect(readPlusSession(app)).toEqual(live);
  });

  it("gateway 403 with no service body is not blamed on the session", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 403,
      json: undefined,
      text: "<html>Forbidden</html>",
    }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("failed");
    expect(record.message).toBe(upstreamRefusedMessage(403));
    expect(record.message.toLowerCase()).not.toContain("sign in");
    expect(plusRefreshPresentation(record).recovery).toBeNull();
    expect(readPlusSession(app)).toEqual(live);
  });

  it("403 for missing entitlement keeps the service sentence and offers no sign-in", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 403,
      json: { message: "Plus entitlement required for Ask mirror" },
    }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );
    expect(record.kind).toBe("failed");
    expect(record.message).toBe("Plus entitlement required for Ask mirror");
    expect(plusRefreshPresentation(record).recovery).toBeNull();
    expect(readPlusSession(app)).toEqual(live);
  });

  it("signing out leaves no stale row and no CTA bound to the old email", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 401,
      json: { message: "Invalid session" },
    }));
    await refreshPlusEntitlementRecord(app, { baseUrl: base, request }, live, 5000);
    expect(plusRefreshRowRecord(app)?.kind).toBe("rejected");

    clearPlusSession(app);
    clearPlusRefreshRecord(app);
    expect(readPlusRefreshRecord(app)).toBeNull();
    expect(plusRefreshRowRecord(app)).toBeNull();
  });

  it("a record without a session is never rendered, even if clearing was missed", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 401,
      json: { message: "Invalid session" },
    }));
    await refreshPlusEntitlementRecord(app, { baseUrl: base, request }, live, 5000);
    clearPlusSession(app);
    expect(readPlusRefreshRecord(app)?.email).toBe("a@b.co");
    expect(plusRefreshRowRecord(app)).toBeNull();
  });

  it("a failed check keeps the previous successful timestamp", async () => {
    const app = appWithLiveSession();
    const ok = mockRequest(() => ({
      status: 200,
      json: { status: "trialing", remaining: 150 },
    }));
    await refreshPlusEntitlementRecord(app, { baseUrl: base, request: ok }, live, 5000);
    const down = mockRequest(() => ({ status: 500, json: {} }));
    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request: down },
      live,
      9000,
    );
    expect(record.kind).toBe("failed");
    expect(record.lastOkAt).toBe(5000);
    expect(readPlusRefreshRecord(app)?.lastOkAt).toBe(5000);
    expect(plusRefreshPresentation(record, () => "T").detail).toContain(
      "Last confirmed T.",
    );
  });
});

/**
 * #508 P0, found by the cross-model/security review.
 *
 * The issuer gate's whole claim is that only the server that minted an opaque
 * token can name the account it belongs to. `refreshPlusEntitlementRecord` is
 * content-free and therefore ungated, so it goes to whatever base is
 * configured -- and it used to adopt the address that base returned into the
 * stored session. That handed a rogue base the pen: answer `/v1/me` with any
 * string, become `session.email`, then satisfy the gate's email predicate
 * against the value you just chose, and be stamped as the verified issuer.
 *
 * No check had to break for that to work, which is why every guard test passed.
 */
describe("#508 - a refresh cannot rename the account the gate compares against", () => {
  const ROGUE = "https://someone.elses.host";

  it("refuses a 2xx that names a different account, and writes nothing", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 999, email: "attacker@evil.example" },
    }));

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: ROGUE, request },
      live,
      5000,
    );

    expect(record.kind).toBe("failed");
    expect(record.message).toBe(PLUS_BASE_REFUSED_MESSAGE);
    // The stored identity is untouched, so the gate still has the real account
    // to compare against.
    const after = readPlusSession(app);
    expect(after?.email).toBe("a@b.co");
    // And nothing else was written through either: a refusal is not a partial
    // success, so the meter the rogue base inflated does not land.
    expect(after?.remaining).toBe(150);
  });

  /**
   * R1, found by the cross-model adversarial pass on the P0 fix above.
   *
   * The refusal was first recorded as `rejected`, which renders "Sign-in
   * needed" plus a **Send me a sign-in link** CTA. That link goes to the
   * current `plusBaseUrl` -- the same base that just answered for someone
   * else -- and completing it runs `installPlusSession`, stamping that host as
   * the issuer with the gate never running. Asserted at the presentation
   * layer, because the bug was that a defensible record kind rendered a
   * dangerous action.
   */
  it("offers no sign-in link back to the base that just named a different account", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 999, email: "attacker@evil.example" },
    }));

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: ROGUE, request },
      live,
      5000,
    );

    expect(plusRefreshPresentation(record).recovery).toBeNull();
    expect(plusRefreshPresentation(record).title).not.toBe("Sign-in needed");
    expect(record.message.toLowerCase()).not.toContain("sign-in link");
  });

  it("still refreshes normally when the account matches, case and space aside", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 120, email: "  A@B.CO " },
    }));

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    expect(record.kind).toBe("ok");
    const after = readPlusSession(app);
    // Stored, never adopted: the local spelling wins so nothing downstream sees
    // the address change shape between refreshes.
    expect(after?.email).toBe("a@b.co");
    expect(after?.remaining).toBe(120);
  });

  it("a service that omits the address is not treated as a rename", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 120 },
    }));

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    expect(record.kind).toBe("ok");
    expect(readPlusSession(app)?.email).toBe("a@b.co");
  });
});

/**
 * #508 R2. `refreshPlusEntitlementRecord` used to spread the `session`
 * *argument*, captured before its own await, so a write that landed while the
 * check was in flight got the pre-await snapshot put back over it. Four
 * triggers refresh concurrently (period-end load, checkout poll, backfill
 * meter, Settings "Refresh status"), and the field that costs is `verifiedBase`
 * -- erase the stamp and the next content call refuses Plus again.
 */
describe("#508 - a refresh writes the session on disk, not the one it was handed", () => {
  it("keeps a stamp that landed while the check was in flight", async () => {
    const app = appWithLiveSession();
    // The stamping probe finishes mid-flight: the real upgrade path, where
    // Process stamps the base a refresh had already read past.
    const request = mockRequest(() => {
      const current = readPlusSession(app);
      expect(current).not.toBeNull();
      app.saveLocalStorage(
        LS_PLUS_SESSION,
        serializePlusSession({
          ...(current as PlusSession),
          issuedBase: base as IssuedBase,
          verifiedBase: base,
        }),
      );
      return {
        status: 200,
        json: { status: "active", remaining: 120, email: "a@b.co" },
      };
    });

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    expect(record.kind).toBe("ok");
    const after = readPlusSession(app);
    expect(after?.verifiedBase).toBe(base);
    expect(after?.issuedBase).toBe(base);
    // The refresh still did its own job.
    expect(after?.remaining).toBe(120);
    expect(after?.status).toBe("active");
  });

  it("writes nothing when the session was replaced mid-flight", async () => {
    const app = appWithLiveSession();
    const replacement: PlusSession = {
      ...live,
      sessionToken: "sess_new",
      remaining: 5,
      refreshedAt: 2000,
    };
    const request = mockRequest(() => {
      app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(replacement));
      return {
        status: 200,
        json: { status: "active", remaining: 999, email: "a@b.co" },
      };
    });

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    // The answer belongs to a token this device no longer holds, so none of it
    // lands -- and the row must not tell the new session to sign in again.
    expect(record.kind).toBe("failed");
    expect(record.message).toBe(PLUS_REFRESH_SESSION_CHANGED_MESSAGE);
    expect(plusRefreshPresentation(record).recovery).toBeNull();
    expect(readPlusSession(app)).toEqual(replacement);
  });

  /**
   * Found by the code review on the first cut of this fix. The guard only
   * covered the success path, and the record it did write was hung on whoever
   * signed in next: `plusRefreshRowRecord` asks whether *a* session exists, not
   * which one, so a departed account's outcome rendered against the new one.
   */
  it("leaves no record behind for the session that went away", async () => {
    const app = appWithLiveSession();
    const replacement: PlusSession = { ...live, sessionToken: "sess_new" };
    const request = mockRequest(() => {
      app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(replacement));
      return { status: 200, json: { status: "active", remaining: 999 } };
    });

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    expect(record.kind).toBe("failed");
    // Returned to the caller for its Notice, never written: the new session
    // must not inherit this one's outcome, nor the old account's address.
    expect(readPlusRefreshRecord(app)).toBeNull();
    expect(record.email).toBeUndefined();
  });

  it("applies the same guard when the answer is an error", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => {
      clearPlusSession(app);
      return { status: 401, json: { message: "Invalid session" } };
    });

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    // A 401 about a token the device already dropped is not a reason to tell
    // the next account to sign in again.
    expect(record.message).toBe(PLUS_REFRESH_SESSION_CHANGED_MESSAGE);
    expect(plusRefreshPresentation(record).recovery).toBeNull();
    expect(readPlusRefreshRecord(app)).toBeNull();
  });

  it("a storage write that throws is a failed check, not an unhandled rejection", async () => {
    const app = appWithLiveSession();
    const saveLocalStorage = app.saveLocalStorage.bind(app);
    app.saveLocalStorage = (key, value) => {
      if (key === LS_PLUS_SESSION) throw new Error("quota");
      saveLocalStorage(key, value);
    };
    const request = mockRequest(() => ({
      status: 200,
      json: { status: "active", remaining: 120, email: "a@b.co" },
    }));

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    expect(record.kind).toBe("failed");
    expect(record.message).toBe(PLUS_REFRESH_SAVE_FAILED_MESSAGE);
    expect(plusRefreshPresentation(record).recovery).toBeNull();
  });

  it("writes nothing when the session was signed out mid-flight", async () => {
    const app = appWithLiveSession();
    const request = mockRequest(() => {
      clearPlusSession(app);
      return {
        status: 200,
        json: { status: "active", remaining: 999, email: "a@b.co" },
      };
    });

    const record = await refreshPlusEntitlementRecord(
      app,
      { baseUrl: base, request },
      live,
      5000,
    );

    expect(record.kind).toBe("failed");
    // A sign-out must not be undone by an answer that was already on its way.
    expect(readPlusSession(app)).toBeNull();
  });
});
