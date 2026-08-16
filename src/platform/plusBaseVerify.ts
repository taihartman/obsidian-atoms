/**
 * #508 U3 — is this session actually held by the server we are about to talk to?
 *
 * A session stamped at acquisition (U2) carries the base that issued it. Before
 * any *content-bearing* call, the resolved base is compared against that stamp.
 * They match on the overwhelmingly common path and nothing happens. When they do
 * not, the plugin does not guess: it asks the resolved base to name the account
 * the token belongs to, and only a matching answer re-stamps the session.
 *
 * Three decisions from the plan live here and are load-bearing:
 *
 *  - **A bare 2xx is not proof of issuance** (KTD1's security lens). A host that
 *    accepts every bearer token would pass a status-only check, become the
 *    permanently stamped issuer, and receive capture text from then on. So the
 *    predicate is the returned entitlement *email*.
 *
 *    **Be precise about what that buys, because it is less than it looks.** An
 *    email address is not a secret. The predicate stops an accept-anything host
 *    that does not know the account; it does not stop a *targeted* host that
 *    does, since it can simply echo the address back. Raising that bar further
 *    needs something only the real issuer can produce -- a session-bound
 *    challenge, or an explicit trust gesture before a known issuer is replaced
 *    -- and that is tracked separately, not solved here. Do not read this check
 *    as authentication of the host.
 *  - **An absent stamp means unknown, never production** (KTD1) — with the
 *    carve-out that unknown *plus an empty field* must not probe at all, because
 *    an empty field already resolves to the hosted default and probing it would
 *    send a self-hoster's token to plus.tryatoms.app on first run. That is the
 *    exact user this change exists to protect.
 *  - **The gate fails closed, including offline** (KTD3). "I could not check" is
 *    not "go ahead", and it gets copy of its own that names the connection
 *    rather than a settings field a hosted user never touched.
 *
 * Pure + `LocalStorageLike` (no Obsidian imports) so every verdict is testable
 * without a vault. What this module does *not* do is decide what a caller shows;
 * it returns the verdict and the facts a Notice needs.
 */

import {
  readPlusSession,
  writePlusSession,
  type LocalStorageLike,
  type PlusSession,
} from "./filingAuth";
import {
  getEntitlement,
  normalizePlusBase,
  plusBaseMatches,
  PLUS_BASE_REFUSED_MESSAGE,
  type PlusClientConfig,
} from "./plusClient";

/**
 * Re-exported so the #508 copy still reads as one set from here. It is *defined*
 * in `plusClient` because the request layer's own egress backstop returns it,
 * and that module cannot import this one without a cycle.
 */
export { PLUS_BASE_REFUSED_MESSAGE };

/**
 * All this module needs of a session. Deliberately the intersection of
 * `PlusSession` and the `FilingAuth` plus projection, because the classify gate
 * only ever holds the latter, and widening the parameter to `PlusSession` would
 * force that caller to reconstruct one.
 */
export type PlusBaseStamp = Pick<
  PlusSession,
  "sessionToken" | "email" | "issuedBase" | "verifiedBase"
>;

export type PlusBaseVerdict =
  /** Proven: this base holds this session for this account. Safe to send. */
  | {
      kind: "verified";
      /** Normalized base the proof is about. */
      base: string;
      /** True when this call moved the stamp, i.e. a live probe just succeeded. */
      restamped: boolean;
      /**
       * The stamp that was replaced, when there was one. Absent on a first
       * stamp, which is why the "issuer moved" Notice stays quiet there: there
       * is no move to report if the plugin never knew where the session began.
       */
      previousBase?: string;
    }
  /** Answered, and the answer was no. Nothing content-bearing may be sent. */
  | { kind: "refused"; reason: "unverified" | "needs-address"; message: string }
  /** Unanswerable. Fails closed exactly like a refusal, with softer copy. */
  | { kind: "unreachable"; message: string };

/**
 * The KTD1 carve-out state: no stamp and an empty field, so the plugin has no
 * address it can trust. One-time and self-clearing, and it must not read as an
 * error the user caused.
 */
export const PLUS_BASE_NEEDS_ADDRESS_MESSAGE =
  "Atoms Plus needs its address before your notes are sent. Open Settings to confirm it.";

export const PLUS_BASE_UNREACHABLE_MESSAGE =
  "Atoms Plus couldn’t be reached, so your notes stayed on this device. Try again when you’re back online.";

/**
 * Said once when a probe moves a *known* issuer. The refusal is legible and the
 * case that actually moves data would otherwise be silent, which is backwards:
 * `plusBaseUrl` syncs through `data.json`, so a base can arrive from another
 * device with nobody typing anything.
 */
export function plusIssuerMovedMessage(base: string): string {
  return `Atoms Plus is now using ${plusBaseHost(base)}. Your notes will be sent there.`;
}

/**
 * The KTD1 carve-out, rendered as a Settings *state* rather than a dialog: no
 * stamp and an empty field, so the plugin has no address it can trust and will
 * not send note text anywhere until one is confirmed. Empty string when there is
 * nothing to say.
 *
 * Only that one state. A stamp that names a *different* server is not shown
 * here, because it is not settled: the next Process or mirror push probes and
 * may well re-stamp, and announcing a refusal before anything has tried would
 * alarm a self-hoster who simply rotated their tunnel. The needs-address state
 * is the one that cannot resolve on its own.
 */
export function plusAddressStateMessage(
  session: Pick<PlusSession, "issuedBase" | "verifiedBase"> | null | undefined,
  configuredBase: string,
): string {
  if (!session) return "";
  return !plusSessionStamp(session) && !configuredBase.trim()
    ? PLUS_BASE_NEEDS_ADDRESS_MESSAGE
    : "";
}

/**
 * The base this session is currently believed to belong to, or `""` for none.
 *
 * `verifiedBase` first, because it is the one that moves: a rotated tunnel stops
 * probing after its first success. `issuedBase` is the fallback for a session
 * that has never re-verified.
 *
 * One definition, because three places need this rule and they must not drift.
 * The Settings row previously spelled it `verifiedBase ?? issuedBase`, which
 * agrees only as long as `parseBaseStamp` keeps refusing to store empty strings.
 * That is a real invariant today and a silent divergence the day it changes.
 */
export function plusSessionStamp(
  session: Pick<PlusSession, "issuedBase" | "verifiedBase">,
): string {
  return session.verifiedBase?.trim() || session.issuedBase?.trim() || "";
}

/** Host for user-facing copy. Falls back to the whole base when unparseable. */
export function plusBaseHost(base: string): string {
  try {
    return new URL(base).host || normalizePlusBase(base);
  } catch {
    return normalizePlusBase(base);
  }
}

/**
 * Per-run memo of probe outcomes, so an unreachable 5xx host is handed the token
 * once per run instead of once per atom. Create one at the top of a run and pass
 * it to every call in that run; omit it and every call probes.
 *
 * Only *probe* verdicts land here. A match against the stored stamp is answered
 * from disk before the cache is consulted, and a successful probe re-stamps the
 * session, so the next call in the same run takes that early path anyway.
 */
export type PlusBaseVerifyCache = Map<string, PlusBaseVerdict>;

export function createPlusBaseVerifyCache(): PlusBaseVerifyCache {
  return new Map();
}

export type PlusBaseVerifyDeps = {
  /** Where the re-stamp is persisted. Device-local; never data.json. */
  storage: LocalStorageLike;
  request: PlusClientConfig["request"];
  cache?: PlusBaseVerifyCache;
};

export type PlusBaseVerifyInput = {
  session: PlusBaseStamp;
  /** The base this call is about to use, after the caller's own resolution. */
  resolvedBase: string;
  /**
   * Raw `settings.plusBaseUrl`, *not* the resolved base. The carve-out turns on
   * the field being empty, and by the time it is resolved that fact is gone.
   */
  configuredBase: string;
};

/**
 * Decide whether `resolvedBase` may receive this session's content.
 *
 * Never throws: every failure mode is a closed verdict.
 */
export async function verifyPlusBase(
  deps: PlusBaseVerifyDeps,
  input: PlusBaseVerifyInput,
): Promise<PlusBaseVerdict> {
  const { session, resolvedBase, configuredBase } = input;
  const token = session.sessionToken?.trim() ?? "";
  const email = session.email?.trim() ?? "";
  if (!token || !email) {
    // No session is not "no risk": the caller asked whether to send, and the
    // only safe answer to a question this module cannot evaluate is no.
    return refused("unverified");
  }

  const stamp = plusSessionStamp(session);
  if (plusBaseMatches(stamp, resolvedBase)) {
    return { kind: "verified", base: normalizePlusBase(resolvedBase), restamped: false };
  }

  if (!stamp && !configuredBase.trim()) {
    // KTD1 carve-out. An empty field resolves to the hosted default, so probing
    // here is precisely the leak: a self-hoster who cleared the field would have
    // their token sent to plus.tryatoms.app by the check meant to protect them.
    // Surfaced as a Settings state, not a dialog, and no request is made.
    return refused("needs-address");
  }

  // Keyed on the token as well as the account, because a verdict certifies a
  // *session*, not an address. Two sessions can share an email -- a sign-out and
  // sign-in inside one catch-up pass produces exactly that -- and reusing the
  // first one's verdict would send the second one's token and content to a host
  // that was never asked about it. Fingerprinted rather than keyed on the token
  // itself: the map is in-memory only, but this repo's habit is that a secret
  // does not become a lookup key.
  const key = `${tokenFingerprint(token)}\n${email.toLowerCase()}\n${normalizePlusBase(resolvedBase)}`;
  const cached = deps.cache?.get(key);
  if (cached) {
    // A cached success cannot re-announce a move: the move was already reported
    // by the call that made it, and the stamp it wrote answers later calls.
    return cached.kind === "verified" ? { ...cached, restamped: false } : cached;
  }

  // Through `getEntitlement` rather than a hand-rolled probe, so this inherits
  // `plusRequest`'s #500 base guard and the typed `PlusApiError` mapping. An
  // unparseable base therefore never reaches the network at all; it comes back
  // as `invalid`, which the six gated call sites have already refused upstream.
  const result = await getEntitlement({ baseUrl: resolvedBase, request: deps.request }, token);

  let verdict: PlusBaseVerdict;
  if (!result.ok) {
    // Only code "auth" means our service rejected the session. A gateway 401, a
    // proxy 403 and a 5xx are all "could not check", the same convention
    // `plusRefresh` already follows, and reading one as a session refusal would
    // tell a user to edit a field that is fine.
    verdict =
      result.code === "auth" ? refused("unverified") : { kind: "unreachable", message: PLUS_BASE_UNREACHABLE_MESSAGE };
  } else if (!emailMatches(result.entitlement.email, email)) {
    // 2xx alone proves a server is willing to accept a token, not that it minted
    // one. Only naming the account is proof of issuance.
    verdict = refused("unverified");
  } else if (!persistVerifiedBase(deps.storage, token, normalizePlusBase(resolvedBase))) {
    // The stamp did not land, which means the session was replaced or cleared
    // while the probe was in flight. The proof we just earned is about a token
    // this device may no longer hold, so it is not a licence to send: refuse and
    // let the next call ask again with whatever session is now current.
    verdict = refused("unverified");
  } else {
    verdict = {
      kind: "verified",
      base: normalizePlusBase(resolvedBase),
      restamped: true,
      previousBase: stamp || undefined,
    };
  }

  deps.cache?.set(key, verdict);
  return verdict;
}

function refused(reason: "unverified" | "needs-address"): PlusBaseVerdict {
  return {
    kind: "refused",
    reason,
    message:
      reason === "needs-address" ? PLUS_BASE_NEEDS_ADDRESS_MESSAGE : PLUS_BASE_REFUSED_MESSAGE,
  };
}

function emailMatches(returned: string | undefined, expected: string): boolean {
  const a = returned?.trim().toLowerCase() ?? "";
  return !!a && a === expected.trim().toLowerCase();
}

/**
 * Persist the re-stamp through `writePlusSession`, **not** `installPlusSession`:
 * the install boundary runs the #393 Ask-mirror identity disarm, which must not
 * fire for a same-account base change. The account did not change, only the host.
 *
 * Re-read from disk and spread that, rather than spreading the caller's session,
 * because the caller may only hold the `FilingAuth` projection — spreading it
 * would blank `refreshedAt`, `plan` and `setupKind`. A token mismatch means the
 * session was replaced while the probe was in flight, and the verdict this call
 * earned does not belong to the new one.
 */
function persistVerifiedBase(
  storage: LocalStorageLike,
  token: string,
  verifiedBase: string,
): boolean {
  try {
    const stored = readPlusSession(storage);
    if (!stored || stored.sessionToken.trim() !== token) return false;
    writePlusSession(storage, { ...stored, verifiedBase });
    return true;
  } catch {
    // The verdict is already earned; only the memo of it failed. A storage
    // write can throw on the mobile WebViews this plugin supports (quota,
    // private mode), and letting that escape would replace this module's own
    // refusal copy with an unhandled error on the *success* path. Reported as
    // a failed stamp rather than swallowed, so the caller refuses this once and
    // asks again next run, which is the safe direction.
    return false;
  }
}

/**
 * A stable, non-reversing tag for a session token, for use as a map key.
 * Not a security control: it partitions an in-memory cache so one session's
 * verdict cannot answer for another.
 */
function tokenFingerprint(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) {
    h = (Math.imul(31, h) + token.charCodeAt(i)) | 0;
  }
  return `${token.length}:${(h >>> 0).toString(36)}`;
}
