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

/**
 * Headroom past `maxContextTitles` for graph-expansion slots the device appends after the
 * scored shortlist. Keep in lockstep with `EXPANSION_SLOTS` in the plugin's `expand.ts`.
 */
const EXPANSION_SLOTS = 32;

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
 *
 * Ranked caps leave room for graph-expansion slots the device appends **after** the scored
 * top-k (up to EXPANSION_SLOTS). Clamping to bare `k` silently dropped those tails.
 */
function titleCap(context) {
  const ranked =
    context.ranked === true || Array.isArray(context.shortlist);
  if (!ranked) return { ranked, cap: config.maxLegacyContextTitles };
  const base = config.maxContextTitles;
  // Device already truncated. Prefer stats.returned (scored k + expansion tail) when present;
  // otherwise honour k / the configured ceiling. Do not invent +32 headroom without returned —
  // that would raise every small-k request and break the maxContextTitles knob.
  const returned = Number(context.stats?.returned);
  if (Number.isFinite(returned) && returned > 0) {
    return { ranked, cap: Math.min(returned, base + EXPANSION_SLOTS) };
  }
  const asked = Number(context.k ?? context.stats?.k);
  if (Number.isFinite(asked) && asked > 0) {
    return { ranked, cap: Math.min(asked, base) };
  }
  return { ranked, cap: base };
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
  /** @type {{ title: string, path?: string } | null} */
  let continueParent = null;
  const cpRaw = c.continueParent;
  if (cpRaw && typeof cpRaw === "object" && !Array.isArray(cpRaw)) {
    const cp = /** @type {Record<string, unknown>} */ (cpRaw);
    const title = typeof cp.title === "string" ? cp.title.trim() : "";
    if (title) {
      continueParent = { title: title.slice(0, MAX_TITLE_CHARS) };
      if (typeof cp.path === "string" && cp.path.trim()) {
        continueParent.path = cp.path.trim().slice(0, 240);
      }
    }
  }
  return {
    titles: asStringList(c.titles, cap, MAX_TITLE_CHARS),
    tags: asStringList(c.tags, 80, 64),
    vocabulary: asStringList(c.vocabulary, 80, 64),
    personHubs: asStringList(c.personHubs, 40, 120),
    continueParent,
    // Which cap regime applied — ranked shortlist or the legacy alphabetical 40. Not read when
    // building the prompt; it is here so a caller (and the suite) can tell the two apart from the
    // result, rather than inferring a regime from how many titles happened to survive.
    ranked,
    bodyLeak: findBodyLeak(c),
  };
}

/** Block A — vocabulary / tags / hubs. Byte-stable within a run; carries cache_control. */
export function buildStableContextText(context) {
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
  ].join("\n");
}

/** Block B — shortlisted titles. Volatile per capture; never cached. */
export function buildTitlesText(context) {
  return ["### Note titles", bulletList(context.titles, "(empty vault)")].join(
    "\n",
  );
}

/**
 * Full context message as one string (stable + titles). Kept for callers/tests that want the
 * joined bytes; the live Anthropic payload uses two content blocks so the cache breakpoint
 * sits between them.
 */
export function buildContextUserMessage(context) {
  return [buildStableContextText(context), buildTitlesText(context)].join(
    "\n\n",
  );
}

export function buildCaptureUserMessage(capture, continueParent = null) {
  const parts = ["## Capture to classify", "", capture, ""];
  const title =
    continueParent && typeof continueParent.title === "string"
      ? continueParent.title.trim()
      : "";
  if (title) {
    parts.push("### Continue parent", `Title: ${title}`);
    const path =
      continueParent && typeof continueParent.path === "string"
        ? continueParent.path.trim()
        : "";
    if (path) parts.push(`Path: ${path}`);
    parts.push("");
  }
  parts.push("Classify this single capture. Return only the schema fields.");
  return parts.join("\n");
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
          // Index 0: stable prefix only — cache_control lives here so a per-capture shortlist
          // does not pay a write premium on bytes nobody will ever read back.
          {
            type: "text",
            text: buildStableContextText(ctx) + "\n\n",
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
          // Index 1: volatile titles — no cache_control.
          {
            type: "text",
            text: buildTitlesText(ctx),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildCaptureUserMessage(capture, ctx.continueParent),
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
