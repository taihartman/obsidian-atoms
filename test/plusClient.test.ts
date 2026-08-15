import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  askMirrorDelete,
  askMirrorReconcile,
  askMirrorStatus,
  askMcpPair,
  classifyViaProxy,
  createCheckout,
  exchangeMagicToken,
  getEntitlement,
  peekMagicToken,
  requestMagicLink,
  startPlusAccount,
  PLUS_UNREACHABLE_MESSAGE,
  SESSION_REJECTED_MESSAGE,
  UNREADABLE_RESPONSE_MESSAGE,
  upstreamRefusedMessage,
  type RequestFn,
} from "../src/platform/plusClient";

function mockRequest(
  handler: (p: RequestUrlParam) => Partial<RequestUrlResponse>,
): RequestFn {
  return async (params) => {
    const partial = handler(params);
    return {
      status: partial.status ?? 200,
      // Keep an explicit `undefined` — that is how plusFetchRequest reports an
      // unparseable body.
      json: "json" in partial ? partial.json : {},
      text: partial.text ?? "",
      arrayBuffer: partial.arrayBuffer ?? new ArrayBuffer(0),
      headers: partial.headers ?? {},
    } as RequestUrlResponse;
  };
}

const base = "https://plus.test";

describe("plusClient", () => {
  it("startPlusAccount posts email and returns session", async () => {
    const request = mockRequest((p) => {
      expect(p.url).toBe("https://plus.test/v1/auth/start");
      expect(JSON.parse(String(p.body))).toEqual({ email: "a@b.co" });
      return {
        status: 200,
        json: {
          session: "sess_soft",
          email: "a@b.co",
          status: "inactive",
          remaining: 0,
        },
      };
    });
    const r = await startPlusAccount({ baseUrl: base, request }, "a@b.co");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.sessionToken).toBe("sess_soft");
      expect(r.session.status).toBe("inactive");
    }
  });

  it("startPlusAccount maps 409 to needsMagicLink", async () => {
    const request = mockRequest(() => ({
      status: 409,
      json: {
        needsMagicLink: true,
        email: "paid@b.co",
        message: "use magic",
      },
    }));
    const r = await startPlusAccount({ baseUrl: base, request }, "paid@b.co");
    expect(r.ok).toBe(false);
    if (!r.ok && "needsMagicLink" in r) {
      expect(r.needsMagicLink).toBe(true);
      expect(r.email).toBe("paid@b.co");
    }
  });

  it("requestMagicLink posts email", async () => {
    const request = mockRequest((p) => {
      expect(p.url).toBe("https://plus.test/v1/auth/magic-link");
      expect(p.method).toBe("POST");
      expect(JSON.parse(String(p.body))).toEqual({ email: "a@b.co" });
      return { status: 200, json: { ok: true } };
    });
    const r = await requestMagicLink({ baseUrl: base, request }, "a@b.co");
    expect(r).toEqual({ ok: true });
  });

  it("exchangeMagicToken returns session", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: {
        session: "sess_1",
        email: "a@b.co",
        status: "trialing",
        remaining: 150,
      },
    }));
    const r = await exchangeMagicToken({ baseUrl: base, request }, "tok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.sessionToken).toBe("sess_1");
      expect(r.session.status).toBe("trialing");
      expect(r.session.remaining).toBe(150);
    }
  });

  it("getEntitlement maps 402 exhausted", async () => {
    const request = mockRequest(() => ({
      status: 402,
      json: { message: "quota" },
    }));
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("exhausted");
      expect(r.message.toLowerCase()).toMatch(/top-up|reset|included/);
    }
  });

  it("getEntitlement 401 gives the human sign-in sentence, not the HTTP line", async () => {
    const request = mockRequest(() => ({
      status: 401,
      json: { message: "Invalid session" },
    }));
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("auth");
      expect(r.message).toBe(SESSION_REJECTED_MESSAGE);
      expect(r.message).not.toContain("HTTP");
    }
  });

  it("403 for missing entitlement keeps the service sentence, not a sign-in nudge", async () => {
    const request = mockRequest(() => ({
      status: 403,
      json: { message: "Plus entitlement required for Ask mirror" },
    }));
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).not.toBe("auth");
      expect(r.message).toBe("Plus entitlement required for Ask mirror");
    }
  });

  it("getEntitlement 403 without a service body is an upstream refusal", async () => {
    const request = mockRequest(() => ({
      status: 403,
      json: undefined,
      text: "<html>Forbidden</html>",
    }));
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("upstream");
      expect(r.message).toBe(upstreamRefusedMessage(403));
      expect(r.message.toLowerCase()).not.toContain("sign in");
    }
  });

  it("exchangeMagicToken keeps a stated status when remaining is missing", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: { session: "sess_1", email: "a@b.co", status: "exhausted" },
    }));
    const r = await exchangeMagicToken({ baseUrl: base, request }, "tok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.status).toBe("exhausted");
      expect(r.session.remaining).toBeUndefined();
    }
  });

  it("startPlusAccount keeps a stated remaining when status is missing", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: { session: "sess_soft", email: "a@b.co", remaining: 12 },
    }));
    const r = await startPlusAccount({ baseUrl: base, request }, "a@b.co");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.status).toBe("inactive");
      expect(r.session.remaining).toBe(12);
    }
  });

  it("getEntitlement rejects a 2xx missing entitlement fields", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: { email: "a@b.co" },
    }));
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(UNREADABLE_RESPONSE_MESSAGE);
  });

  it("getEntitlement rejects a 2xx whose body is not JSON", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: undefined,
      text: "<html>gateway</html>",
    }));
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(UNREADABLE_RESPONSE_MESSAGE);
  });

  it("classifyViaProxy sends Bearer and returns remaining", async () => {
    const request = mockRequest((p) => {
      expect(p.headers?.authorization).toBe("Bearer sess_x");
      expect(p.url).toContain("/v1/classify");
      return {
        status: 200,
        json: {
          result: { content: [{ type: "text", text: "{}" }] },
          remaining: 99,
          status: "active",
        },
      };
    });
    const r = await classifyViaProxy(
      { baseUrl: base, request },
      "sess_x",
      { capture: "hello", context: {} },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.remaining).toBe(99);
  });

  it("createCheckout returns url", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: { url: "https://checkout.test/c" },
    }));
    const r = await createCheckout(
      { baseUrl: base, request },
      "sess",
      "topup_50",
    );
    expect(r).toEqual({ ok: true, url: "https://checkout.test/c" });
  });

  it("missing baseUrl fails safely", async () => {
    const request = vi.fn() as unknown as RequestFn;
    const r = await requestMagicLink({ baseUrl: "", request }, "a@b.co");
    expect(r.ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("network throw becomes network error", async () => {
    const request: RequestFn = async () => {
      throw new Error("offline");
    };
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("network");
  });

  it("network throw shows advice, not the thrown shape", async () => {
    const request: RequestFn = async () => {
      throw new TypeError("Failed to fetch");
    };
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toBe(PLUS_UNREACHABLE_MESSAGE);
    expect(r.message).not.toContain("Failed to fetch");
    // The engine shape survives for diagnostics, off every user surface.
    expect(r.detail).toBe("TypeError: Failed to fetch");
  });

  it("network detail stays redacted", async () => {
    const request: RequestFn = async () => {
      throw new Error("refused Bearer sess_abc123def456 at edge");
    };
    const r = await getEntitlement({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).not.toContain("sess_abc123def456");
    expect(r.detail).toContain("[redacted]");
  });

  it("askMirrorStatus parses email", async () => {
    const request = mockRequest(() => ({
      status: 200,
      json: { count: 12, updatedAt: "2026-08-04T00:00:00.000Z", email: "You@Ex.Co" },
    }));
    const r = await askMirrorStatus({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.count).toBe(12);
      expect(r.email).toBe("you@ex.co");
    }
  });

  it("askMcpPair posts empty body", async () => {
    const request = mockRequest((p) => {
      expect(p.url).toBe("https://plus.test/v1/ask/mcp/pair");
      expect(p.method).toBe("POST");
      return {
        status: 200,
        json: { code: "ABCD1234", expiresAt: "2026-08-04T12:00:00.000Z" },
      };
    });
    const r = await askMcpPair({ baseUrl: base, request }, "sess");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.code).toBe("ABCD1234");
  });

  it("askMirrorDelete posts paths", async () => {
    const request = mockRequest((p) => {
      expect(p.url).toBe("https://plus.test/v1/ask/mirror/delete");
      expect(p.method).toBe("POST");
      expect(JSON.parse(String(p.body))).toEqual({
        paths: ["Atoms/A.md"],
      });
      return { status: 200, json: { ok: true, deleted: 1, missing: 0, count: 0 } };
    });
    const r = await askMirrorDelete(
      { baseUrl: base, request },
      "sess",
      ["Atoms/A.md"],
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.deleted).toBe(1);
  });

  it("askMirrorReconcile posts keepPaths", async () => {
    const request = mockRequest((p) => {
      expect(p.url).toBe("https://plus.test/v1/ask/mirror/reconcile");
      const body = JSON.parse(String(p.body)) as Record<string, unknown>;
      expect(body.keepPaths).toEqual(["Atoms/A.md"]);
      expect(body.done).toBe(true);
      return { status: 200, json: { ok: true, deleted: 0, count: 1 } };
    });
    const r = await askMirrorReconcile(
      { baseUrl: base, request },
      "sess",
      { keepPaths: ["Atoms/A.md"], done: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.count).toBe(1);
  });

  // The count this returns is the sole input to the reconcile tripwire, and a
  // reconcile hard-deletes every cloud row the local scan does not name. So a
  // response that does not actually carry a count must read as a failure, not
  // as "the cloud holds zero" — a captive portal or a proxy that swallows the
  // body would otherwise hand the gate an authoritative-looking permission to
  // delete everything.
  describe("askMirrorStatus fails closed on a 2xx without a usable count", () => {
    const cfg = { baseUrl: base, request: mockRequest(() => ({})) };
    const cases: { name: string; json: unknown }[] = [
      { name: "bodyless 2xx", json: undefined },
      { name: "empty object", json: {} },
      { name: "null count", json: { count: null } },
      { name: "string count", json: { count: "400" } },
      { name: "NaN count", json: { count: Number.NaN } },
      { name: "Infinity count", json: { count: Number.POSITIVE_INFINITY } },
    ];
    for (const c of cases) {
      it(c.name, async () => {
        const r = await askMirrorStatus(
          { ...cfg, request: mockRequest(() => ({ status: 200, json: c.json })) },
          "sess_x",
        );
        expect(r.ok).toBe(false);
      });
    }

    it("a real numeric count still succeeds, including a genuine zero", async () => {
      for (const count of [0, 1, 484]) {
        const r = await askMirrorStatus(
          {
            ...cfg,
            request: mockRequest(() => ({ status: 200, json: { count } })),
          },
          "sess_x",
        );
        expect(r).toEqual({ ok: true, count, updatedAt: null });
      }
    });
  });

  // #240 U8 (R12) — the three Plus calls that carry the PKCE binding. The
  // verifier never leaves the device except in these bodies, and never appears
  // in a message we hand a caller.
  describe("magic-link verifier binding", () => {
    // Realistic shapes: the server mints tokens as `id("mt")` —
    // `mt_` + randomBytes(16).toString("hex") (plus-service/src/store/shared.mjs:6),
    // and the verifier is 32 bytes base64url (src/platform/pkce.ts).
    const TOKEN = "mt_9f3c1ab27d0e4f5a8b6c7d8e9f0a1b2c";
    // Exactly 43 characters — what 32 base64url bytes actually produce, so the
    // redactor is proved at the real boundary rather than above it.
    const VERIFIER = "8F3aafSYtLJGccHWkbz8rdFo9ULSbzeOTNiPyxZxPHY";
    const SESSION = "sess_supersecretdevicesession";

    it("requestMagicLink sends the verifier hash and vault", async () => {
      const request = mockRequest((p) => {
        expect(p.url).toBe("https://plus.test/v1/auth/magic-link");
        expect(JSON.parse(String(p.body))).toEqual({
          email: "a@b.co",
          verifierHash: "hash123",
          vault: "test vault",
        });
        return { status: 200, json: { ok: true } };
      });
      const r = await requestMagicLink({ baseUrl: base, request }, "a@b.co", {
        verifierHash: "hash123",
        vault: "test vault",
      });
      expect(r).toEqual({ ok: true });
    });

    it("exchangeMagicToken sends the verifier", async () => {
      const request = mockRequest((p) => {
        expect(p.url).toBe("https://plus.test/v1/auth/exchange");
        expect(JSON.parse(String(p.body))).toEqual({
          token: TOKEN,
          verifier: VERIFIER,
        });
        return { status: 200, json: { session: SESSION, email: "a@b.co" } };
      });
      const r = await exchangeMagicToken({ baseUrl: base, request }, TOKEN, {
        verifier: VERIFIER,
      });
      expect(r.ok).toBe(true);
    });

    it("peekMagicToken posts the token and verifier and parses usable", async () => {
      const request = mockRequest((p) => {
        expect(p.url).toBe("https://plus.test/v1/auth/peek");
        expect(p.method).toBe("POST");
        expect(JSON.parse(String(p.body))).toEqual({
          token: TOKEN,
          verifier: VERIFIER,
        });
        return {
          status: 200,
          json: { result: "usable", email: "a@b.co", vault: "test vault" },
        };
      });
      const r = await peekMagicToken({ baseUrl: base, request }, {
        token: TOKEN,
        verifier: VERIFIER,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.verdict).toBe("usable");
        expect(r.email).toBe("a@b.co");
        expect(r.vault).toBe("test vault");
      }
    });

    it("a refused peek carries the wrong-vault code and the recorded vault, never the email", async () => {
      const request = mockRequest(() => ({
        status: 200,
        json: { result: "refused", vault: "Other vault" },
      }));
      const r = await peekMagicToken({ baseUrl: base, request }, {
        token: TOKEN,
        verifier: VERIFIER,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("refused");
        expect(r.verdict).toBe("refused");
        expect(r.vault).toBe("Other vault");
        expect(r).not.toHaveProperty("email");
      }
    });

    it("expired and invalid peeks stay distinguishable from a refusal", async () => {
      for (const verdict of ["expired", "invalid"] as const) {
        const request = mockRequest(() => ({
          status: 200,
          json: { result: verdict },
        }));
        const r = await peekMagicToken({ baseUrl: base, request }, {
          token: TOKEN,
          verifier: VERIFIER,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.code).toBe(verdict);
          expect(r.verdict).toBe(verdict);
        }
      }
    });

    // The peek and the exchange answer with the same vocabulary, so U9 routes
    // one outcome table rather than two.
    it("the exchange maps a refusal and an expiry to the same codes as the peek", async () => {
      const refused = await exchangeMagicToken(
        {
          baseUrl: base,
          request: mockRequest(() => ({
            status: 403,
            json: { result: "refused", vault: "Other vault" },
          })),
        },
        TOKEN,
        { verifier: VERIFIER },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe("refused");

      const expired = await exchangeMagicToken(
        {
          baseUrl: base,
          request: mockRequest(() => ({
            status: 400,
            json: { result: "expired" },
          })),
        },
        TOKEN,
        { verifier: VERIFIER },
      );
      expect(expired.ok).toBe(false);
      if (!expired.ok) expect(expired.code).toBe("expired");
    });

    it("a network failure keeps the network code on both the peek and the exchange", async () => {
      const request: RequestFn = async () => {
        throw new Error("offline");
      };
      const peek = await peekMagicToken({ baseUrl: base, request }, {
        token: TOKEN,
        verifier: VERIFIER,
      });
      expect(peek.ok).toBe(false);
      if (!peek.ok) expect(peek.code).toBe("network");

      const ex = await exchangeMagicToken({ baseUrl: base, request }, TOKEN, {
        verifier: VERIFIER,
      });
      expect(ex.ok).toBe(false);
      if (!ex.ok) expect(ex.code).toBe("network");
    });

    // Covers AE8. The redactor had never seen a magic token before this change.
    it("redacts a magic token, a verifier and a session token from one message", async () => {
      const leaky = `boom token=${TOKEN} verifier=${VERIFIER} session=${SESSION}`;
      const request = mockRequest(() => ({
        status: 500,
        json: { message: leaky },
      }));
      const r = await exchangeMagicToken({ baseUrl: base, request }, TOKEN, {
        verifier: VERIFIER,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).not.toContain(TOKEN);
        expect(r.message).not.toContain(VERIFIER);
        expect(r.message).not.toContain(SESSION);
        expect(r.message).toContain("[redacted]");
      }
    });

    it("no error message from any of the three calls leaks the secrets it was given", async () => {
      const leaky = `bad ${TOKEN} ${VERIFIER} ${SESSION}`;
      const failing = mockRequest(() => ({
        status: 500,
        json: { message: leaky },
      }));
      const throwing: RequestFn = async () => {
        throw new Error(leaky);
      };
      for (const request of [failing, throwing]) {
        const cfg = { baseUrl: base, request };
        const results = [
          await requestMagicLink(cfg, "a@b.co", {
            verifierHash: "hash123",
            vault: "test vault",
          }),
          await exchangeMagicToken(cfg, TOKEN, { verifier: VERIFIER }),
          await peekMagicToken(cfg, { token: TOKEN, verifier: VERIFIER }),
        ];
        for (const r of results) {
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.message).not.toContain(TOKEN);
            expect(r.message).not.toContain(VERIFIER);
            expect(r.message).not.toContain(SESSION);
          }
        }
      }
    });
  });
});
