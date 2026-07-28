import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  askMirrorDelete,
  askMirrorReconcile,
  classifyViaProxy,
  createCheckout,
  exchangeMagicToken,
  getEntitlement,
  requestMagicLink,
  startPlusAccount,
  type RequestFn,
} from "../src/platform/plusClient";

function mockRequest(
  handler: (p: RequestUrlParam) => Partial<RequestUrlResponse>,
): RequestFn {
  return async (params) => {
    const partial = handler(params);
    return {
      status: partial.status ?? 200,
      json: partial.json ?? {},
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
});
