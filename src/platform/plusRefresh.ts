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
import {
  getEntitlement,
  PLUS_BASE_REFUSED_MESSAGE,
  type PlusClientConfig,
} from "./plusClient";

/** Same account, by the rule the service itself normalizes with. */
function sameAccount(a: string | undefined, b: string | undefined): boolean {
  const x = a?.trim().toLowerCase() ?? "";
  const y = b?.trim().toLowerCase() ?? "";
  return !!x && x === y;
}

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

export const PLUS_REFRESH_SAVE_FAILED_MESSAGE =
  "Atoms Plus couldn’t save your plan on this device, so nothing changed. Try again.";

export const PLUS_REFRESH_SESSION_CHANGED_MESSAGE =
  "Your Atoms Plus session on this device changed while we were checking, so nothing was updated. Try again.";

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
  try {
    app.saveLocalStorage(LS_PLUS_LAST_REFRESH, JSON.stringify(record));
  } catch {
    // The record is a memo about a check, not the check's verdict, and three of
    // the four callers are fire-and-forget polls with no catch of their own. A
    // storage write can throw on the mobile WebViews this plugin supports
    // (quota, private mode); losing the settings line there is a smaller
    // failure than an unhandled rejection in a background poll.
  }
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
  // #508. Re-read once, here, before any branch decides what to write. The
  // `session` argument was captured before the await above, so by now it may
  // describe a session this device no longer holds: signed out, or replaced by
  // a fresh sign-in. Every write below is about *that* session, so a differing
  // token disqualifies all of them, not only the success path.
  //
  // The record is not written either, only returned. A record is device state
  // about a session, and `plusRefreshRowRecord` asks only whether *a* session
  // exists -- so writing here would hang this answer, and the departed
  // account's address with it, on whoever signed in next. The caller still gets
  // the outcome for its Notice and its poll.
  const stored = readPlusSession(app);
  if (!stored || stored.sessionToken.trim() !== session.sessionToken.trim()) {
    return {
      kind: "failed",
      message: PLUS_REFRESH_SESSION_CHANGED_MESSAGE,
      at: now,
      lastOkAt: previous?.lastOkAt,
    };
  }
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
  // #508. A refresh must never rename the account, because the account name is
  // what the issuer gate compares against.
  //
  // This call is content-free and therefore ungated: it goes to whatever base
  // is configured. Adopting the address that base returns handed it the pen. A
  // host the session was not issued by could answer `/v1/me` with any string,
  // become `session.email`, then pass `verifyPlusBase`'s email predicate
  // against the value it had just chosen, get stamped as the verified issuer,
  // and receive capture text from then on. The gate's whole claim is that only
  // the issuer can name the account; an ungated write to that same field is
  // the one way to defeat it without breaking any check.
  //
  // A *differing* address is not ignored, it is refused: it means either this
  // base is not ours or this session is not what we think, and neither is a
  // state to write through. Service-side the address is the `accounts` primary
  // key with no route that changes it, so a legitimate rename is not a case
  // this gives up.
  //
  // Recorded as "failed", not "rejected", because the two kinds prescribe
  // different remedies. "rejected" renders a **Send me a sign-in link** CTA,
  // and that link is requested against the very base that just answered for
  // someone else -- completing it runs `installPlusSession`, which stamps that
  // host as the issuer without the gate ever running. A live session that
  // named a different account is a base problem, not an expired session, so
  // sign-in is the wrong door to point at.
  if (e.email?.trim() && !sameAccount(e.email, session.email)) {
    const record: PlusRefreshRecord = {
      kind: "failed",
      message: PLUS_BASE_REFUSED_MESSAGE,
      at: now,
      lastOkAt: previous?.lastOkAt,
      email: session.email,
    };
    writePlusRefreshRecord(app, record);
    return record;
  }
  // #508. Write the *disk* session, never the `session` argument: that argument
  // is the pre-await snapshot, and spreading it erases anything written
  // meanwhile. The field that costs is `verifiedBase`: a first content call
  // stamps it, and a refresh already in flight -- period-end load, checkout
  // poll, backfill meter, Settings "Refresh status" -- would clobber the stamp,
  // so Plus refuses again on the next call. The guard above is the same
  // re-read-and-compare `persistVerifiedBase` uses, for the same reason.
  //
  // Wrapped, like `persistVerifiedBase`, because a storage write can throw on
  // the mobile WebViews this plugin supports (quota, private mode) and three of
  // the four callers are fire-and-forget polls with no catch of their own. A
  // meter that could not be saved is a failed check, not an unhandled rejection.
  try {
    writePlusSession(app, {
      // Everything not restated below comes from disk -- including `email`,
      // which the block above must not let the service rewrite.
      ...stored,
      status: e.status,
      remaining: e.remaining,
      periodEnd: e.periodEnd,
      // Keep the stored plan when the service did not restate it, so a refresh
      // cannot quietly turn a known period into an unnamed one (#442).
      plan: e.plan ?? stored.plan,
      refreshedAt: now,
    });
  } catch {
    return {
      kind: "failed",
      message: PLUS_REFRESH_SAVE_FAILED_MESSAGE,
      at: now,
      lastOkAt: previous?.lastOkAt,
    };
  }
  const record: PlusRefreshRecord = {
    kind: "ok",
    message: PLUS_REFRESH_OK_MESSAGE,
    at: now,
    lastOkAt: now,
    email: stored.email,
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
