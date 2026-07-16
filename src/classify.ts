import { requestUrl } from "obsidian";
import type {
  ClassificationResult,
  ClassifyOutcome,
  ClassifyUsage,
  VaultContext,
  Verdict,
} from "./types";
import {
  enrichPersonLinks,
  type PersonHub,
} from "./people";
import { enrichMediaLinks } from "./media";
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
        "Second-brain triage. Prefer atom for keepable memory (including list/media). Prefer noise for pure logistics. task is rare/legacy — almost never use it.",
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

export const SYSTEM_PROMPT = `You classify fleeting captures from a daily-note inbox into a personal knowledge graph (second brain). This product is NOT a task app — the user has Reminders/Things for chores.

## Output surface (hard rules)
- You output ONLY: verdict, title, tags, proposed_tags, links.
- You never rewrite, paraphrase, expand, or "improve" the capture body. The body is sacred and is written elsewhere, verbatim.
- You never choose folders or move files. Placement is not your job. One capture → at most one atom (never append into a Movies/list note).
- Titles (when atom) are declarative claims, not topics.
  Good: "Sleep debt doesn't accumulate linearly"
  Bad: "Sleep notes" / "Thoughts on sleep"
  Good (person): "Alex prefers periwinkle and soft pajamas"
  Bad (person): "Girlfriend notes" / "Alex stuff"
  Good (list/media): "Want to watch Past Lives" / "Severance season 2 is on the list"
  Bad (list/media): "Movies" / "Watchlist notes"

## Triage (second brain)
- atom: anything worth meeting again in the graph — claims, observations, decisions, preferences, questions, **and list/media dumps** (shows, movies, books, restaurants, want-to, try-later). If the user would want to find it later, it is an atom.
- noise: pure logistics, empty, or not worth keeping in a second brain ("buy milk", "email landlord", "call dentist at 3", lone timestamps). When in doubt between task and noise → **noise**. When in doubt between atom and noise for keepable content → **atom**.
- task: **soft-retired / almost never**. Do not use task for list items, media, preferences, or people facts. Do not use task for ordinary chores (those are noise). Only emit task if nothing else fits and the capture is a pure to-do that somehow is not noise — prefer noise.
- Durable facts about people you know (likes, habits, stories that matter) are usually atoms, not noise.
- List dumps are **one atom per capture**, with a declarative title.

## Media / watchlist dumps (high priority)
- Captures about watching/reading a named work are **media atoms**, not mere #preferences.
  Examples: "watch Past Lives", "Christian told me to watch my hero academia", "movie: Dune".
- Tags: include #watch and #show or #movie (and #media when it fits). You may also add #preferences if taste is central — but never only #preferences when a work is named.
- Links: ALWAYS put the **work title** in links[] (e.g. note: "My Hero Academia", reason: "show to watch"). Prefer an exact Note titles match when the vault already has that show/movie. Unresolved work titles are fine.
- If a person recommended it ("X told me to watch…") and X is a Person hub or Note title, ALSO link that person (person repair may reinforce).

## Tags
- tags: ONLY from the Active vocabulary list in context **plus** product structural tags (person, preferences, relationship, watch, movie, show, media, list). Drop anything else.
- Always prefer these when they fit:
  - #person — capture is primarily about a real person
  - #preferences — tastes, likes, dislikes, habits, aesthetics (not a substitute for media tags)
  - #relationship — dynamics between people
  - #watch #movie #show #media #list — list/media dumps
- proposed_tags: only for genuinely useful new labels missing from Active. Never invent a flood of tags. Never put person or show display names as tags when a note title link works better.

## People (tasteful, automatic linking)
- When the context lists **Person hubs**, prefer those exact titles for people links (must-link when the capture is about that person).
- Otherwise, when a capture is about a named person and that name appears in **Note titles**, you MUST link that exact title in links[] with a clear reason (e.g. "preference about [[Alex]]", "relates to [[Alex]]").
- Match names case-insensitively; use the vault's exact title string in links[].note (canonical hub title, not a nickname spelling).
- Do not invent a new person note title if a close existing title already fits.
- One atom can carry a person link, a work link, and preference/media tags together.
- Pure logistics that merely mention a name stay **noise** — do not force person atoms for chores.

## Links + supersession
- Link to existing notes when the capture relates, revises, or contradicts them.
- Always fill \`reason\` with readable prose that names the relationship.
- If this capture updates / revises / contradicts an existing claim, say so explicitly
  (e.g. "revises [[Old claim]]", "contradicts [[Old claim]]").
- Prefer zero forced topical links over junk edges — except people rules and media work-title links above.
- If a Movies/Shows hub title already exists in Note titles, you may also link it; still link the specific work when named.

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
  const personHubs =
    context.personHubs && context.personHubs.length
      ? context.personHubs.map((t) => `- ${t}`).join("\n")
      : "(none)";
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
    "### Person hubs (from your vault — prefer linking these exact titles)",
    personHubs,
    "",
    "### Note titles",
    titles,
  ].join("\n");
}

function hubsForEnrich(context: VaultContext): PersonHub[] {
  if (context.personHubDetails?.length) {
    return context.personHubDetails.map((d) => ({
      canonicalTitle: d.canonicalTitle,
      matchKeys: d.matchKeys,
      path: "",
    }));
  }
  return (context.personHubs ?? []).map((t) => ({
    canonicalTitle: t,
    matchKeys: [t],
    path: "",
  }));
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

  // People repair (atom-only, person-shaped) — single choke-point for live classify.
  let result = enrichPersonLinks(capture, parsed, hubsForEnrich(context));
  // Media/watchlist shape — tags + work link (high-precision local repair).
  result = enrichMediaLinks(capture, result, context.titles ?? []);

  // Retain all links (KTD10) — no resolution filter.

  return {
    ok: true,
    result,
    usage: parseUsage(json.usage),
    keyFingerprint: fingerprintKey(apiKey),
  };
}

/**
 * Safe console logging for spike / dev. Never dumps headers, bodies, or full errors.
 */
export function logClassifyOutcome(label: string, outcome: ClassifyOutcome): void {
  if (outcome.ok) {
    console.log(`[atoms] ${label}`, {
      verdict: outcome.result.verdict,
      title: outcome.result.title,
      tags: outcome.result.tags,
      proposed_tags: outcome.result.proposed_tags,
      links: outcome.result.links,
      usage: outcome.usage,
      key: outcome.keyFingerprint,
    });
  } else {
    console.log(`[atoms] ${label} FAILED`, {
      reason: outcome.reason,
      status: outcome.status,
      message: outcome.message,
    });
  }
}
