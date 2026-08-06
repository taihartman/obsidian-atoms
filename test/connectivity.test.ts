import { describe, expect, it, vi } from "vitest";
import {
  anthropicConnectivityOk,
  buildConnectivityReport,
  probeAnthropicApi,
  probeHttpsBaseline,
  runConnectivityTest,
  type ProbeResult,
} from "../src/platform/connectivity";
import {
  apiKeyStateFromReport,
  apiKeyStatusText,
  looksLikeAnthropicKey,
} from "../src/settings/settings";

describe("probeHttpsBaseline", () => {
  it("treats HTTP 200 as success", async () => {
    const request = vi.fn(async () => ({ status: 200, text: "ok", json: {} }));
    const r = await probeHttpsBaseline(request as never);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/Reached the internet/);
  });

  it("treats throw as failure with redacted message", async () => {
    const request = vi.fn(async () => {
      throw new Error("net::ERR_FAILED sk-ant-api03-secretvalue");
    });
    const r = await probeHttpsBaseline(request as never);
    expect(r.ok).toBe(false);
    expect(r.summary).not.toContain("sk-ant-api03-secretvalue");
    expect(r.summary).toContain("[redacted]");
  });
});

describe("probeAnthropicApi", () => {
  it("401 without key still means reachable", async () => {
    const request = vi.fn(async () => ({
      status: 401,
      json: { error: { type: "authentication_error" } },
    }));
    const r = await probeAnthropicApi(null, request as never);
    expect(anthropicConnectivityOk(r)).toBe(true);
    expect(r.summary).toMatch(/reachable/i);
  });

  it("200 is ok", async () => {
    const request = vi.fn(async () => ({ status: 200, json: {} }));
    const r = await probeAnthropicApi("sk-test", request as never);
    expect(r.ok).toBe(true);
    expect(r.detail?.status).toBe(200);
  });

  it("bills the user only when asked to", async () => {
    const request = vi.fn(async () => ({ status: 400, json: {} }));
    const body = async (opts?: { billable?: boolean }) => {
      request.mockClear();
      await probeAnthropicApi("sk-test", request as never, opts);
      const calls = request.mock.calls as unknown as Array<[{ body?: string }]>;
      return JSON.parse(calls[0]?.[0]?.body ?? "{}") as Record<string, unknown>;
    };

    // The explicit Test connection command: a real one-token message, which is charged for.
    expect(await body()).toMatchObject({ messages: expect.anything() });
    // The render-time key check: rejected at validation, so it proves the path for free.
    expect(await body({ billable: false })).toEqual({});
  });

  it("network throw is not reachable", async () => {
    const request = vi.fn(async () => {
      throw new Error("net::ERR_FAILED");
    });
    const r = await probeAnthropicApi("sk-test", request as never);
    expect(anthropicConnectivityOk(r)).toBe(false);
    expect(r.summary).toMatch(/Could not reach Anthropic/);
  });

  it("never puts key in user-facing summary", async () => {
    const request = vi.fn(async () => ({ status: 401, json: {} }));
    const r = await probeAnthropicApi("sk-ant-super-secret", request as never);
    expect(r.summary).not.toContain("super-secret");
    expect(r.summary).not.toContain("sk-ant-");
    expect(request).toHaveBeenCalled();
    const calls = request.mock.calls as unknown as Array<
      [{ headers?: Record<string, string> }]
    >;
    expect(calls[0]?.[0]?.headers?.["x-api-key"]).toBe("sk-ant-super-secret");
  });
});

describe("buildConnectivityReport", () => {
  const base = (over: Partial<ProbeResult> & { id: ProbeResult["id"] }): ProbeResult => ({
    label: over.id,
    ok: false,
    summary: "",
    ...over,
  });

  it("no_https when both fail", () => {
    const report = buildConnectivityReport(
      [
        base({ id: "https_baseline", ok: false, summary: "fail" }),
        base({ id: "anthropic_api", ok: false, summary: "fail" }),
      ],
      true,
    );
    expect(report.verdict).toBe("no_https");
    expect(report.userMessage).not.toMatch(/ipv6/i);
    expect(report.userMessage).not.toMatch(/local network/i);
  });

  it("baseline_only when only anthropic fails", () => {
    const report = buildConnectivityReport(
      [
        base({ id: "https_baseline", ok: true, summary: "ok" }),
        base({
          id: "anthropic_api",
          ok: false,
          summary: "fail",
          detail: { errorMessage: "net::ERR_FAILED" },
        }),
      ],
      true,
    );
    expect(report.verdict).toBe("baseline_only");
  });

  it("ok when anthropic 200", () => {
    const report = buildConnectivityReport(
      [
        base({ id: "https_baseline", ok: true, summary: "ok" }),
        base({
          id: "anthropic_api",
          ok: true,
          summary: "ok",
          detail: { status: 200 },
        }),
      ],
      true,
    );
    expect(report.verdict).toBe("ok");
  });

  it("no_key when reachable but no key", () => {
    const report = buildConnectivityReport(
      [
        base({ id: "https_baseline", ok: true, summary: "ok" }),
        base({
          id: "anthropic_api",
          ok: true,
          summary: "401",
          detail: { status: 401 },
        }),
      ],
      false,
    );
    expect(report.verdict).toBe("no_key");
  });

  it("partial when key rejected", () => {
    const report = buildConnectivityReport(
      [
        base({ id: "https_baseline", ok: true, summary: "ok" }),
        base({
          id: "anthropic_api",
          ok: false,
          summary: "401",
          detail: { status: 401 },
        }),
      ],
      true,
    );
    // 401 still means reached
    expect(anthropicConnectivityOk(report.probes[1]!)).toBe(true);
    expect(report.verdict).toBe("partial");
    expect(report.userMessage).toMatch(/rejected/i);
  });
});

describe("runConnectivityTest", () => {
  it("runs both probes in order", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, text: "ok" })
      .mockResolvedValueOnce({ status: 401, json: {} });
    const report = await runConnectivityTest({
      apiKey: null,
      request: request as never,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(report.probes).toHaveLength(2);
    expect(report.verdict).toBe("no_key");
  });
});

/**
 * U6 — the API-key row reads this report rather than re-deriving reachability. The three
 * outcomes it renders have to be distinguishable *here*, or the row cannot tell a user whose
 * key is wrong from a user whose network is down.
 */
describe("what the API key row reads off a report", () => {
  const probe = async (status: number | "throw") => {
    const request = vi.fn().mockImplementation(async () => {
      if (status === "throw") throw new Error("net::ERR_INTERNET_DISCONNECTED");
      return { status, json: {} };
    });
    return runConnectivityTest({ apiKey: "sk-ant-api03-key", request: request as never });
  };

  it("separates reachable-and-rejected from unreachable", async () => {
    const rejected = await probe(401);
    const offline = await probe("throw");

    expect(apiKeyStateFromReport(rejected)).toEqual({ kind: "rejected" });
    expect(apiKeyStateFromReport(offline)).toEqual({ kind: "unreachable" });
    expect(apiKeyStateFromReport(await probe(200))).toEqual({ kind: "ok" });
  });

  it("knows an Anthropic key by shape before spending a request on it", () => {
    expect(looksLikeAnthropicKey("sk-ant-api03-abcdefghij")).toBe(true);
    expect(looksLikeAnthropicKey("  sk-ant-api03-abcdefghij  ")).toBe(true);
    expect(looksLikeAnthropicKey("hunter2")).toBe(false);
    expect(looksLikeAnthropicKey("sk-ant-")).toBe(false);
    expect(looksLikeAnthropicKey("")).toBe(false);
  });

  it("gives every state its own sentence", () => {
    const states = ["absent", "checking", "malformed", "unreachable", "rejected", "ok"] as const;
    const said = states.map((kind) => apiKeyStatusText({ kind }));
    expect(new Set(said).size).toBe(states.length);
  });
});
