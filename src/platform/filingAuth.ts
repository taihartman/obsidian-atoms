/**
 * Filing credential resolution — BYOK vs Atoms Plus session (U1).
 * Pure helpers; no Obsidian imports. Session tokens stay device-local.
 */

export type FilingAuthMode = "none" | "byok" | "plus";

export type PlusEntitlementStatus =
  | "active"
  | "trialing"
  | "exhausted"
  | "inactive"
  | "unknown";

/** Device-local Plus session (never data.json). */
export type PlusSession = {
  /** Opaque session token for Plus service Authorization header. */
  sessionToken: string;
  email: string;
  /** ISO period end when known. */
  periodEnd?: string;
  /** Remaining filings in period when last synced. */
  remaining?: number;
  /** Server entitlement status when last synced. */
  status?: PlusEntitlementStatus;
  /** Epoch ms of last successful entitlement refresh. */
  refreshedAt?: number;
};

export type FilingAuth =
  | { mode: "none" }
  | { mode: "byok"; apiKey: string }
  | {
      mode: "plus";
      sessionToken: string;
      email: string;
      remaining?: number;
      periodEnd?: string;
      status: PlusEntitlementStatus;
    };

/** Device-local storage keys — lowercase-dashed (KTD5 family). */
export const LS_PLUS_SESSION = "atoms-plus-session";

/**
 * Prefer Plus when session is present and entitlement is active/trialing.
 * Exhausted Plus still returns mode "plus" so UX can show wait/top-up (not BYOK pitch).
 * Inactive/unknown without usable session falls through to BYOK or none.
 */
export function resolveFilingAuth(input: {
  byokApiKey: string | null;
  plusSession: PlusSession | null;
}): FilingAuth {
  const key = input.byokApiKey?.trim() || null;
  const session = input.plusSession;
  const token = session?.sessionToken?.trim() || "";
  const email = session?.email?.trim() || "";

  if (token && email) {
    const status = session?.status ?? "unknown";
    if (status === "active" || status === "trialing" || status === "exhausted") {
      return {
        mode: "plus",
        sessionToken: token,
        email,
        remaining: session?.remaining,
        periodEnd: session?.periodEnd,
        status,
      };
    }
    // inactive / unknown with token: still prefer plus if we have a token
    // so client can refresh entitlement; treat as plus unknown
    if (status === "unknown") {
      return {
        mode: "plus",
        sessionToken: token,
        email,
        remaining: session?.remaining,
        periodEnd: session?.periodEnd,
        status: "unknown",
      };
    }
  }

  if (key) {
    return { mode: "byok", apiKey: key };
  }

  return { mode: "none" };
}

/** True when managed classify is allowed (not exhausted/inactive). */
export function plusCanClassify(auth: FilingAuth): boolean {
  if (auth.mode !== "plus") return false;
  return auth.status === "active" || auth.status === "trialing" || auth.status === "unknown";
}

/** True when UX should show wait / top-up (never BYOK pitch). */
export function plusIsExhausted(auth: FilingAuth): boolean {
  return auth.mode === "plus" && auth.status === "exhausted";
}

export function parsePlusSession(raw: unknown): PlusSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessionToken = typeof o.sessionToken === "string" ? o.sessionToken.trim() : "";
  const email = typeof o.email === "string" ? o.email.trim() : "";
  if (!sessionToken || !email) return null;
  const status = normalizeStatus(o.status);
  const remaining =
    typeof o.remaining === "number" && Number.isFinite(o.remaining)
      ? o.remaining
      : undefined;
  const periodEnd = typeof o.periodEnd === "string" ? o.periodEnd : undefined;
  const refreshedAt =
    typeof o.refreshedAt === "number" && Number.isFinite(o.refreshedAt)
      ? o.refreshedAt
      : undefined;
  return { sessionToken, email, status, remaining, periodEnd, refreshedAt };
}

function normalizeStatus(v: unknown): PlusEntitlementStatus {
  if (
    v === "active" ||
    v === "trialing" ||
    v === "exhausted" ||
    v === "inactive" ||
    v === "unknown"
  ) {
    return v;
  }
  return "unknown";
}

/** Serialize for loadLocalStorage / saveLocalStorage. */
export function serializePlusSession(session: PlusSession): string {
  return JSON.stringify({
    sessionToken: session.sessionToken,
    email: session.email,
    status: session.status ?? "unknown",
    remaining: session.remaining,
    periodEnd: session.periodEnd,
    refreshedAt: session.refreshedAt,
  });
}

export type LocalStorageLike = {
  loadLocalStorage: (key: string) => unknown;
  saveLocalStorage: (key: string, value: string) => void;
};

export function readPlusSession(app: LocalStorageLike): PlusSession | null {
  try {
    const raw = app.loadLocalStorage(LS_PLUS_SESSION);
    if (typeof raw === "string" && raw.trim()) {
      try {
        return parsePlusSession(JSON.parse(raw));
      } catch {
        return null;
      }
    }
    return parsePlusSession(raw);
  } catch {
    return null;
  }
}

export function writePlusSession(app: LocalStorageLike, session: PlusSession): void {
  app.saveLocalStorage(LS_PLUS_SESSION, serializePlusSession(session));
}

export function clearPlusSession(app: LocalStorageLike): void {
  app.saveLocalStorage(LS_PLUS_SESSION, "");
}
