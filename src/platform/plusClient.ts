/**
 * Atoms Plus HTTP client (U2). Injectable requestUrl; never logs session tokens.
 */

import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { PlusEntitlementStatus, PlusSession } from "./filingAuth";

export type RequestFn = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

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
): Promise<ProxyClassifySuccess | PlusApiError> {
  const res = await plusRequest(cfg, {
    path: "/v1/classify",
    method: "POST",
    sessionToken,
    body,
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

/** Default production base — override in settings for dogfood. */
export const DEFAULT_PLUS_BASE_URL = "https://plus.tryatoms.app";
