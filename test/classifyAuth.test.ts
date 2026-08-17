import { describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";
import {
  resolveClassifyAuth,
  type ClassifyBaseVerifier,
} from "../src/platform/classifyAuth";
import {
  LS_PLUS_SESSION,
  readPlusSession,
  serializePlusSession,
  type FilingAuth,
  type IssuedBase,
  type PlusSession,
} from "../src/platform/filingAuth";
import {
  PLUS_BASE_NEEDS_ADDRESS_MESSAGE,
  PLUS_BASE_REFUSED_MESSAGE,
  PLUS_BASE_UNREACHABLE_MESSAGE,
} from "../src/platform/plusBaseVerify";
import { PLUS_BASE_URL_INVALID_MESSAGE } from "../src/platform/plusClient";
import { DEFAULT_SETTINGS } from "../src/shared/types";

/**
 * A verifier that says yes to whatever base it is handed. The default for tests
 * about *other* things — the #508 refusals get explicit doubles below.
 */
function verifies(): ClassifyBaseVerifier & { calls: unknown[] } {
  const calls: unknown[] = [];
  const fn = vi.fn(async (input: Parameters<ClassifyBaseVerifier>[0]) => {
    calls.push(input);
    return { kind: "verified" as const, base: input.resolvedBase, restamped: false };
  });
  return Object.assign(fn as unknown as ClassifyBaseVerifier, { calls });
}

/** A verifier that must never be consulted, because nothing should get that far. */
function neverAsked(): ClassifyBaseVerifier {
  return vi.fn(async () => {
    throw new Error("the gate was consulted when it should not have been");
  }) as unknown as ClassifyBaseVerifier;
}

describe("resolveClassifyAuth", () => {
  it("byok passes key", async () => {
    const auth: FilingAuth = { mode: "byok", apiKey: "sk-test" };
    const r = await resolveClassifyAuth(auth, { verifyBase: neverAsked() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.apiKey).toBe("sk-test");
      expect(r.plus).toBeUndefined();
    }
  });

  it("none fails with free-path message", async () => {
    const r = await resolveClassifyAuth({ mode: "none" }, { verifyBase: neverAsked() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("none");
      expect(r.message.toLowerCase()).toMatch(/key|plus/);
    }
  });

  it("plus active builds proxy deps", async () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "active",
      remaining: 10,
    };
    const r = await resolveClassifyAuth(auth, {
      verifyBase: verifies(),
      plusBaseUrl: "https://plus.test",
    });
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
  it("plus refuses a base URL that is not https or loopback, before any capture leaves", async () => {
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
      // The #500 refusal must come *before* the #508 probe: asking an
      // unvettable host to name the account would send the token there.
      const r = await resolveClassifyAuth(auth, {
        verifyBase: neverAsked(),
        plusBaseUrl: bad,
      });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("none");
        expect(r.message).toBe(PLUS_BASE_URL_INVALID_MESSAGE);
      }
    }
  });

  it("plus keeps the documented loopback override working", async () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "active",
      remaining: 10,
    };
    const r = await resolveClassifyAuth(auth, {
      verifyBase: verifies(),
      plusBaseUrl: "http://127.0.0.1:8787",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plus?.baseUrl).toBe("http://127.0.0.1:8787");
  });

  it("plus exhausted blocks without BYOK pitch", async () => {
    const auth: FilingAuth = {
      mode: "plus",
      sessionToken: "sess",
      email: "a@b.co",
      status: "exhausted",
      remaining: 0,
    };
    const r = await resolveClassifyAuth(auth, { verifyBase: neverAsked() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("exhausted");
      expect(r.message).toMatch(/Monthly Limit Reached/i);
      expect(r.message.toLowerCase()).not.toMatch(/paste|sk-ant|your own api key/);
    }
  });
});

/**
 * #508 U4 — the classify choke point refuses when the resolved base cannot be
 * shown to hold this session. All four classify entries (Process, Preview,
 * Update, auto-run) come through here, so this is where capture text stops.
 */
describe("resolveClassifyAuth — the issuer gate", () => {
  const plus: FilingAuth = {
    mode: "plus",
    sessionToken: "sess",
    email: "a@b.co",
    status: "active",
    remaining: 10,
    verifiedBase: "https://my.host",
  };

  it("asks about the base the request will actually post to", async () => {
    const verify = verifies();
    await resolveClassifyAuth(plus, { verifyBase: verify, plusBaseUrl: "  " });
    // Resolved, and only resolved. The gate also took the raw field until #540,
    // for the KTD1 carve-out that turned on it being empty; nothing reads it now,
    // so passing it would be a parameter waiting to be trusted again.
    expect(verify.calls[0]).toMatchObject({
      resolvedBase: "https://plus.tryatoms.app",
    });
    expect(verify.calls[0]).not.toHaveProperty("configuredBase");
  });

  it("passes the session stamps through, or the gate has nothing to compare", async () => {
    const verify = verifies();
    await resolveClassifyAuth(
      { ...plus, issuedBase: "https://issued.host" as IssuedBase },
      { verifyBase: verify, plusBaseUrl: "https://my.host" },
    );
    expect(verify.calls[0]).toMatchObject({
      session: expect.objectContaining({
        issuedBase: "https://issued.host",
        verifiedBase: "https://my.host",
      }),
    });
  });

  it("a refusal blocks the run and carries the gate's own copy", async () => {
    const r = await resolveClassifyAuth(plus, {
      verifyBase: async () => ({
        kind: "refused",
        reason: "unverified",
        message: PLUS_BASE_REFUSED_MESSAGE,
      }),
      plusBaseUrl: "https://someone.elses.host",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unverified_base");
      expect(r.message).toBe(PLUS_BASE_REFUSED_MESSAGE);
    }
  });

  it("relays whatever the gate refused with, rather than re-deriving copy (#540)", async () => {
    // The gate used to hand back a second reason, `needs-address`, for an
    // unstamped session with an empty field; it now probes that case instead.
    // What this pins is the seam: this resolver states the gate's message and
    // does not decide which refusals exist.
    const r = await resolveClassifyAuth(plus, {
      verifyBase: async () => ({
        kind: "refused",
        reason: "unverified",
        message: PLUS_BASE_REFUSED_MESSAGE,
      }),
      plusBaseUrl: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(PLUS_BASE_REFUSED_MESSAGE);
  });

  it("fails closed when the gate could not check (KTD3)", async () => {
    const r = await resolveClassifyAuth(plus, {
      verifyBase: async () => ({
        kind: "unreachable",
        message: PLUS_BASE_UNREACHABLE_MESSAGE,
      }),
      plusBaseUrl: "https://my.host",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unverified_base");
      // Names the connection, not a settings field a hosted user never touched.
      expect(r.message).toBe(PLUS_BASE_UNREACHABLE_MESSAGE);
    }
  });

  it("hands the egress backstop the verified base, not the resolved one", async () => {
    const r = await resolveClassifyAuth(plus, {
      verifyBase: async () => ({
        kind: "verified",
        base: "https://my.host",
        restamped: true,
        previousBase: "https://plus.tryatoms.app",
      }),
      plusBaseUrl: "https://my.host/",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Normalized by the gate, so the backstop compares like with like.
      expect(r.plus?.verifiedBase).toBe("https://my.host");
      expect(r.issuerMovedFrom).toBe("https://plus.tryatoms.app");
    }
  });

  it("says nothing about a move when there was no previous issuer", async () => {
    const r = await resolveClassifyAuth(plus, {
      verifyBase: async () => ({
        kind: "verified",
        base: "https://my.host",
        restamped: true,
      }),
      plusBaseUrl: "https://my.host",
    });
    expect(r.ok && r.issuerMovedFrom).toBeUndefined();
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

  it("says the trial ended, and never promises a billing date", async () => {
    const r = await resolveClassifyAuth(lapsedTrial, {
      verifyBase: neverAsked(),
      now: T0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/trial has ended/i);
      expect(r.message).toMatch(/subscribe/i);
      expect(r.message).not.toMatch(/billing date|allotment|monthly limit/i);
    }
  });

  it("says subscription, not trial, when a paid period ended", async () => {
    const r = await resolveClassifyAuth(
      { ...lapsedTrial, plan: "monthly" },
      { verifyBase: neverAsked(), now: T0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/subscription has ended/i);
  });

  it("still shows the limit copy for a spent meter inside a live period", async () => {
    const r = await resolveClassifyAuth(
      { ...lapsedTrial, plan: "monthly", periodEnd: "2026-09-10T00:00:00.000Z" },
      { verifyBase: neverAsked(), now: T0 },
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

  it("keeps issuedBase and verifiedBase when the remaining count changes", async () => {
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

    const resolved = await (
      plugin as unknown as {
        requireClassifyAuth: () => Promise<{
          plus?: { onRemaining?: (n: number) => void };
        } | null>;
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
