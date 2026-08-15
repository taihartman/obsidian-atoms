import { describe, expect, it } from "vitest";
import { resolveClassifyAuth } from "../src/platform/classifyAuth";
import type { FilingAuth } from "../src/platform/filingAuth";
import { PLUS_BASE_URL_INVALID_MESSAGE } from "../src/platform/plusClient";

describe("resolveClassifyAuth", () => {
  it("byok passes key", () => {
    const auth: FilingAuth = { mode: "byok", apiKey: "sk-test" };
    const r = resolveClassifyAuth(auth);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.apiKey).toBe("sk-test");
      expect(r.plus).toBeUndefined();
    }
  });

  it("none fails with free-path message", () => {
    const r = resolveClassifyAuth({ mode: "none" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("none");
      expect(r.message.toLowerCase()).toMatch(/key|plus/);
    }
  });

  it("plus active builds proxy deps", () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "active",
      remaining: 10,
    };
    const r = resolveClassifyAuth(auth, { plusBaseUrl: "https://plus.test" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.apiKey).toBe("");
      expect(r.plus?.baseUrl).toBe("https://plus.test");
      expect(r.plus?.sessionToken).toBe("sess");
    }
  });

  /**
   * #500. The classify call is the one Plus path that sends the *capture body*
   * alongside the session token, so a base we would not talk to has to be
   * refused here — before Process, Preview, Update or auto-run build a request.
   */
  it("plus refuses a base URL that is not https or loopback, before any capture leaves", () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "active",
      remaining: 10,
    };
    for (const bad of [
      "http://evil.example",
      "http://192.168.1.5:8787",
      "ftp://example.com",
      "plus.tryatoms.app",
    ]) {
      const r = resolveClassifyAuth(auth, { plusBaseUrl: bad });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("none");
        expect(r.message).toBe(PLUS_BASE_URL_INVALID_MESSAGE);
      }
    }
  });

  it("plus keeps the documented loopback override working", () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "active",
      remaining: 10,
    };
    const r = resolveClassifyAuth(auth, {
      plusBaseUrl: "http://127.0.0.1:8787",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plus?.baseUrl).toBe("http://127.0.0.1:8787");
  });

  it("plus exhausted blocks without BYOK pitch", () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "exhausted",
      remaining: 0,
    };
    const r = resolveClassifyAuth(auth);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("exhausted");
      expect(r.message).toMatch(/Monthly Limit Reached/i);
      expect(r.message.toLowerCase()).not.toMatch(/paste|sk-ant|your own api key/);
    }
  });
});

/**
 * #442 — the Notice every Process/Preview/Update shows. An expired trial used to be told its
 * allotment would start over on a next billing date it did not have.
 */
describe("resolveClassifyAuth on an ended period", () => {
  const T0 = Date.parse("2026-08-11T13:49:00.000Z");
  const lapsedTrial: FilingAuth = {
    mode: "plus",
    sessionToken: "sess",
    email: "a@b.co",
    status: "exhausted",
    remaining: 0,
    plan: "trial",
    periodEnd: "2026-08-10T14:52:03.632Z",
  };

  it("says the trial ended, and never promises a billing date", () => {
    const r = resolveClassifyAuth(lapsedTrial, { now: T0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/trial has ended/i);
      expect(r.message).toMatch(/subscribe/i);
      expect(r.message).not.toMatch(/billing date|allotment|monthly limit/i);
    }
  });

  it("says subscription, not trial, when a paid period ended", () => {
    const r = resolveClassifyAuth(
      { ...lapsedTrial, plan: "monthly" },
      { now: T0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/subscription has ended/i);
  });

  it("still shows the limit copy for a spent meter inside a live period", () => {
    const r = resolveClassifyAuth(
      { ...lapsedTrial, plan: "monthly", periodEnd: "2026-09-10T00:00:00.000Z" },
      { now: T0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/Monthly Limit Reached/);
      expect(r.message).toMatch(/next billing date/);
    }
  });
});
