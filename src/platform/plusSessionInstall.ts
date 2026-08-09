/**
 * #393 — every path that installs a Plus session goes through here so a different
 * identity cannot inherit the previous account's Ask arming or hash baseline.
 */
import {
  readPlusSession,
  writePlusSession,
  type LocalStorageLike,
  type PlusSession,
} from "./filingAuth";
import {
  disarmAskMirror,
  plusSessionIdentityChanged,
  readAskMirrorEmail,
  type AskMirrorDisarmHost,
} from "./askMirror";

export type PlusSessionInstallHost = AskMirrorDisarmHost & LocalStorageLike;

/**
 * Write a Plus session after tearing down Ask state when the identity changes.
 * Same-account re-auth keeps the baseline. Returns whether a disarm ran.
 */
export async function installPlusSession(
  host: PlusSessionInstallHost,
  session: PlusSession,
): Promise<"kept" | "disarmed"> {
  const previous = readPlusSession(host)?.email;
  const mirrorEmail = readAskMirrorEmail((k) => host.loadLocalStorage(k));
  let outcome: "kept" | "disarmed" = "kept";
  if (plusSessionIdentityChanged(previous, mirrorEmail, session.email)) {
    await disarmAskMirror(host);
    outcome = "disarmed";
  }
  writePlusSession(host, session);
  return outcome;
}
