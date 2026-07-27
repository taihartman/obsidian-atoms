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
 * @param {number} maxItems
 * @param {number} maxLen
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

function hashTags(list) {
  return list.length
    ? list.map((t) => `#${String(t).replace(/^#/, "")}`).join(" ")
    : "(none)";
}

function bulletList(list, empty) {
  return list.length ? list.map((t) => `- ${t}`).join("\n") : empty;
}

/**
 * Bound vault context from client (titles / tags / vocabulary / person hubs).
 * @param {unknown} context
 */
export function boundContext(context) {
  const c =
    context && typeof context === "object"
      ? /** @type {Record<string, unknown>} */ (context)
      : {};
  const maxTitles = config.maxContextTitles;
  return {
    titles: asStringList(c.titles, maxTitles, 200),
    tags: asStringList(c.tags, 80, 64),
    vocabulary: asStringList(c.vocabulary, 80, 64),
    personHubs: asStringList(c.personHubs, 40, 120),
  };
}

export function buildContextUserMessage(context) {
  return [
    "## Vault context (stable prefix — do not include timestamps or run IDs)",
    "",
    "### Active vocabulary",
    hashTags(context.vocabulary),
    "",
    "### Tags present in vault",
    hashTags(context.tags),
    "",
    "### Person hubs (from your vault — prefer linking these exact titles)",
    bulletList(context.personHubs, "(none)"),
    "",
    "### Note titles",
    bulletList(context.titles, "(empty vault)"),
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

function reject(status, message) {
  return { ok: false, status, message };
}

/**
 * Build Anthropic Messages body server-side. Client may send capture + context only.
 * messagesRequest is ignored (and oversized bodies rejected).
 * @param {{ messagesRequest?: object, capture?: string, context?: unknown }} body
 */
export function buildClassifyPayload(body) {
  const maxBytes = 100_000;
  try {
    if (JSON.stringify(body ?? {}).length > maxBytes) {
      return reject(413, "Classify request too large");
    }
  } catch {
    return reject(400, "Invalid classify body");
  }

  const capture = String(body?.capture ?? "").trim();
  if (!capture) return reject(400, "capture is required");
  if (capture.length > config.maxCaptureChars) {
    return reject(
      413,
      `capture exceeds ${config.maxCaptureChars} characters`,
    );
  }

  const ctx = boundContext(body?.context);
  /** @type {Record<string, unknown>} */
  const outputConfig = {
    format: {
      type: "json_schema",
      schema: CLASSIFICATION_SCHEMA,
    },
  };
  // effort is optional; omit when unset so API keeps its model default (high).
  if (config.anthropicEffort) {
    outputConfig.effort = config.anthropicEffort;
  }
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
            text: buildContextUserMessage(ctx),
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildCaptureUserMessage(capture),
          },
        ],
      },
    ],
    output_config: outputConfig,
  };

  return {
    ok: true,
    payload,
    ignoredClientMessagesRequest: Boolean(body?.messagesRequest),
  };
}

/**
 * @param {{ messagesRequest?: object, capture?: string, context?: unknown }} body
 */
export async function proxyClassify(body) {
  if (!config.anthropicApiKey) {
    return reject(503, "Plus service missing ANTHROPIC_API_KEY");
  }

  const built = buildClassifyPayload(body);
  if (!built.ok) return built;

  try {
    const res = await fetch(config.anthropicUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": config.anthropicVersion,
      },
      body: JSON.stringify(built.payload),
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
