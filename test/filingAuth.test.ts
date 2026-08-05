import { describe, expect, it } from "vitest";
import {
  LS_PLUS_SIGNIN_PENDING,
  PENDING_SIGNIN_MAX_AGE_MS,
  clearPendingSignIn,
  clearPlusSession,
  latestPendingSignIn,
  parsePlusSession,
  readPendingSignIns,
  recordPendingSignIn,
  plusCanClassify,
  plusIsExhausted,
  readPlusSession,
  resolveFilingAuth,
  serializePlusSession,
  writePlusSession,
  type PlusSession,
} from "../src/platform/filingAuth";

const activeSession: PlusSession = {
  sessionToken: "sess_abc",
  email: "u@example.com",
  status: "active",
  remaining: 120,
  periodEnd: "2026-08-01T00:00:00.000Z",
};

describe("resolveFilingAuth", () => {
  it("none when no key and no session", () => {
    expect(resolveFilingAuth({ byokApiKey: null, plusSession: null })).toEqual({
      mode: "none",
    });
  });

  it("byok when only API key", () => {
    expect(
      resolveFilingAuth({ byokApiKey: " sk-test ", plusSession: null }),
    ).toEqual({ mode: "byok", apiKey: "sk-test" });
  });

  it("prefers active plus over BYOK", () => {
    const auth = resolveFilingAuth({
      byokApiKey: "sk-test",
      plusSession: activeSession,
    });
    expect(auth.mode).toBe("plus");
    if (auth.mode === "plus") {
      expect(auth.sessionToken).toBe("sess_abc");
      expect(auth.email).toBe("u@example.com");
      expect(auth.status).toBe("active");
      expect(auth.remaining).toBe(120);
    }
  });

  it("plus exhausted still mode plus (wait/top-up path)", () => {
    const auth = resolveFilingAuth({
      byokApiKey: "sk-test",
      plusSession: { ...activeSession, status: "exhausted", remaining: 0 },
    });
    expect(auth.mode).toBe("plus");
    if (auth.mode === "plus") {
      expect(auth.status).toBe("exhausted");
      expect(plusIsExhausted(auth)).toBe(true);
      expect(plusCanClassify(auth)).toBe(false);
    }
  });

  it("trialing can classify", () => {
    const auth = resolveFilingAuth({
      byokApiKey: null,
      plusSession: { ...activeSession, status: "trialing" },
    });
    expect(plusCanClassify(auth)).toBe(true);
  });

  it("inactive session falls through to BYOK", () => {
    const auth = resolveFilingAuth({
      byokApiKey: "sk-test",
      plusSession: { ...activeSession, status: "inactive" },
    });
    expect(auth).toEqual({ mode: "byok", apiKey: "sk-test" });
  });

  it("inactive without BYOK is none", () => {
    expect(
      resolveFilingAuth({
        byokApiKey: null,
        plusSession: { ...activeSession, status: "inactive" },
      }),
    ).toEqual({ mode: "none" });
  });

  it("unknown status with token stays plus for refresh", () => {
    const auth = resolveFilingAuth({
      byokApiKey: null,
      plusSession: { ...activeSession, status: "unknown" },
    });
    expect(auth.mode).toBe("plus");
    expect(plusCanClassify(auth)).toBe(true);
  });
});

describe("plus session storage", () => {
  it("round-trips through parse/serialize", () => {
    const s = parsePlusSession(JSON.parse(serializePlusSession(activeSession)));
    expect(s).toMatchObject({
      sessionToken: "sess_abc",
      email: "u@example.com",
      status: "active",
      remaining: 120,
    });
  });

  it("rejects incomplete session", () => {
    expect(parsePlusSession({ sessionToken: "x" })).toBeNull();
    expect(parsePlusSession(null)).toBeNull();
  });

  it("read/write/clear via local storage adapter", () => {
    const store = new Map<string, string>();
    const app = {
      loadLocalStorage: (k: string) => store.get(k),
      saveLocalStorage: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    writePlusSession(app, activeSession);
    expect(readPlusSession(app)?.email).toBe("u@example.com");
    clearPlusSession(app);
    expect(readPlusSession(app)).toBeNull();
  });
});

describe("pending sign-in record (U7)", () => {
  function makeApp() {
    const store = new Map<string, string>();
    return {
      store,
      app: {
        loadLocalStorage: (k: string) => store.get(k),
        saveLocalStorage: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    };
  }

  it("round-trips the verifier and vault vault-locally", () => {
    const { app, store } = makeApp();
    recordPendingSignIn(app, {
      verifier: "ver-1",
      vault: "Remote Vault",
      requestedAt: 1_000,
    });
    expect(readPendingSignIns(app, 2_000)).toEqual([
      { verifier: "ver-1", vault: "Remote Vault", requestedAt: 1_000 },
    ]);
    // Vault-scoped adapter only: nothing may be reachable under another key.
    expect([...store.keys()]).toEqual([LS_PLUS_SIGNIN_PENDING]);
  });

  it("still reads back 14 minutes later — retention outlives the token TTL (AE12)", () => {
    const { app } = makeApp();
    const at = 1_000_000;
    recordPendingSignIn(app, { verifier: "ver-1", vault: "V", requestedAt: at });
    const fourteenMinutes = 14 * 60 * 1000;
    expect(readPendingSignIns(app, at + fourteenMinutes)[0]?.verifier).toBe("ver-1");
  });

  it("drops a record past its own generous staleness bound", () => {
    const { app } = makeApp();
    const at = 1_000_000;
    recordPendingSignIn(app, { verifier: "ver-1", vault: "V", requestedAt: at });
    expect(readPendingSignIns(app, at + PENDING_SIGNIN_MAX_AGE_MS + 1)).toEqual([]);
  });

  it("a second link request leaves the earlier verifier reachable", () => {
    const { app } = makeApp();
    recordPendingSignIn(app, { verifier: "ver-1", vault: "V", requestedAt: 1_000 });
    recordPendingSignIn(app, { verifier: "ver-2", vault: "V", requestedAt: 2_000 });
    const pending = readPendingSignIns(app, 3_000);
    expect(pending.map((p) => p.verifier)).toEqual(["ver-2", "ver-1"]);
    expect(latestPendingSignIn(app, 3_000)?.verifier).toBe("ver-2");
  });

  it("clearing the session clears the pending record", () => {
    const { app } = makeApp();
    recordPendingSignIn(app, { verifier: "ver-1", vault: "V", requestedAt: 1_000 });
    clearPlusSession(app);
    expect(readPendingSignIns(app, 2_000)).toEqual([]);
  });

  it("clearPendingSignIn forgets every verifier", () => {
    const { app } = makeApp();
    recordPendingSignIn(app, { verifier: "ver-1", vault: "V", requestedAt: 1_000 });
    recordPendingSignIn(app, { verifier: "ver-2", vault: "V", requestedAt: 2_000 });
    clearPendingSignIn(app);
    expect(readPendingSignIns(app, 3_000)).toEqual([]);
    expect(latestPendingSignIn(app, 3_000)).toBeNull();
  });

  it("a malformed stored value reads as absent rather than throwing", () => {
    const { app, store } = makeApp();
    store.set(LS_PLUS_SIGNIN_PENDING, "{not json");
    expect(readPendingSignIns(app, 1)).toEqual([]);
    store.set(LS_PLUS_SIGNIN_PENDING, JSON.stringify({ nope: true }));
    expect(readPendingSignIns(app, 1)).toEqual([]);
    store.set(
      LS_PLUS_SIGNIN_PENDING,
      JSON.stringify([{ verifier: "", vault: "V", requestedAt: 1 }, 7]),
    );
    expect(readPendingSignIns(app, 1)).toEqual([]);
  });

  it("survives a throwing storage adapter", () => {
    const app = {
      loadLocalStorage: () => {
        throw new Error("no storage");
      },
      saveLocalStorage: () => {},
    };
    expect(readPendingSignIns(app, 1)).toEqual([]);
    expect(latestPendingSignIn(app, 1)).toBeNull();
  });
});
