import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  askMirrorDelete,
  askMirrorReconcile,
  askMirrorStatus,
  classifyViaProxy,
  createCheckout,
  exchangeMagicToken,
  getEntitlement,
  requestMagicLink,
  startPlusAccount,
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

});
