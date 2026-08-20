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

export type PlusPlan = "monthly" | "yearly" | "trial" | "promo";

/**
 * A Plus base URL that actually completed an acquisition round trip (KTD4).
 *
 * Branded so `settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL` — the idiom
 * already sitting at 23 call sites — is *not* assignable. A stamp taken from
 * whatever is configured would equal the resolved base by construction, so the
 * issuer gate would return true on every device and fail open. Mint one only
 * with `issuedBaseFromResponse` (plusClient.ts), from the base a response came
 * back from.
 */
export type IssuedBase = string & { readonly __brand: "IssuedBase" };

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
  /**
   * What the period was, when the service said. Only `status` reaches the
   * filing gates; this exists so copy about an *ended* period can name it —
   * telling a lapsed subscriber their "trial" ended is a new lie for an old one.
   */
  plan?: PlusPlan;
  /** Epoch ms of last successful entitlement refresh. */
  refreshedAt?: number;
  /**
   * What the unfinished Account start was aiming at. An inactive session with
   * no kind is a trial start (the only start that existed). `subscribe` is a
   * promo-code start and must not reopen trial checkout.
   */
  setupKind?: "trial" | "subscribe";
  /**
   * The base that issued this session, stamped once at acquisition and never
   * rewritten. Absent means *unknown* (a session predating this field), never
   * "production" — the plugin does not guess where a session came from.
   * Audit and warning copy read this; the gate reads `verifiedBase`.
   */
  issuedBase?: IssuedBase;
  /**
   * The base most recently proven to hold this session for this account.
   * Re-stamped on each successful re-verification, which is what lets a
   * self-hosted tunnel rotate its subdomain without a sign-out.
   */
  verifiedBase?: string;
};

/**
 * Whether the stored period has run out, by the same rule the service applies
 * (`applyStatusRules`, plus-service/src/store/shared.mjs) — `period_end` in the
 * past ends the period regardless of filings left.
 *
 * Deliberately answered from the date already on the device: expiry is the one
 * entitlement change no server round-trip announces, so a device that had to ask
 * would keep showing a healthy account until something else happened to fail.
 * That is exactly how #442 stayed invisible for 23 hours.
 */
export function plusPeriodEnded(
  session: Pick<PlusSession, "periodEnd"> | null | undefined,
  now: number = Date.now(),
): boolean {
  const end = Date.parse(session?.periodEnd ?? "");
  return Number.isFinite(end) && end <= now;
}

export type FilingAuth =
  | { mode: "none" }
  | { mode: "byok"; apiKey: string }
  | {
      mode: "plus";
      sessionToken: string;
      email: string;
      remaining?: number;
      periodEnd?: string;
      plan?: PlusPlan;
      status: PlusEntitlementStatus;
      /**
       * Carried through because this projection is the *third* allowlist on the
       * path from disk to the gate: `resolveClassifyAuth` never sees a
       * `PlusSession`, only this. A field added to the type but not here
       * vanishes before the gate reads it, and the gate then fails open.
       */
      issuedBase?: IssuedBase;
      verifiedBase?: string;
    };

/** Device-local storage keys — lowercase-dashed (KTD5 family). */
export const LS_PLUS_SESSION = "atoms-plus-session";
/** Local calendar day (YYYY-MM-DD) when user dismissed Plus limit hero. */
export const LS_PLUS_LIMIT_DISMISS_DAY = "atoms-plus-limit-dismiss-day";
/** Set while Stripe Checkout is open — drives resume poll (not classify). */
export const LS_PLUS_AWAITING_CHECKOUT = "atoms-plus-awaiting-checkout";
/** Verifiers minted for outstanding magic-link sign-in requests (U7). */
export const LS_PLUS_SIGNIN_PENDING = "atoms-plus-signin-pending";

/**
 * Prefer Plus while it can classify. A stored key files only after Plus cannot
 * (spent meter or ended period — the server reports both as `exhausted`).
 * Exhausted without a key stays plus so wait / top-up copy never becomes a BYOK pitch.
 * Inactive without a usable session falls through to BYOK or none.
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
    // One literal, not two. This projection is the third allowlist between disk
    // and the issuer gate, and it used to be spelled out once per status branch
    // — so every new `PlusSession` field had to be added in both places, and a
    // field added to only one would reach the gate as `undefined` on some
    // sessions and not others. That is a fail-open that reads as a typo.
    //
    // `unknown` is kept alongside the live statuses because a token with an
    // unread entitlement should still resolve to plus, so the client can go
    // refresh it rather than falling through to BYOK.
    const plusPreferred =
      status === "active" || status === "trialing" || status === "unknown";
    // Exhausted without a key stays plus so wait/top-up never becomes a pitch.
    if (plusPreferred || (status === "exhausted" && !key)) {
      return {
        mode: "plus",
        sessionToken: token,
        email,
        remaining: session?.remaining,
        periodEnd: session?.periodEnd,
        plan: session?.plan,
        status,
        issuedBase: session?.issuedBase,
        verifiedBase: session?.verifiedBase,
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

/**
 * Which kind of period ended. One declaration, so a fourth kind cannot drift across surfaces.
 *
 * `unknown` is not a placeholder — it is the honest answer for a `promo` period and for any
 * session stored before `plan` was persisted. Guessing "subscription" there sends a user who
 * never had one to a billing portal with no customer behind it.
 */
export type PlusLapseKind = "trial" | "subscription" | "unknown";

/** An ended period, named — `null` while the period is still live. */
export type PlusLapse = {
  kind: PlusLapseKind;
  /** ISO date the period ended, when the device knows it. */
  endedOn?: string;
};

/**
 * Whether the period has *ended*, as opposed to this period's filings being *spent*.
 *
 * One home for the distinction because three surfaces answer it — the settings account rows,
 * the Ask mirror status line, and the Notice every Process shows — and the server hands all
 * three the same `exhausted` status for both situations. Before #442 each surface only knew
 * the spent-meter reading, so an expired trial was told its allotment would return on a next
 * billing date it did not have.
 *
 * **Both conditions are server-confirmed on purpose.** An earlier draft also lapsed on
 * `plan === "trial"` with a past date and no `exhausted`, to catch an expiry without a
 * round-trip. Review found that inverts a paying customer: a trial that *converted* leaves a
 * stale device holding `trialing` + a past `periodEnd`, and that draft told a subscriber their
 * trial had ended and blocked filing — where the old code would have attempted the call and let
 * the server answer. The device may not out-rule the service about entitlement. Staleness is
 * `plusNeedsPeriodRefresh`'s job instead: ask, then report the answer.
 */
export function plusLapse(
  auth: FilingAuth,
  now: number = Date.now(),
): PlusLapse | null {
  if (auth.mode !== "plus") return null;
  if (!plusIsExhausted(auth)) return null;
  if (!plusPeriodEnded(auth, now)) return null;
  return { kind: plusLapseKind(auth.plan), endedOn: auth.periodEnd };
}

/** Only a plan that proves a Stripe customer earns the word "subscription". */
function plusLapseKind(plan: PlusPlan | undefined): PlusLapseKind {
  if (plan === "trial") return "trial";
  if (plan === "monthly" || plan === "yearly") return "subscription";
  return "unknown";
}

/**
 * True when the stored period ended *after* the last confirmed refresh — the snapshot predates
 * the boundary, so it cannot say what happened at it.
 *
 * This is the honest reading of the #442 silence. Nothing announces an expiry: the only
 * automatic refresh is the post-Checkout poll, which returns early unless a checkout is in
 * flight (`plusResume.refreshPlusSessionQuiet`), so a device could sit on a pre-expiry snapshot
 * indefinitely and keep rendering a healthy account. A device in this state must ask rather than
 * guess — guessing in either direction is how a converted trial gets called lapsed.
 */
export function plusNeedsPeriodRefresh(
  session: PlusSession | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!session?.sessionToken?.trim() || !session.email?.trim()) return false;
  const end = Date.parse(session.periodEnd ?? "");
  if (!Number.isFinite(end) || end > now) return false;
  // An absent `refreshedAt` reads as 0 — an unstamped session is exactly the stale case.
  return (session.refreshedAt ?? 0) < end;
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
  return {
    sessionToken,
    email,
    status,
    remaining,
    periodEnd,
    plan: parsePlusPlan(o.plan),
    refreshedAt,
    setupKind: o.setupKind === "subscribe" || o.setupKind === "trial" ? o.setupKind : undefined,
    // Unstated stays unstated: a missing or wrong-typed stamp reads as unknown,
    // never as the hosted default. The cast is the deserialization boundary —
    // the value was minted before it was written.
    issuedBase: parseBaseStamp(o.issuedBase) as IssuedBase | undefined,
    verifiedBase: parseBaseStamp(o.verifiedBase),
  };
}

function parseBaseStamp(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Unstated stays unstated — an unreadable plan must not become "trial". */
export function parsePlusPlan(v: unknown): PlusPlan | undefined {
  return v === "monthly" || v === "yearly" || v === "trial" || v === "promo"
    ? v
    : undefined;
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
    plan: session.plan,
    refreshedAt: session.refreshedAt,
    setupKind: session.setupKind,
    issuedBase: session.issuedBase,
    verifiedBase: session.verifiedBase,
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
  clearAwaitingCheckout(app);
  clearPendingSignIn(app);
}

/**
 * Device-held verifier for one outstanding magic-link sign-in request (U7).
 * Never leaves this vault's local storage; only its SHA-256 goes to the server.
 */
export type PendingSignIn = {
  /** Raw PKCE verifier — presented at peek and at exchange, never logged. */
  verifier: string;
  /** Vault that requested the link, for the refusal copy in another vault. */
  vault: string;
  /** Epoch ms the link was requested. */
  requestedAt: number;
};

/**
 * Generous staleness bound — a day, not the token's 15-minute TTL. The record
 * is retained until sign-in completes or the session is cleared; expiring it at
 * the TTL would break the retry a refused user is told to make (AE12). This
 * bound only stops an abandoned verifier lingering forever.
 */
export const PENDING_SIGNIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How many outstanding verifiers stay reachable. Tapping **Send sign-in link**
 * twice must not strand the earlier link: the older verifier survives so a flow
 * started against it can still peek.
 */
export const PENDING_SIGNIN_MAX = 5;

/** Newest first; stale and malformed entries read as absent. */
export function readPendingSignIns(
  app: LocalStorageLike,
  now: number = Date.now(),
): PendingSignIn[] {
  let parsed: unknown;
  try {
    const raw = app.loadLocalStorage(LS_PLUS_SIGNIN_PENDING);
    if (typeof raw === "string") {
      if (!raw.trim()) return [];
      parsed = JSON.parse(raw);
    } else {
      parsed = raw;
    }
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const live: PendingSignIn[] = [];
  for (const item of parsed) {
    const entry = parsePendingSignIn(item);
    if (entry && now - entry.requestedAt <= PENDING_SIGNIN_MAX_AGE_MS) live.push(entry);
  }
  return live.sort((a, b) => b.requestedAt - a.requestedAt);
}

/** Most recent live request — what fresh Settings copy and a new mint read. */
export function latestPendingSignIn(
  app: LocalStorageLike,
  now: number = Date.now(),
): PendingSignIn | null {
  return readPendingSignIns(app, now)[0] ?? null;
}

/** Prepend a freshly minted verifier without discarding still-live earlier ones. */
export function recordPendingSignIn(
  app: LocalStorageLike,
  entry: { verifier: string; vault: string; requestedAt?: number },
): void {
  const requestedAt = entry.requestedAt ?? Date.now();
  const next = parsePendingSignIn({ ...entry, requestedAt });
  if (!next) return;
  const kept = readPendingSignIns(app, requestedAt).filter(
    (p) => p.verifier !== next.verifier,
  );
  const all = [next, ...kept].slice(0, PENDING_SIGNIN_MAX);
  app.saveLocalStorage(LS_PLUS_SIGNIN_PENDING, JSON.stringify(all));
}

export function clearPendingSignIn(app: LocalStorageLike): void {
  app.saveLocalStorage(LS_PLUS_SIGNIN_PENDING, "");
}

function parsePendingSignIn(raw: unknown): PendingSignIn | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const verifier = typeof o.verifier === "string" ? o.verifier.trim() : "";
  const vault = typeof o.vault === "string" ? o.vault.trim() : "";
  const requestedAt = typeof o.requestedAt === "number" ? o.requestedAt : NaN;
  if (!verifier || !vault || !Number.isFinite(requestedAt)) return null;
  return { verifier, vault, requestedAt };
}

/** Soft session present (may be inactive — setup / Finish trial). */
export function hasPlusSetupSession(session: PlusSession | null): boolean {
  return Boolean(session?.sessionToken?.trim() && session?.email?.trim());
}

export function isAwaitingCheckout(app: LocalStorageLike): boolean {
  try {
    const raw = app.loadLocalStorage(LS_PLUS_AWAITING_CHECKOUT);
    return raw === "1" || raw === true || raw === "true";
  } catch {
    return false;
  }
}

export function setAwaitingCheckout(app: LocalStorageLike, on: boolean): void {
  app.saveLocalStorage(LS_PLUS_AWAITING_CHECKOUT, on ? "1" : "");
}

export function clearAwaitingCheckout(app: LocalStorageLike): void {
  setAwaitingCheckout(app, false);
}

/** Local YYYY-MM-DD for dismiss-day comparison. */
export function localCalendarDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readPlusLimitDismissDay(app: LocalStorageLike): string | null {
  try {
    const raw = app.loadLocalStorage(LS_PLUS_LIMIT_DISMISS_DAY);
    return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
      ? raw.trim()
      : null;
  } catch {
    return null;
  }
}

export function writePlusLimitDismissDay(
  app: LocalStorageLike,
  day: string = localCalendarDay(),
): void {
  app.saveLocalStorage(LS_PLUS_LIMIT_DISMISS_DAY, day);
}

export function clearPlusLimitDismissDay(app: LocalStorageLike): void {
  app.saveLocalStorage(LS_PLUS_LIMIT_DISMISS_DAY, "");
}

/** True when the loud "Monthly Limit Reached" card was dismissed for `today`. */
export function isPlusLimitDismissedToday(
  dismissedDay: string | null,
  today: string = localCalendarDay(),
): boolean {
  return Boolean(dismissedDay && dismissedDay === today);
}
