import { describe, expect, it } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";
import { resolveClassifyAuth } from "../src/platform/classifyAuth";
import {
  LS_PLUS_SESSION,
  readPlusSession,
  serializePlusSession,
  type FilingAuth,
  type IssuedBase,
  type PlusSession,
} from "../src/platform/filingAuth";
import { PLUS_BASE_URL_INVALID_MESSAGE } from "../src/platform/plusClient";
import { DEFAULT_SETTINGS } from "../src/shared/types";

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

/**
 * #508 U1. The `onRemaining` callback in `AtomsPlugin.requireClassifyAuth` is
 * the second mutation path that writes a session without `installPlusSession`.
 * It spreads the stored session today, so the issuer stamp survives a meter
 * update — but a refactor to a fresh literal would blank it, and an unstamped
 * session is exactly what makes the issuer gate fail open.
 */
describe("#508 meter update preserves the issuer stamp", () => {
  const stamped: PlusSession = {
    sessionToken: "sess_live",
    email: "plus@example.com",
    status: "active",
    remaining: 12,
    periodEnd: "2026-09-01T00:00:00.000Z",
    issuedBase: "https://my.host" as IssuedBase,
    verifiedBase: "https://my.host",
  };

  it("keeps issuedBase and verifiedBase when the remaining count changes", () => {
    const store = new Map<string, string>();
    store.set(LS_PLUS_SESSION, serializePlusSession(stamped));
    const app = {
      loadLocalStorage: (k: string) => store.get(k),
      saveLocalStorage: (k: string, v: string) => {
        store.set(k, v);
      },
    };

    const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
    Object.assign(plugin, {
      app,
      settings: { ...DEFAULT_SETTINGS, plusBaseUrl: "https://my.host" },
      getApiKey: () => null,
    });

    const resolved = (
      plugin as unknown as {
        requireClassifyAuth: () => { plus?: { onRemaining?: (n: number) => void } } | null;
      }
    ).requireClassifyAuth();
    expect(resolved?.plus?.onRemaining).toBeTypeOf("function");
    resolved?.plus?.onRemaining?.(3);

    const after = readPlusSession(app);
    expect(after?.remaining).toBe(3);
    expect(after?.issuedBase).toBe("https://my.host");
    expect(after?.verifiedBase).toBe("https://my.host");
  });
});
