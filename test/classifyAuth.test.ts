import { describe, expect, it } from "vitest";
import { resolveClassifyAuth } from "../src/platform/classifyAuth";
import type { FilingAuth } from "../src/platform/filingAuth";

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
