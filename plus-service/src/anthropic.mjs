/**
 * Classify proxy — server owns Anthropic payload (U4 / KTD-B3).
 * Never forward raw client messagesRequest. Never log API keys.
 */
import { config } from "./config.mjs";
import {
  CLASSIFICATION_SCHEMA,
  SYSTEM_PROMPT,
} from "./classifyTemplate.mjs";

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function asStringList(raw, maxItems, maxLen) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= maxItems) break;
    const s = String(item ?? "").trim().slice(0, maxLen);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Bound vault context from client (titles / tags / vocabulary / person hubs).
 * @param {unknown} context
 */
export function boundContext(context) {
  const c = context && typeof context === "object" ? context : {};
  const maxTitles = config.maxContextTitles;
  return {
    titles: asStringList(/** @type {any} */ (c).titles, maxTitles, 200),
    tags: asStringList(/** @type {any} */ (c).tags, 80, 64),
    vocabulary: asStringList(/** @type {any} */ (c).vocabulary, 80, 64),
    personHubs: asStringList(/** @type {any} */ (c).personHubs, 40, 120),
  };
}

export function buildContextUserMessage(context) {
  const vocab = context.vocabulary.length
    ? context.vocabulary.map((t) => `#${t.replace(/^#/, "")}`).join(" ")
    : "(none)";
  const tags = context.tags.length
    ? context.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")
    : "(none)";
  const personHubs = context.personHubs.length
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

export function buildCaptureUserMessage(capture) {
  return [
    "## Capture to classify",
    "",
    capture,
    "",
    "Classify this single capture. Return only the schema fields.",
  ].join("\n");
}

/**
 * Build Anthropic Messages body server-side. Client may send capture + context only.
 * messagesRequest is ignored (and oversized bodies rejected).
 * @param {{ messagesRequest?: object, capture?: string, context?: unknown }} body
 */
export function buildClassifyPayload(body) {
  // Reject huge client blobs before work (including ignored messagesRequest)
  const maxBytes = 100_000;
  try {
    const probe = JSON.stringify(body ?? {});
    if (probe.length > maxBytes) {
      return {
        ok: false,
        status: 413,
        message: "Classify request too large",
      };
    }
  } catch {
    return { ok: false, status: 400, message: "Invalid classify body" };
  }

  const capture = String(body?.capture ?? "").trim();
  if (!capture) {
    return {
      ok: false,
      status: 400,
      message: "capture is required",
    };
  }
  if (capture.length > config.maxCaptureChars) {
    return {
      ok: false,
      status: 413,
      message: `capture exceeds ${config.maxCaptureChars} characters`,
    };
  }

  const ctx = boundContext(body?.context);
  const contextText = buildContextUserMessage(ctx);
  const captureText = buildCaptureUserMessage(capture);

  const payload = {
    model: config.anthropicModel,
    max_tokens: config.maxTokens,
    system: SYSTEM_PROMPT,
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

  return { ok: true, payload, ignoredClientMessagesRequest: Boolean(body?.messagesRequest) };
}

/**
 * @param {{ messagesRequest?: object, capture?: string, context?: unknown }} body
 */
export async function proxyClassify(body) {
  if (!config.anthropicApiKey) {
    return {
      ok: false,
      status: 503,
      message: "Plus service missing ANTHROPIC_API_KEY",
    };
  }

  const built = buildClassifyPayload(body);
  if (!built.ok) return built;
  const payload = built.payload;

  try {
    const res = await fetch(config.anthropicUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": config.anthropicVersion,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message:
          res.status === 401 || res.status === 403
            ? "Upstream model auth failed"
            : `Upstream model error (${res.status})`,
        json,
      };
    }
    return { ok: true, status: res.status, json };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return {
      ok: false,
      status: 0,
      message: `Upstream network error: ${msg.slice(0, 120)}`,
    };
  }
}
