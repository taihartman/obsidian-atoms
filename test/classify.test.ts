import { describe, expect, it, vi } from "vitest";
import {
  buildMessagesRequest,
  checkInvariants,
  classifyCapture,
  fingerprintKey,
} from "../src/classify";
import type { VaultContext } from "../src/types";
import { filterTagsToActive } from "../src/vocabulary";

const ctx: VaultContext = {
  titles: ["Sleep debt doesn't accumulate linearly", "Other note"],
  tags: ["idea", "observation"],
  vocabulary: ["idea", "observation"],
};

function mockResponse(opts: {
  status: number;
  text?: string;
  usage?: Record<string, number>;
  throwError?: boolean;
}) {
  return vi.fn(async () => {
    if (opts.throwError) throw new Error("offline");
    return {
      status: opts.status,
      json: {
        content: opts.text
          ? [{ type: "text", text: opts.text }]
          : [],
        usage: opts.usage ?? {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 0,
        },
      },
    };
  });
}

describe("request shape (KTD3)", () => {
  it("places cache_control on context; capture after breakpoint", () => {
    const body = buildMessagesRequest({
      model: "claude-sonnet-5",
      capture: "volatile capture text",
      context: ctx,
    });
    const messages = body.messages as Array<{
      content: Array<{ text?: string; cache_control?: unknown }>;
    }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content[0]!.cache_control).toEqual({
      type: "ephemeral",
      ttl: "5m",
    });
    expect(messages[1]!.content[0]!.cache_control).toBeUndefined();
    expect(messages[1]!.content[0]!.text).toContain("volatile capture text");
    const prefix = JSON.stringify(messages[0]);
    expect(prefix).not.toMatch(/volatile capture/);
    expect(prefix).not.toMatch(/run[_-]?id/i);
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("stable prefix bytes for two captures differ only after breakpoint", () => {
    const a = buildMessagesRequest({
      model: "claude-sonnet-5",
      capture: "one",
      context: ctx,
    });
    const b = buildMessagesRequest({
      model: "claude-sonnet-5",
      capture: "two",
      context: ctx,
    });
    const ma = a.messages as Array<{ content: Array<{ text?: string }> }>;
    const mb = b.messages as Array<{ content: Array<{ text?: string }> }>;
    expect(ma[0]!.content[0]!.text).toBe(mb[0]!.content[0]!.text);
    expect(ma[1]!.content[0]!.text).not.toBe(mb[1]!.content[0]!.text);
  });
});

describe("invariants (KTD4 layer 2)", () => {
  it("rejects atom without title", () => {
    expect(
      checkInvariants({
        verdict: "atom",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      }).ok,
    ).toBe(false);
  });

  it("rejects non-atom with title", () => {
    expect(
      checkInvariants({
        verdict: "noise",
        title: "should not be here",
        tags: [],
        proposed_tags: [],
        links: [],
      }).ok,
    ).toBe(false);
  });

  it("accepts valid atom / task", () => {
    expect(
      checkInvariants({
        verdict: "atom",
        title: "A claim",
        tags: ["idea"],
        proposed_tags: [],
        links: [],
      }).ok,
    ).toBe(true);
    expect(
      checkInvariants({
        verdict: "task",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      }).ok,
    ).toBe(true);
  });
});

describe("classifyCapture request layer", () => {
  it("parses schema-valid response without try/catch issues", async () => {
    const request = mockResponse({
      status: 200,
      text: JSON.stringify({
        verdict: "atom",
        title: "Sleep debt plateaus",
        tags: ["idea", "health"],
        proposed_tags: ["sleep"],
        links: [
          {
            note: "Sleep debt doesn't accumulate linearly",
            reason: "revises [[Sleep debt doesn't accumulate linearly]]",
          },
        ],
      }),
      usage: {
        input_tokens: 5,
        output_tokens: 20,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 0,
      },
    });
    const outcome = await classifyCapture("sleep hunch", ctx, {
      apiKey: "sk-ant-test-key-xxxx",
      model: "claude-sonnet-5",
      request: request as never,
      activeVocabulary: ["idea", "observation"],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Active filter drops health
    expect(outcome.result.tags).toEqual(["idea"]);
    expect(outcome.result.proposed_tags).toContain("sleep");
    // Unresolved-style link retained (KTD10) — we don't drop links
    expect(outcome.result.links).toHaveLength(1);
    expect(outcome.result.links[0]!.reason).toMatch(/revises/);
    expect(outcome.keyFingerprint).toBe(fingerprintKey("sk-ant-test-key-xxxx"));
  });

  it("offline throw → fail silent sentinel", async () => {
    const outcome = await classifyCapture("x", ctx, {
      apiKey: "sk-test",
      model: "m",
      request: mockResponse({ status: 0, throwError: true }) as never,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("offline");
  });

  it("429 retried then succeeds", async () => {
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { status: 429, json: {} };
      }
      return {
        status: 200,
        json: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                verdict: "noise",
                title: "",
                tags: [],
                proposed_tags: [],
                links: [],
              }),
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 50,
          },
        },
      };
    });
    const outcome = await classifyCapture("meh", ctx, {
      apiKey: "sk-test",
      model: "m",
      request: request as never,
      sleep: async () => {}, // no real backoff in tests
    });
    expect(calls).toBe(2);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.usage.cache_read_input_tokens).toBe(50);
    }
  });

  it("401 is auth, not retried", async () => {
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      return { status: 401, json: {} };
    });
    const notices: string[] = [];
    const outcome = await classifyCapture("x", ctx, {
      apiKey: "sk-bad",
      model: "m",
      request: request as never,
      onAuthFailure: (msg) => notices.push(msg),
    });
    expect(calls).toBe(1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("auth");
    expect(notices.length).toBe(1);
  });

  it("missing key does not call network", async () => {
    const request = vi.fn();
    const outcome = await classifyCapture("x", ctx, {
      apiKey: "",
      model: "m",
      request: request as never,
    });
    expect(request).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("missing_key");
  });

  it("invariant failure on atom without title", async () => {
    const request = mockResponse({
      status: 200,
      text: JSON.stringify({
        verdict: "atom",
        title: "",
        tags: [],
        proposed_tags: [],
        links: [],
      }),
    });
    const outcome = await classifyCapture("x", ctx, {
      apiKey: "sk",
      model: "m",
      request: request as never,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("invariant");
  });

  it("fingerprint never equals full key", () => {
    const key = "sk-ant-api03-secretvalue";
    const fp = fingerprintKey(key);
    expect(fp).not.toContain("secretvalue");
    expect(fp).toContain("…");
  });
});

describe("tag filter integration", () => {
  it("drops non-active tags", () => {
    expect(filterTagsToActive(["idea", "zz"], ["idea"])).toEqual(["idea"]);
  });
});
