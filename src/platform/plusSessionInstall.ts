/**
 * #393 — every path that installs a Plus session goes through here so a different
 * identity cannot inherit the previous account's Ask arming or hash baseline.
 */
import {
  readPlusSession,
  writePlusSession,
  type IssuedBase,
  type LocalStorageLike,
  type PlusSession,
} from "./filingAuth";
import {
  disarmAskMirror,
  plusSessionIdentityChanged,
  readAskMirrorEmail,
  type AskMirrorDisarmHost,
} from "./askMirror";
import { clearPlusRefreshRecord } from "./plusRefresh";

export type PlusSessionInstallHost = AskMirrorDisarmHost & LocalStorageLike;

/**
 * Write a Plus session after tearing down Ask state when the identity changes.
 * Same-account re-auth keeps the baseline. Returns whether a disarm ran.
 *
 * `issuedBase` is required (#508 KTD4): a forgotten stamp is a build error
 * rather than a silent fail-open, and the brand means it can only have come
 * from a response, never from `settings.plusBaseUrl`. Both stamps are written
 * here — at acquisition the issuing base is by definition also a verified one,
 * so leaving `verifiedBase` unset would make every fresh session look
 * unverified and cost a needless probe on its first content call.
 */
export async function installPlusSession(
  host: PlusSessionInstallHost,
  session: PlusSession,
  issuedBase: IssuedBase,
): Promise<"kept" | "disarmed"> {
  const previous = readPlusSession(host)?.email;
  const mirrorEmail = readAskMirrorEmail((k) => host.loadLocalStorage(k));
  let outcome: "kept" | "disarmed" = "kept";
  if (plusSessionIdentityChanged(previous, mirrorEmail, session.email)) {
    await disarmAskMirror(host);
    outcome = "disarmed";
  }
  writePlusSession(host, { ...session, issuedBase, verifiedBase: issuedBase });
  // The refresh record describes a session this device no longer holds, so it
  // cannot survive the one that replaces it. Left behind, a stale "rejected"
  // record keeps rendering **Sign-in needed** and its magic-link CTA over a
  // session that just signed in successfully -- and after an account change the
  // record still carries the *departed* address, so that CTA mails a link to
  // the account the user just left. Cleared here rather than at the four call
  // sites so a fifth acquisition path cannot forget it.
  clearPlusRefreshRecord(host);
  return outcome;
}
