/**
 * Atoms Plus HTTP client (U2). Injectable request; never logs session tokens.
 *
 * Prefer {@link plusFetchRequest} over Obsidian `requestUrl` for Plus:
 * desktop `requestUrl` often fails to localhost (`net::ERR_FAILED`) while
 * renderer `fetch` works. Production Plus is CORS-enabled (`*`).
 */

import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { PlusEntitlementStatus, PlusSession } from "./filingAuth";

export type RequestFn = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

/**
 * Fetch-backed request matching the subset of requestUrl we use (status/json/text).
 * Does not throw on HTTP 4xx/5xx (like requestUrl with throw:false).
 *
 * Intentional `fetch` (not requestUrl): desktop requestUrl often fails to localhost
 * (`net::ERR_FAILED`) while renderer fetch works; production Plus is CORS-enabled.
 */
export async function plusFetchRequest(
  params: RequestUrlParam,
): Promise<RequestUrlResponse> {
  // Community review: prefer requestUrl — see docstring (localhost + CORS).
  const res = await fetch(params.url, {
    method: params.method ?? "GET",
    headers: params.headers,
    body:
      params.body === undefined || params.body === null
        ? undefined
        : typeof params.body === "string"
          ? params.body
          : String(params.body),
  });
  const text = await res.text();
  // Unparseable body stays `undefined` (not `{}`) so plusRequest can tell a
  // gateway's HTML apart from a real empty 2xx and never invents fields.
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = undefined;
  }
  const bytes = new TextEncoder().encode(text);
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const out: RequestUrlResponse = {
    status: res.status,
    headers,
    text,
    json,
    arrayBuffer: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  };
  return out;
}

export type PlusCheckoutKind =
  | "subscribe_monthly"
  | "subscribe_yearly"
  | "topup_50"
  | "start_trial";

export type PlusEntitlement = {
  status: PlusEntitlementStatus;
  remaining: number;
  periodEnd?: string;
  plan?: "monthly" | "yearly" | "trial" | "promo";
  email?: string;
};

export type PlusClientConfig = {
  baseUrl: string;
  request: RequestFn;
};

export type PlusApiError = {
  ok: false;
  status: number;
  /** User-safe message (no secrets). */
  message: string;
  /**
   * Structured code when known. `auth` means our service rejected the session;
   * `upstream` is a 401/403 we cannot attribute (gateway, proxy, WAF).
   */
  code?: "exhausted" | "auth" | "upstream" | "network" | "unknown";
};

/** Shown when the service answers with something we cannot read as JSON. */
export const UNREADABLE_RESPONSE_MESSAGE =
  "Atoms Plus sent a reply this device could not read. Nothing changed here — try again in a moment.";

/** Shown when our own service rejects the device session (401/403 with a body). */
export const SESSION_REJECTED_MESSAGE =
  "Your Atoms Plus session is no longer valid. Sign in again to reconnect this device.";

/**
 * Upstream markers that mean the *session* is the problem. Shared with
 * classify.ts so both surfaces judge a 401/403 by the same rule: an explained
 * refusal like "Plus entitlement required" is not a sign-in problem.
 */
export function isSessionRejectedMessage(msg: string | undefined): boolean {
  const m = (msg ?? "").toLowerCase();
  return m.includes("invalid session") || m.includes("expired");
}

/**
 * 401/403 with no service-shaped body — a gateway, proxy or WAF refused the
 * call, so blaming the session would be a lie (mirrors classify.ts wording).
 */
export function upstreamRefusedMessage(status: number): string {
  return `Atoms Plus refused this request (HTTP ${status}) for an unexpected reason. Your session on this device looks fine — try again in a moment.`;
}

function redact(msg: string): string {
  return msg
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sess_[a-zA-Z0-9_-]+/g, "[redacted]")
    .slice(0, 200);
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

type PlusHttpOk = { ok: true; status: number; json: Record<string, unknown> };

async function plusRequest(
  cfg: PlusClientConfig,
  opts: {
    path: string;
    method: string;
    sessionToken?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<PlusHttpOk | PlusApiError> {
  const base = cfg.baseUrl?.trim();
  if (!base) {
    return {
      ok: false,
      status: 0,
      code: "unknown",
      message: "Plus service URL not configured",
    };
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...opts.headers,
  };
  if (opts.sessionToken?.trim()) {
    headers.authorization = `Bearer ${opts.sessionToken.trim()}`;
  }
  try {
    const res = await cfg.request({
      url: joinUrl(base, opts.path),
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      throw: false,
    });
    const json =
      typeof res.json === "object" && res.json !== null
        ? (res.json as Record<string, unknown>)
        : null;
    if (!json) {
      const hasBody = typeof res.text === "string" && res.text.trim() !== "";
      // A 2xx we cannot read is an error, never an empty success — callers
      // would otherwise write invented defaults over a good session.
      if (hasBody && res.status >= 200 && res.status < 300) {
        return {
          ok: false,
          status: res.status,
          code: "unknown",
          message: UNREADABLE_RESPONSE_MESSAGE,
        };
      }
      return { ok: true, status: res.status, json: {} };
    }
    return { ok: true, status: res.status, json };
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    const msg = err instanceof Error ? err.message : "unknown";
    return {
      ok: false,
      status: 0,
      code: "network",
      message: `Plus network error (${name}: ${redact(msg)})`,
    };
  }
}

function mapError(
  status: number,
  json: Record<string, unknown>,
): PlusApiError {
  const explained =
    typeof json.message === "string" || typeof json.error === "string";
  const rawMsg =
    typeof json.message === "string"
      ? json.message
      : typeof json.error === "string"
        ? json.error
        : `Plus request failed (HTTP ${status})`;
  if (status === 401 || status === 403) {
    // Three branches, because "401" alone says nothing about the session:
    // session markers → sign in; any other explained refusal (entitlement
    // required, rate limit) → the service's own accurate sentence; no body at
    // all → an upstream refusal we cannot attribute.
    if (!explained) {
      return {
        ok: false,
        status,
        code: "upstream",
        message: upstreamRefusedMessage(status),
      };
    }
    return isSessionRejectedMessage(rawMsg)
      ? { ok: false, status, code: "auth", message: SESSION_REJECTED_MESSAGE }
      : { ok: false, status, code: "unknown", message: redact(rawMsg) };
  }
  if (status === 402) {
    return {
      ok: false,
      status,
      code: "exhausted",
      message:
        "Included filings used up this period. Wait for reset or buy a top-up.",
    };
  }
  return {
    ok: false,
    status,
    code: "unknown",
    message: redact(rawMsg),
  };
}

/** Stated plan status, or null when the service did not say. */
function parseStatus(
  json: Record<string, unknown>,
): PlusEntitlementStatus | null {
  const raw = json.status;
  return raw === "active" ||
    raw === "trialing" ||
    raw === "exhausted" ||
    raw === "inactive" ||
    raw === "unknown"
    ? raw
    : null;
}

/** Stated remaining filings, or null when the service did not say. */
function parseRemaining(json: Record<string, unknown>): number | null {
  return typeof json.remaining === "number" && Number.isFinite(json.remaining)
    ? Math.max(0, Math.floor(json.remaining))
    : null;
}

function parsePeriodEnd(json: Record<string, unknown>): string | undefined {
  return typeof json.periodEnd === "string" ? json.periodEnd : undefined;
}

/**
 * Strict: returns null unless the service actually said what the plan is.
 * A missing `status`/`remaining` used to coerce to `unknown`/0, which callers
 * then wrote over a live `trialing` session (Issue #230). Fields are parsed
 * independently so callers that only need one can keep a stated value.
 */
function parseEntitlement(
  json: Record<string, unknown>,
): PlusEntitlement | null {
  const status = parseStatus(json);
  const remaining = parseRemaining(json);
  if (!status || remaining === null) return null;
  return {
    status,
    remaining,
    periodEnd: parsePeriodEnd(json),
    plan:
      json.plan === "monthly" ||
      json.plan === "yearly" ||
      json.plan === "trial" ||
      json.plan === "promo"
        ? json.plan
        : undefined,
    email: typeof json.email === "string" ? json.email : undefined,
  };
}

export async function requestMagicLink(
  cfg: PlusClientConfig,
  email: string,
): Promise<{ ok: true } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/auth/magic-link",
    method: "POST",
    body: { email: email.trim() },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return { ok: true };
}

/**
 * Soft account + device session (inactive). Entitled emails → needsMagicLink.
 */
export async function startPlusAccount(
  cfg: PlusClientConfig,
  email: string,
): Promise<
  | { ok: true; session: PlusSession }
  | { ok: false; needsMagicLink: true; email: string; message: string }
  | PlusApiError
> {
  const res = await plusRequest(cfg, {
    path: "/v1/auth/start",
    method: "POST",
    body: { email: email.trim() },
  });
  if (!res.ok) return res;
  if (res.status === 409 || res.json.needsMagicLink === true) {
    const em =
      typeof res.json.email === "string" ? res.json.email : email.trim();
    return {
      ok: false,
      needsMagicLink: true,
      email: em,
      message:
        typeof res.json.message === "string"
          ? res.json.message
          : "Sign in with a magic link for this email",
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const sessionToken =
    typeof res.json.session === "string"
      ? res.json.session
      : typeof res.json.sessionToken === "string"
        ? res.json.sessionToken
        : "";
  const em = typeof res.json.email === "string" ? res.json.email : "";
  if (!sessionToken || !em) {
    return {
      ok: false,
      status: res.status,
      code: "unknown",
      message: "Plus start response missing session",
    };
  }
  // Start hands back a soft session; only an *unstated* plan is "inactive".
  const status = parseStatus(res.json);
  return {
    ok: true,
    session: {
      sessionToken,
      email: em,
      status: !status || status === "unknown" ? "inactive" : status,
      remaining: parseRemaining(res.json) ?? 0,
      periodEnd: parsePeriodEnd(res.json),
      refreshedAt: Date.now(),
    },
  };
}

export async function exchangeMagicToken(
  cfg: PlusClientConfig,
  token: string,
): Promise<{ ok: true; session: PlusSession } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/auth/exchange",
    method: "POST",
    body: { token: token.trim() },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const sessionToken =
    typeof res.json.session === "string"
      ? res.json.session
      : typeof res.json.sessionToken === "string"
        ? res.json.sessionToken
        : "";
  const email = typeof res.json.email === "string" ? res.json.email : "";
  if (!sessionToken || !email) {
    return {
      ok: false,
      status: res.status,
      code: "unknown",
      message: "Plus auth response missing session",
    };
  }
  // Exchange proves the session; only an *unstated* plan is treated as active,
  // so a stated "exhausted"/"inactive" is never upgraded by a missing field.
  const status = parseStatus(res.json);
  return {
    ok: true,
    session: {
      sessionToken,
      email,
      status: !status || status === "unknown" ? "active" : status,
      remaining: parseRemaining(res.json) ?? undefined,
      periodEnd: parsePeriodEnd(res.json),
      refreshedAt: Date.now(),
    },
  };
}

export async function getEntitlement(
  cfg: PlusClientConfig,
  sessionToken: string,
): Promise<{ ok: true; entitlement: PlusEntitlement } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/me",
    method: "GET",
    sessionToken,
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const entitlement = parseEntitlement(res.json);
  if (!entitlement) {
    // Partial 2xx: better no answer than a fabricated "unknown / 0 filings".
    return {
      ok: false,
      status: res.status,
      code: "unknown",
      message: UNREADABLE_RESPONSE_MESSAGE,
    };
  }
  return { ok: true, entitlement };
}

export type ProxyClassifyBody = {
  capture: string;
  /** Opaque context blob the service forwards / hashes — plugin sends built messages body fields. */
  model?: string;
  context: unknown;
  /** Full Anthropic-shaped messages request body when proxy expects passthrough. */
  messagesRequest?: Record<string, unknown>;
};

export type ProxyClassifySuccess = {
  ok: true;
  /** Anthropic-shaped JSON or already-parsed classification. */
  payload: Record<string, unknown>;
  remaining?: number;
  status?: PlusEntitlementStatus;
  usageId?: string;
};

export async function classifyViaProxy(
  cfg: PlusClientConfig,
  sessionToken: string,
  body: ProxyClassifyBody,
  opts?: { idempotencyKey?: string },
): Promise<ProxyClassifySuccess | PlusApiError> {
  const key =
    opts?.idempotencyKey?.trim() ||
    `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const res = await plusRequest(cfg, {
    path: "/v1/classify",
    method: "POST",
    sessionToken,
    body,
    headers: { "Idempotency-Key": key },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const remaining =
    typeof res.json.remaining === "number" ? res.json.remaining : undefined;
  const status =
    res.json.status === "active" ||
    res.json.status === "trialing" ||
    res.json.status === "exhausted" ||
    res.json.status === "inactive" ||
    res.json.status === "unknown"
      ? res.json.status
      : undefined;
  // Accept either { result, ... } or raw Anthropic messages response
  const payload =
    typeof res.json.result === "object" && res.json.result !== null
      ? (res.json.result as Record<string, unknown>)
      : res.json;
  return {
    ok: true,
    payload,
    remaining,
    status,
    usageId: typeof res.json.usageId === "string" ? res.json.usageId : undefined,
  };
}

export async function createCheckout(
  cfg: PlusClientConfig,
  sessionToken: string,
  kind: PlusCheckoutKind,
): Promise<{ ok: true; url: string } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/billing/checkout",
    method: "POST",
    sessionToken,
    body: { kind },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const url = typeof res.json.url === "string" ? res.json.url : "";
  if (!url) {
    return {
      ok: false,
      status: res.status,
      code: "unknown",
      message: "Checkout response missing url",
    };
  }
  return { ok: true, url };
}

export async function createBillingPortal(
  cfg: PlusClientConfig,
  sessionToken: string,
): Promise<{ ok: true; url: string } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/billing/portal",
    method: "POST",
    sessionToken,
    body: {},
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const url = typeof res.json.url === "string" ? res.json.url : "";
  if (!url) {
    return {
      ok: false,
      status: res.status,
      code: "unknown",
      message: "Portal response missing url",
    };
  }
  return { ok: true, url };
}

export async function signOutPlus(
  cfg: PlusClientConfig,
  sessionToken: string,
): Promise<{ ok: true } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/auth/sign-out",
    method: "POST",
    sessionToken,
    body: {},
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return { ok: true };
}

export async function askMirrorUpsert(
  cfg: PlusClientConfig,
  sessionToken: string,
  atoms: Array<{
    path: string;
    title: string;
    body: string;
    tags?: string[];
    links?: { note: string; reason?: string }[];
  }>,
): Promise<{ ok: true; count: number; upserted: number } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/mirror/upsert",
    method: "POST",
    sessionToken,
    body: { atoms },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const count = typeof res.json.count === "number" ? res.json.count : 0;
  const upserted =
    typeof res.json.upserted === "number" ? res.json.upserted : 0;
  return { ok: true, count, upserted };
}

export async function askMirrorWipe(
  cfg: PlusClientConfig,
  sessionToken: string,
): Promise<{ ok: true } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/mirror/wipe",
    method: "POST",
    sessionToken,
    body: {},
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return { ok: true };
}

export async function askMirrorStatus(
  cfg: PlusClientConfig,
  sessionToken: string,
): Promise<{ ok: true; count: number; updatedAt: string | null } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/mirror/status",
    method: "GET",
    sessionToken,
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return {
    ok: true,
    count: typeof res.json.count === "number" ? res.json.count : 0,
    updatedAt:
      typeof res.json.updatedAt === "string" ? res.json.updatedAt : null,
  };
}

export async function askMirrorDelete(
  cfg: PlusClientConfig,
  sessionToken: string,
  paths: string[],
): Promise<
  | { ok: true; deleted: number; missing: number; count: number }
  | PlusApiError
> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/mirror/delete",
    method: "POST",
    sessionToken,
    body: { paths },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return {
    ok: true,
    deleted: typeof res.json.deleted === "number" ? res.json.deleted : 0,
    missing: typeof res.json.missing === "number" ? res.json.missing : 0,
    count: typeof res.json.count === "number" ? res.json.count : 0,
  };
}

export async function askMirrorReconcile(
  cfg: PlusClientConfig,
  sessionToken: string,
  opts: {
    keepPaths: string[];
    done?: boolean;
    reconcileSessionId?: string;
    confirmEmpty?: boolean;
  },
): Promise<
  | { ok: true; deleted: number; count: number; staged?: number }
  | PlusApiError
> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/mirror/reconcile",
    method: "POST",
    sessionToken,
    body: {
      keepPaths: opts.keepPaths,
      done: opts.done ?? true,
      reconcileSessionId: opts.reconcileSessionId,
      confirmEmpty: opts.confirmEmpty,
    },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return {
    ok: true,
    deleted: typeof res.json.deleted === "number" ? res.json.deleted : 0,
    count: typeof res.json.count === "number" ? res.json.count : 0,
    staged: typeof res.json.staged === "number" ? res.json.staged : undefined,
  };
}

export type AskOutboxItem = {
  id: string;
  kind: string;
  status: string;
  payload: {
    title?: string;
    body?: string;
    tags?: string[];
    links?: { note: string; reason?: string }[];
    parent_title?: string;
    relation?: string;
  } | null;
};

export async function askOutboxPull(
  cfg: PlusClientConfig,
  sessionToken: string,
  limit = 1,
): Promise<
  | {
      ok: true;
      items: AskOutboxItem[];
      pending_count: number;
      claimed_count: number;
    }
  | PlusApiError
> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/outbox/pull",
    method: "POST",
    sessionToken,
    body: { limit },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  const items = Array.isArray(res.json.items)
    ? (res.json.items as AskOutboxItem[])
    : [];
  return {
    ok: true,
    items,
    pending_count:
      typeof res.json.pending_count === "number" ? res.json.pending_count : 0,
    claimed_count:
      typeof res.json.claimed_count === "number" ? res.json.claimed_count : 0,
  };
}

export async function askOutboxAck(
  cfg: PlusClientConfig,
  sessionToken: string,
  opts: { id: string; status: "applied" | "rejected"; error?: string },
): Promise<{ ok: true; id: string; status: string } | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/ask/outbox/ack",
    method: "POST",
    sessionToken,
    body: {
      id: opts.id,
      status: opts.status,
      error: opts.error,
    },
  });
  if (!res.ok) return res;
  if (res.status < 200 || res.status >= 300) {
    return mapError(res.status, res.json);
  }
  return {
    ok: true,
    id: typeof res.json.id === "string" ? res.json.id : opts.id,
    status:
      typeof res.json.status === "string" ? res.json.status : opts.status,
  };
}

/** Default production base — override in settings for dogfood. */
/** Public Plus API. Override only for local dogfood via settings. */
export const DEFAULT_PLUS_BASE_URL = "https://plus.tryatoms.app";

/** Claude custom connector MCP URL for this Plus host. */
export function askMcpUrl(plusBaseUrl: string): string {
  const base = (plusBaseUrl || DEFAULT_PLUS_BASE_URL).replace(/\/$/, "");
  return `${base}/mcp`;
}
