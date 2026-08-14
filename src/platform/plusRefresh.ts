/**
 * Plus entitlement refresh + the device-local record of how it went (#230).
 *
 * Settings renders the record inline so "Refresh status" is never a silent
 * no-op: a rejected session and an unreachable service must read differently,
 * and neither may overwrite a good stored session.
 * Pure + `LocalStorageLike` (no Obsidian imports) so the outcome is testable.
 */

import {
  readPlusSession,
  writePlusSession,
  type LocalStorageLike,
  type PlusSession,
} from "./filingAuth";
import { getEntitlement, type PlusClientConfig } from "./plusClient";

/** Device-local storage key — lowercase-dashed (KTD5 family). */
export const LS_PLUS_LAST_REFRESH = "atoms-plus-last-refresh";

export type PlusRefreshKind = "ok" | "rejected" | "failed";

export type PlusRefreshRecord = {
  kind: PlusRefreshKind;
  /** User-safe sentence for the settings line — never a token. */
  message: string;
  /** Epoch ms of this attempt. */
  at: number;
  /** Epoch ms of the last attempt that actually confirmed the plan. */
  lastOkAt?: number;
  /** Account the attempt used — lets the rejected line offer a sign-in link. */
  email?: string;
};

export const PLUS_REFRESH_OK_MESSAGE = "Your plan is up to date.";

export const PLUS_REFRESH_REJECTED_MESSAGE =
  "Your Atoms Plus session expired, so this device needs re-linking. Send yourself a sign-in link and open it on this device.";

export const PLUS_REFRESH_UNREACHABLE_MESSAGE =
  "Couldn’t reach Atoms Plus. Check your connection and try again. Your session on this device is untouched.";

export function readPlusRefreshRecord(
  app: LocalStorageLike,
): PlusRefreshRecord | null {
  try {
    const raw: unknown = app.loadLocalStorage(LS_PLUS_LAST_REFRESH);
    let parsed: unknown = raw;
    if (typeof raw === "string" && raw.trim()) {
      parsed = JSON.parse(raw) as unknown;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const kind =
      o.kind === "ok" || o.kind === "rejected" || o.kind === "failed"
        ? o.kind
        : null;
    if (!kind || typeof o.message !== "string" || !o.message.trim()) {
      return null;
    }
    return {
      kind,
      message: o.message,
      at: typeof o.at === "number" && Number.isFinite(o.at) ? o.at : 0,
      lastOkAt:
        typeof o.lastOkAt === "number" && Number.isFinite(o.lastOkAt)
          ? o.lastOkAt
          : undefined,
      email: typeof o.email === "string" && o.email ? o.email : undefined,
    };
  } catch {
    return null;
  }
}

function writePlusRefreshRecord(
  app: LocalStorageLike,
  record: PlusRefreshRecord,
): void {
  app.saveLocalStorage(LS_PLUS_LAST_REFRESH, JSON.stringify(record));
}

export function clearPlusRefreshRecord(app: LocalStorageLike): void {
  app.saveLocalStorage(LS_PLUS_LAST_REFRESH, "");
}

/**
 * Pull `/v1/me` into the stored session and record the outcome.
 * Only a confirmed entitlement writes the session — auth, transport and
 * partial-body failures leave it exactly as it was.
 */
export async function refreshPlusEntitlementRecord(
  app: LocalStorageLike,
  cfg: PlusClientConfig,
  session: PlusSession,
  now: number = Date.now(),
): Promise<PlusRefreshRecord> {
  const previous = readPlusRefreshRecord(app);
  const r = await getEntitlement(cfg, session.sessionToken);
  if (!r.ok) {
    // Only code "auth" (our service, service-shaped body) means the session is
    // the problem — a gateway 403 or a 5xx must not offer a sign-in link.
    const rejected = r.code === "auth";
    const unreachable = r.code === "network" || r.status >= 500;
    const record: PlusRefreshRecord = {
      kind: rejected ? "rejected" : "failed",
      message: rejected
        ? PLUS_REFRESH_REJECTED_MESSAGE
        : unreachable
          ? PLUS_REFRESH_UNREACHABLE_MESSAGE
          : r.message,
      at: now,
      lastOkAt: previous?.lastOkAt,
      email: session.email,
    };
    writePlusRefreshRecord(app, record);
    return record;
  }
  const e = r.entitlement;
  writePlusSession(app, {
    ...session,
    email: e.email || session.email,
    status: e.status,
    remaining: e.remaining,
    periodEnd: e.periodEnd,
    // Keep the stored plan when the service did not restate it, so a refresh
    // cannot quietly turn a known period into an unnamed one (#442).
    plan: e.plan ?? session.plan,
    refreshedAt: now,
  });
  const record: PlusRefreshRecord = {
    kind: "ok",
    message: PLUS_REFRESH_OK_MESSAGE,
    at: now,
    lastOkAt: now,
    email: e.email || session.email,
  };
  writePlusRefreshRecord(app, record);
  return record;
}

/**
 * The record Settings should render. A record is device state *about a
 * session*: once the session is gone, so is the row — no stale "sign-in
 * needed" line, and no CTA bound to the previous account's email.
 */
export function plusRefreshRowRecord(
  app: LocalStorageLike,
): PlusRefreshRecord | null {
  if (!readPlusSession(app)) return null;
  return readPlusRefreshRecord(app);
}

export type PlusRefreshPresentation = {
  /** Settings row name. */
  title: string;
  /** Sentence plus the last-confirmed line. */
  detail: string;
  /** Inline recovery offered next to the row, if any. */
  recovery: "magic-link" | null;
};

/**
 * What the settings row should say for a record — kept here (not in the tab)
 * so the "rejected offers a sign-in link" rule is testable without a DOM.
 */
export function plusRefreshPresentation(
  record: PlusRefreshRecord,
  formatTime: (ms: number) => string = (ms) => new Date(ms).toLocaleString(),
): PlusRefreshPresentation {
  const confirmed = record.lastOkAt
    ? `Last confirmed ${formatTime(record.lastOkAt)}.`
    : "No successful check yet on this device.";
  return {
    title:
      record.kind === "ok"
        ? "Last check"
        : record.kind === "rejected"
          ? "Sign-in needed"
          : "Last check didn’t go through",
    detail: `${record.message} ${confirmed}`,
    recovery: record.kind === "rejected" && record.email ? "magic-link" : null,
  };
}
