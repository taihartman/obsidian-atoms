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
  type RequestFn,
} from "../src/platform/plusClient";
import {
  clearPlusRefreshRecord,
  plusRefreshPresentation,
  plusRefreshRowRecord,
  readPlusRefreshRecord,
  refreshPlusEntitlementRecord,
  PLUS_REFRESH_REJECTED_MESSAGE,
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
