#!/usr/bin/env node
/**
 * U1 offline spike — same request shapes as the plugin, without Obsidian.
 * Usage: ANTHROPIC_API_KEY=sk-… npm run spike:api
 *
 * Verifies:
 *  1) output_config.format json_schema works with no beta header
 *  2) cache_read_input_tokens observable on 2nd per-capture call
 *  3) day-batch array output for KTD3 cost/quality comparison
 *
 * Log-safety: never prints the API key or raw request headers.
 */
const API_URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY to run the spike.");
  process.exit(1);
}

const fingerprint = `…${apiKey.slice(-4)} (len=${apiKey.length})`;

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["atom", "task", "noise"] },
    title: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    proposed_tags: { type: "array", items: { type: "string" } },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          note: { type: "string" },
          reason: { type: "string" },
        },
        required: ["note", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "title", "tags", "proposed_tags", "links"],
  additionalProperties: false,
};

const SYSTEM = `You classify fleeting captures. Output only verdict/title/tags/proposed_tags/links.
Titles for atoms are declarative claims. Conservative triage — when in doubt, noise.
Empty title for task/noise. Name supersession in link reasons when applicable.`;

const titles = [
  "Sleep debt doesn't accumulate linearly",
  "Deep work requires unbroken morning blocks",
  "Capture is cheap; review is the scarce resource",
  ...Array.from({ length: 80 }, (_, i) => `Vault note placeholder ${i + 1}`),
];

const contextText = [
  "## Vault context",
  "### Active vocabulary",
  "#idea #question #observation #reference #decision",
  "### Note titles",
  ...titles.map((t) => `- ${t}`),
].join("\n");

const captures = [
  "sleep debt seems to plateau after a few nights, not accumulate forever the way people say",
  "buy oat milk and eggs on the way home",
  "reminded me of the sleep debt idea — maybe the plateau is just denial",
];

async function post(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function usageOf(json) {
  const u = json.usage || {};
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

function parseText(json) {
  const block = (json.content || []).find((b) => b.type === "text");
  if (!block?.text) return null;
  return JSON.parse(block.text);
}

console.log("[spike] key", fingerprint, "model", MODEL);
console.log("[spike] no beta header; output_config.format = json_schema");

// --- Path A: per-capture + cache_control ---
const perUsages = [];
for (let i = 0; i < captures.length; i++) {
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: contextText,
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `## Capture\n\n${captures[i]}\n\nClassify this single capture.`,
          },
        ],
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA },
    },
  };

  const { status, json } = await post(body);
  if (status === 401 || status === 403) {
    console.error("[spike] auth failed", status);
    process.exit(1);
  }
  if (status < 200 || status >= 300) {
    console.error("[spike] per-capture failed", status, json?.error?.type || json?.type);
    process.exit(1);
  }
  const result = parseText(json);
  const usage = usageOf(json);
  perUsages.push(usage);
  console.log(`[spike] per-capture #${i + 1}`, { status, result, usage });
}

console.log("[spike] cache summary", {
  cache_creation: perUsages.map((u) => u.cache_creation_input_tokens),
  cache_read: perUsages.map((u) => u.cache_read_input_tokens),
  secondCallCacheRead: perUsages[1]?.cache_read_input_tokens ?? 0,
  verdict:
    (perUsages[1]?.cache_read_input_tokens ?? 0) > 0
      ? "CACHE HIT on call 2 — per-capture+caching works"
      : "no cache read on call 2 (under floor or caching skipped)",
});

// --- Path B: day batch ---
const batchBody = {
  model: MODEL,
  max_tokens: 2048,
  system: SYSTEM,
  messages: [
    { role: "user", content: contextText },
    {
      role: "user",
      content: [
        "## Captures (one day) — return results[] in order",
        ...captures.map((c, i) => `### Capture ${i + 1}\n${c}`),
      ].join("\n\n"),
    },
  ],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          results: { type: "array", items: CLASSIFICATION_SCHEMA },
        },
        required: ["results"],
        additionalProperties: false,
      },
    },
  },
};

const batch = await post(batchBody);
if (batch.status < 200 || batch.status >= 300) {
  console.error("[spike] day-batch failed", batch.status, batch.json?.error?.type);
  process.exit(1);
}
const batchResult = parseText(batch.json);
const batchUsage = usageOf(batch.json);
console.log("[spike] day-batch", { status: batch.status, result: batchResult, usage: batchUsage });

const perTotal = perUsages.reduce(
  (s, u) =>
    s + u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
  0,
);
const batchTotal =
  batchUsage.input_tokens +
  batchUsage.cache_creation_input_tokens +
  batchUsage.cache_read_input_tokens;

console.log("[spike] === KTD3 decision aid ===");
console.log({
  perCaptureCalls: perUsages.length,
  perCaptureTokenSum: perTotal,
  dayBatchTokenSum: batchTotal,
  secondCallCacheRead: perUsages[1]?.cache_read_input_tokens ?? 0,
  recommendation_hint:
    "Compare quality of titles/verdicts above. Prefer day-batch if quality matches and tokens lower; prefer per-capture if isolation + within-run cache hits win.",
});
