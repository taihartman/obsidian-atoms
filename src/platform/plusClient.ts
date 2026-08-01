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
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
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
  /** Structured code when known. */
  code?: "exhausted" | "auth" | "network" | "unknown";
};

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
        : {};
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
  const rawMsg =
    typeof json.message === "string"
      ? json.message
      : typeof json.error === "string"
        ? json.error
        : `Plus request failed (HTTP ${status})`;
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status,
      code: "auth",
      message: redact(rawMsg) || "Plus session rejected. Sign in again.",
    };
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

function parseEntitlement(json: Record<string, unknown>): PlusEntitlement {
  const statusRaw = json.status;
  const status: PlusEntitlementStatus =
    statusRaw === "active" ||
    statusRaw === "trialing" ||
    statusRaw === "exhausted" ||
    statusRaw === "inactive" ||
    statusRaw === "unknown"
      ? statusRaw
      : "unknown";
  const remaining =
    typeof json.remaining === "number" && Number.isFinite(json.remaining)
      ? Math.max(0, Math.floor(json.remaining))
      : 0;
  return {
    status,
    remaining,
    periodEnd: typeof json.periodEnd === "string" ? json.periodEnd : undefined,
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
  const ent = parseEntitlement(res.json);
  return {
    ok: true,
    session: {
      sessionToken,
      email: em,
      status: ent.status === "unknown" ? "inactive" : ent.status,
      remaining: ent.remaining ?? 0,
      periodEnd: ent.periodEnd,
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
  const ent = parseEntitlement(res.json);
  return {
    ok: true,
    session: {
      sessionToken,
      email,
      status: ent.status === "unknown" ? "active" : ent.status,
      remaining: ent.remaining,
      periodEnd: ent.periodEnd,
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
  return { ok: true, entitlement: parseEntitlement(res.json) };
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
  // A 2xx with no usable count is not a count of zero. Coercing it to 0 let a
  // captive portal or a half-deployed instance answering 200 write an
  // authoritative "the cloud is empty" into device storage, which is one of
  // the two ways the deletion gate could be talked into allowing a wipe.
  // Absent is unknown, and unknown must fail closed.
  if (typeof res.json.count !== "number" || !Number.isFinite(res.json.count)) {
    return mapError(res.status, { message: "mirror status had no count" });
  }
  return {
    ok: true,
    count: res.json.count,
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
