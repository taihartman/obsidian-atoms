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

/**
 * Longest string that can still be a note title. Obsidian titles come from filenames,
 * which the filesystem caps at 255 bytes; anything longer is prose, not a title.
 */
const MAX_TITLE_CHARS = 255;

/** Context keys that would carry note text. Titles-only is the contract (R6). */
const BODY_BEARING_KEYS = [
  "body",
  "bodies",
  "noteBody",
  "noteBodies",
  "content",
  "contents",
  "text",
  "texts",
  "excerpt",
  "excerpts",
  "snippet",
  "snippets",
  "documents",
];

/**
 * Refuse a context that carries note text. Vault→cloud is a titles-only allowlist, and the
 * service asserts that rather than trusting whatever client is on the other end.
 *
 * Two rules, both chosen to be things a real title cannot be:
 *  - a body-bearing key with content in it (catches the honest mistake), and
 *  - a title-list entry with a line break, or longer than a filename can be (catches the
 *    same text renamed into `titles`).
 *
 * @returns {string|null} reason, or null when the context is clean. Never echoes content.
 */
function findBodyLeak(context) {
  for (const key of BODY_BEARING_KEYS) {
    const v = context[key];
    if (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.length : false) {
      return `context.${key}`;
    }
  }
  for (const key of ["titles", "personHubs", "tags", "vocabulary"]) {
    const list = context[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const s = typeof item === "string" ? item : "";
      if (/[\r\n]/.test(s)) return `context.${key} (line break)`;
      if (s.length > MAX_TITLE_CHARS) return `context.${key} (too long for a title)`;
    }
  }
  return null;
}

/**
 * How many titles this request may forward.
 *
 * A ranked request said so explicitly (`ranked: true`, or it sent its `shortlist`), and its
 * order is the device's BM25 score order — the whole point of the shortlist. An unranked
 * request is an older build sending the vault alphabetically; it keeps the legacy cap,
 * because raising it would only buy more alphabet.
 */
function titleCap(context) {
  const ranked =
    context.ranked === true || Array.isArray(context.shortlist);
  if (!ranked) return { ranked, cap: config.maxLegacyContextTitles };
  const ceiling = config.maxContextTitles;
  const asked = Number(context.k ?? context.stats?.k);
  const cap =
    Number.isFinite(asked) && asked > 0 ? Math.min(asked, ceiling) : ceiling;
  return { ranked, cap };
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
 *
 * `titles` arrive best-first from the device's scorer and are **never re-sorted here**:
 * every reordering the service does is a note the subscriber silently loses the ability
 * to link to. Truncation takes the first `cap` by received rank, nothing else.
 *
 * @param {unknown} context
 */
export function boundContext(context) {
  const c =
    context && typeof context === "object"
      ? /** @type {Record<string, unknown>} */ (context)
      : {};
  const { ranked, cap } = titleCap(c);
  return {
    titles: asStringList(c.titles, cap, MAX_TITLE_CHARS),
    tags: asStringList(c.tags, 80, 64),
    vocabulary: asStringList(c.vocabulary, 80, 64),
    personHubs: asStringList(c.personHubs, 40, 120),
    ranked,
    bodyLeak: findBodyLeak(c),
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
  const maxBytes = config.maxClassifyBytes;
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
  if (ctx.bodyLeak) {
    // Name the field, never its content (log safety).
    return reject(
      400,
      `Plus receives note titles only — ${ctx.bodyLeak} looks like note text`,
    );
  }
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
