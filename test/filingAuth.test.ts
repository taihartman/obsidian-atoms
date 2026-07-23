import { describe, expect, it } from "vitest";
import {
  clearPlusSession,
  parsePlusSession,
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
