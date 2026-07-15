import { requestUrl } from "obsidian";
import type {
  ClassificationResult,
  ClassifyOutcome,
  ClassifyUsage,
  VaultContext,
  Verdict,
} from "./types";
import { filterTagsToActive } from "./vocabulary";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/** Grammar-constrained classification schema (KTD4). additionalProperties: false everywhere. */
export const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["atom", "task", "noise"],
      description:
        "Conservative triage. Prefer noise when in doubt. atom = permanent claim; task = actionable to-do; noise = discard.",
    },
    title: {
      type: "string",
      description:
        "Declarative claim title for atom verdicts (e.g. 'Sleep debt doesn't accumulate linearly'). Empty string for task/noise.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Only tags from the Active vocabulary list provided in context.",
    },
    proposed_tags: {
      type: "array",
      items: { type: "string" },
      description:
        "New tags that would help but are not in Active vocabulary. Never auto-applied.",
    },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Exact existing note title to link (rendered even if unresolved).",
          },
          reason: {
            type: "string",
            description:
              "Human-readable relationship. Name supersession when applicable: 'revises [[…]]', 'contradicts [[…]]', or 'relates because …'.",
          },
        },
        required: ["note", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "title", "tags", "proposed_tags", "links"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You classify fleeting captures from a daily-note inbox into a personal knowledge graph.

## Output surface (hard rules)
- You output ONLY: verdict, title, tags, proposed_tags, links.
- You never rewrite, paraphrase, expand, or "improve" the capture body. The body is sacred and is written elsewhere, verbatim.
- Titles (when atom) are declarative claims, not topics.
  Good: "Sleep debt doesn't accumulate linearly"
  Bad: "Sleep notes" / "Thoughts on sleep"

## Triage (conservative)
- atom: a permanent claim, observation, decision, or question worth linking into the graph.
- task: actionable to-do ("buy milk", "email X").
- noise: ephemeral, empty, or not worth keeping. When in doubt → noise.

## Tags
- tags: ONLY from the Active vocabulary provided. Drop anything else.
- proposed_tags: candidates not in Active that would help; never auto-applied.

## Links + supersession
- Link to existing notes when the capture relates, revises, or contradicts them.
- Always fill \`reason\` with readable prose that names the relationship.
- If this capture updates / revises / contradicts an existing claim, say so explicitly
  (e.g. "revises [[Old claim]]", "contradicts [[Old claim]]").
- Prefer zero links over forced ones. Unresolved targets are fine — do not invent links.

## title
- Required non-empty string iff verdict is atom.
- Empty string for task and noise.`;

export function buildContextUserMessage(context: VaultContext): string {
  const vocab = context.vocabulary.length
    ? context.vocabulary.map((t) => `#${t.replace(/^#/, "")}`).join(" ")
    : "(none)";
  const tags = context.tags.length
    ? context.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")
    : "(none)";
  // Deterministic ordering is the caller's job; we render as given so the
  // cached prefix stays byte-stable within a run (KTD3 / U4).
  const titles = context.titles.length
    ? context.titles.map((t) => `- ${t}`).join("\n")
    : "(empty vault)";

  return [
    "## Vault context (stable prefix — do not include timestamps or run IDs)",
    "",
    "### Active vocabulary",
    vocab,
    "",
    "### Tags present in vault",
    tags,
    "",
    "### Note titles",
    titles,
  ].join("\n");
}

export function buildCaptureUserMessage(capture: string): string {
  return [
    "## Capture to classify",
    "",
    capture,
    "",
    "Classify this single capture. Return only the schema fields.",
  ].join("\n");
}

/**
 * Redact a key to a short fingerprint for safe logging.
 * Never log the raw key, headers, or request bodies (U1 log-safety).
 */
export function fingerprintKey(apiKey: string): string {
  if (!apiKey) return "none";
  const tail = apiKey.slice(-4);
  return `…${tail} (len=${apiKey.length})`;
}

export function emptyUsage(): ClassifyUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

export function parseUsage(raw: unknown): ClassifyUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    input_tokens: Number(u.input_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? 0),
    cache_creation_input_tokens: Number(u.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: Number(u.cache_read_input_tokens ?? 0),
  };
}

/**
 * Post-parse business invariants (KTD4 layer 2).
 * Schema well-formedness is trusted; conditional-required is not.
 */
export function checkInvariants(
  result: ClassificationResult,
): { ok: true } | { ok: false; message: string } {
  const verdict = result.verdict as Verdict;
  if (verdict === "atom") {
    if (!result.title || !result.title.trim()) {
      return { ok: false, message: "invariant: atom verdict requires a non-empty title" };
    }
  } else if (result.title && result.title.trim()) {
    return {
      ok: false,
      message: `invariant: non-atom verdict must not carry a title (got "${result.title.slice(0, 40)}")`,
    };
  }
  return { ok: true };
}

export interface BuildRequestOptions {
  model: string;
  capture: string;
  context: VaultContext;
  /** Interactive default `5m`; batch uses `1h` (KTD3). */
  cacheTtl?: "5m" | "1h";
  maxTokens?: number;
}

/**
 * Request body per KTD3:
 * system (stable) → user context (stable, cache breakpoint) → user capture (volatile).
 */
export function buildMessagesRequest(opts: BuildRequestOptions): Record<string, unknown> {
  const cacheTtl = opts.cacheTtl ?? "5m";
  const contextText = buildContextUserMessage(opts.context);
  const captureText = buildCaptureUserMessage(opts.capture);

  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: contextText,
            cache_control: { type: "ephemeral", ttl: cacheTtl },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: captureText,
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: CLASSIFICATION_SCHEMA,
      },
    },
  };
}

/** Per-day batching fork (KTD3 open fork) — array output for N captures in one call. */
export const BATCH_CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: CLASSIFICATION_SCHEMA,
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

export function buildDayBatchRequest(opts: {
  model: string;
  captures: string[];
  context: VaultContext;
  maxTokens?: number;
}): Record<string, unknown> {
  const contextText = buildContextUserMessage(opts.context);
  const capturesBlock = opts.captures
    .map((c, i) => `### Capture ${i + 1}\n${c}`)
    .join("\n\n");

  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: contextText,
      },
      {
        role: "user",
        content: [
          "## Captures to classify (one day)",
          "",
          "Return one result per capture, same order, in `results`.",
          "",
          capturesBlock,
        ].join("\n"),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: BATCH_CLASSIFICATION_SCHEMA,
      },
    },
  };
}

export interface ClassifyDeps {
  apiKey: string;
  model: string;
  /** Injected for tests; defaults to Obsidian requestUrl. */
  request?: typeof requestUrl;
  /** Active vocabulary — model tags filtered to this set (R11). */
  activeVocabulary?: string[];
  /** Max attempts for 429/5xx (default 3). */
  maxAttempts?: number;
  /** Backoff sleeper (ms); inject no-op in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once on 401/403 so UI can Notice (KTD4). */
  onAuthFailure?: (message: string) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Classify a single capture. Request-layer defended (KTD4 layer 3).
 * Parse layer trusts schema — no try/catch around JSON.parse of completion content.
 */
export async function classifyCapture(
  capture: string,
  context: VaultContext,
  deps: ClassifyDeps,
): Promise<ClassifyOutcome> {
  const apiKey = deps.apiKey?.trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "missing_key",
      message: "Set your API key in settings",
    };
  }

  const body = buildMessagesRequest({
    model: deps.model,
    capture,
    context,
  });

  const request = deps.request ?? requestUrl;
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 3;

  let status = 0;
  let json: Record<string, unknown> = {};
  let lastTransient: ClassifyOutcome | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await request({
        url: ANTHROPIC_MESSAGES_URL,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        throw: false,
      });
      status = res.status;
      json = (typeof res.json === "object" && res.json !== null
        ? res.json
        : {}) as Record<string, unknown>;
    } catch (err) {
      // Offline / network throw — never log full error objects (may carry headers).
      const name = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : "unknown";
      // Strip anything that looks like a key if a proxy embeds it.
      const safe = msg.replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 160);
      return {
        ok: false,
        reason: "offline",
        message: `Network error calling Anthropic API (${name}: ${safe})`,
      };
    }

    if (status === 401 || status === 403) {
      const message =
        "API key rejected (401/403). Check the key in settings.";
      deps.onAuthFailure?.(message);
      return { ok: false, reason: "auth", status, message };
    }

    if (status === 429 || status >= 500) {
      lastTransient = {
        ok: false,
        reason: status === 429 ? "rate_limit" : "server",
        status,
        message:
          status === 429
            ? "Rate limited (429)"
            : `Anthropic server error (${status})`,
      };
      if (attempt < maxAttempts) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }
      return lastTransient;
    }

    if (status < 200 || status >= 300) {
      return {
        ok: false,
        reason: "unknown",
        status,
        message: `Anthropic request failed (${status})`,
      };
    }

    break; // 2xx
  }

  const content = json.content as
    | Array<{ type?: string; text?: string }>
    | undefined;
  const textBlock = content?.find(
    (b) => b.type === "text" && typeof b.text === "string",
  );
  if (!textBlock?.text) {
    return {
      ok: false,
      reason: "unknown",
      message: "Response missing text content",
    };
  }

  // Parse layer: trust structured-output schema. No try/catch around JSON.parse (KTD4).
  const parsed = JSON.parse(textBlock.text) as ClassificationResult;
  const inv = checkInvariants(parsed);
  if (!inv.ok) {
    return { ok: false, reason: "invariant", message: inv.message };
  }

  // R11 — never apply non-Active tags; proposed_tags stay for approval.
  if (deps.activeVocabulary) {
    parsed.tags = filterTagsToActive(parsed.tags ?? [], deps.activeVocabulary);
  }

  // Retain all links (KTD10) — no resolution filter.

  return {
    ok: true,
    result: parsed,
    usage: parseUsage(json.usage),
    keyFingerprint: fingerprintKey(apiKey),
  };
}

/**
 * Safe console logging for spike / dev. Never dumps headers, bodies, or full errors.
 */
export function logClassifyOutcome(label: string, outcome: ClassifyOutcome): void {
  if (outcome.ok) {
    console.log(`[ai-linker] ${label}`, {
      verdict: outcome.result.verdict,
      title: outcome.result.title,
      tags: outcome.result.tags,
      proposed_tags: outcome.result.proposed_tags,
      links: outcome.result.links,
      usage: outcome.usage,
      key: outcome.keyFingerprint,
    });
  } else {
    console.log(`[ai-linker] ${label} FAILED`, {
      reason: outcome.reason,
      status: outcome.status,
      message: outcome.message,
    });
  }
}
