import { afterEach, describe, expect, it, vi } from "vitest";

import { G2AuthClient, G2HttpClient } from "../src/auth/client";
import { singleFlight } from "../src/auth/singleFlight";
import { g2ServerSetupReady, readG2ServerSetup } from "../src/auth/setup";

type VaultDouble = {
  createOrLoadProofKey: ReturnType<typeof vi.fn>;
  sign: ReturnType<typeof vi.fn>;
  saveRefresh: ReturnType<typeof vi.fn>;
  loadRefresh: ReturnType<typeof vi.fn>;
  purge: ReturnType<typeof vi.fn>;
};

function vaultDouble(refreshToken = "g2r_saved"): VaultDouble {
  return {
    createOrLoadProofKey: vi.fn(async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" })),
    sign: vi.fn(async () => new Uint8Array(64).buffer),
    saveRefresh: vi.fn(async () => {}),
    loadRefresh: vi.fn(async (accountId: string, deviceFamilyId: string) => ({ accountId, deviceFamilyId, refreshToken })),
    purge: vi.fn(async () => {}),
  };
}

function tokens(accessToken: string, refreshToken: string, expiresIn = 600) {
  return { accessToken, refreshToken, expiresIn, scopes: ["g2:query"], device: { id: "family-one" } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function clientReturning(response: Response): G2HttpClient {
  const auth = { authorized: vi.fn(async () => response) } as unknown as G2AuthClient;
  return new G2HttpClient(auth);
}

describe("G2 HTTP client", () => {
  it("preserves recognized commit and status states carried by non-2xx responses", async () => {
    const collision = clientReturning(new Response(JSON.stringify({ state: "title_collision" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }));
    await expect(collision.post("/v1/g2/commit", {})).resolves.toEqual({ state: "title_collision" });

    const missing = clientReturning(new Response(JSON.stringify({ state: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }));
    await expect(missing.post("/v1/g2/status", {})).resolves.toEqual({ state: "not_found" });
  });

  it("does not trust unknown error bodies and retains auth and rate-limit mappings", async () => {
    await expect(clientReturning(new Response(JSON.stringify({ state: "invented" }), { status: 409 }))
      .post("/v1/g2/commit", {})).rejects.toThrow("request_failed");
    await expect(clientReturning(new Response(null, { status: 403 }))
      .post("/v1/g2/status", {})).rejects.toThrow("setup_required");
    await expect(clientReturning(new Response(null, { status: 429 }))
      .post("/v1/g2/status", {})).rejects.toThrow("limit_reached");
  });
});

describe("G2 auth lifecycle (KTD2, AE1, AE9)", () => {
  it("preserves the stored refresh credential when restore fails transiently", async () => {
    const vault = vaultDouble();
    const fetcher = vi.fn(async () => { throw new TypeError("offline"); });
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never);

    await expect(auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" })).resolves.toBeNull();
    expect(vault.purge).not.toHaveBeenCalled();
    expect(vault.loadRefresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed without purging when credential storage is temporarily unreadable", async () => {
    const vault = vaultDouble();
    vault.loadRefresh.mockRejectedValueOnce(new Error("storage unavailable"));
    const fetcher = vi.fn();
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never);

    await expect(auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" })).resolves.toBeNull();
    expect(auth.current()).toBeNull();
    expect(vault.purge).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403])("purges a refresh credential only after definitive HTTP %s refusal", async (status) => {
    const vault = vaultDouble();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-one" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status }));
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never);

    await expect(auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" })).resolves.toBeNull();
    expect(vault.purge).toHaveBeenCalledTimes(1);
  });

  it("fails closed but preserves the refresh credential for an unstructured old-server refusal", async () => {
    const vault = vaultDouble();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-one" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Request denied" }), { status: 401 }));
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never);

    await expect(auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" })).resolves.toBeNull();
    expect(auth.current()).toBeNull();
    expect(vault.purge).not.toHaveBeenCalled();
  });

  it.each(["server error", "unreadable response", "credential storage"])(
    "preserves the previous refresh credential after %s",
    async (failure) => {
      const vault = vaultDouble();
      if (failure === "credential storage") vault.saveRefresh.mockRejectedValueOnce(new Error("storage unavailable"));
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-one" }), { status: 200 }))
        .mockResolvedValueOnce(failure === "server error"
          ? new Response(JSON.stringify({ message: "later" }), { status: 503 })
          : failure === "unreadable response"
            ? new Response("not json", { status: 200 })
            : new Response(JSON.stringify(tokens("g2a_next", "g2r_next")), { status: 200 }));
      const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never);

      await expect(auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" })).resolves.toBeNull();
      expect(vault.purge).not.toHaveBeenCalled();
    },
  );

  it("serializes pre-expiry refresh and lets concurrent requests use the rotated access token", async () => {
    let now = 1_000_000;
    const vault = vaultDouble();
    const seenAuthorization: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/nonce")) return new Response(JSON.stringify({ nonce: crypto.randomUUID() }));
      if (url.endsWith("/auth/refresh")) return new Response(JSON.stringify(tokens("g2a_rotated", "g2r_rotated")));
      seenAuthorization.push(new Headers(init?.headers).get("authorization") ?? "");
      return new Response(JSON.stringify({ ok: true }));
    });
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never, () => now);
    await auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" });
    now += 575_000;

    await Promise.all([auth.authorized("/v1/g2/query", {}), auth.authorized("/v1/g2/recent", {})]);

    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(2);
    expect(seenAuthorization).toEqual(["Bearer g2a_rotated", "Bearer g2a_rotated"]);
  });

  it("refreshes and retries one time after a 401, but never replays a second refusal", async () => {
    const vault = vaultDouble();
    let protectedCalls = 0;
    let refreshCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/nonce")) return new Response(JSON.stringify({ nonce: crypto.randomUUID() }));
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return new Response(JSON.stringify(refreshCalls === 1
          ? tokens("g2a_initial", "g2r_initial")
          : tokens("g2a_rotated", "g2r_rotated")));
      }
      protectedCalls += 1;
      expect(new Headers(init?.headers).get("authorization")).toBe(protectedCalls === 1 ? "Bearer g2a_initial" : "Bearer g2a_rotated");
      return new Response(null, { status: 401 });
    });
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never);
    await auth.restore({ accountId: "account-one", deviceFamilyId: "family-one" });

    const response = await auth.authorized("/v1/g2/commit", { idempotencyKey: "commit-one" });

    expect(response.status).toBe(401);
    expect(protectedCalls).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(2);
  });

  it("aborts and rejects a companion HTTP call at its finite deadline", async () => {
    vi.useFakeTimers();
    const vault = vaultDouble();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const auth = new G2AuthClient("https://plus.example", vault as never, fetcher as never, Date.now, 50);
    const pending = auth.pair("ABCD-1234");
    const rejected = expect(pending).rejects.toThrow("request_timeout");

    await vi.advanceTimersByTimeAsync(50);

    await rejected;
    expect(signal?.aborted).toBe(true);
  });
});

describe("G2 startup gates", () => {
  it("coalesces repeated pairing, disclosure, and boot gestures into one operation", async () => {
    let runs = 0;
    let release!: () => void;
    const operation = singleFlight(async () => {
      runs += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return "ready";
    });

    const first = operation();
    const second = operation();
    expect(runs).toBe(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["ready", "ready"]);
    const third = operation();
    expect(runs).toBe(2);
    release();
    await third;
  });

  it("requires disclosure, mirror, and write server gates before boot", () => {
    const ready = {
      revision: 4,
      g2Disclosure: { granted: true, version: "g2-audio-v1" },
      askMirror: { granted: true, version: "2026-08-07" },
      askWrite: { granted: true, version: "2026-09-08" },
    };
    expect(g2ServerSetupReady(ready)).toBe(true);
    expect(g2ServerSetupReady({ ...ready, askMirror: { granted: false, version: "" } })).toBe(false);
    expect(g2ServerSetupReady({ ...ready, askWrite: { granted: false, version: "" } })).toBe(false);
    expect(g2ServerSetupReady({ ...ready, g2Disclosure: { granted: true, version: "old" } })).toBe(false);
  });

  it("reads current server gates before a cold restored session can boot", async () => {
    const consent = {
      revision: 5,
      g2Disclosure: { granted: true, version: "g2-audio-v1" },
      askMirror: { granted: true, version: "2026-08-07" },
      askWrite: { granted: true, version: "2026-09-08" },
    };
    const post = vi.fn(async () => consent);

    await expect(readG2ServerSetup(post)).resolves.toBe(consent);
    expect(post).toHaveBeenCalledWith("/v1/g2/setup/status", {});
  });
});
