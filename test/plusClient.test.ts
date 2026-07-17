import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  classifyViaProxy,
  createCheckout,
  exchangeMagicToken,
  getEntitlement,
  requestMagicLink,
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
});
