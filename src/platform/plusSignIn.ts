/**
 * #240 U9 + U10 — the `obsidian://atoms-signin` handoff: peek first, ask, and
 * spend the token only on an explicit approval.
 *
 * The peek is non-consuming (KTD15), so every path short of "confirmed" leaves
 * the link redeemable. The confirmation itself is a host callback rather than a
 * Modal built here, following `shared/confirm.ts`: `platform/` stays testable in
 * node, and the token and verifier never reach a surface that renders text.
 */
import type { App } from "obsidian";
import type { ConfirmVerdict, SignInConfirmRequest } from "../shared/confirm";
import {
  clearPendingSignIn,
  readPendingSignIns,
  writePlusSession,
  type LocalStorageLike,
} from "./filingAuth";
import {
  DEFAULT_PLUS_BASE_URL,
  MAGIC_LINK_REFUSED_MESSAGE,
  exchangeMagicToken,
  peekMagicToken,
  plusFetchRequest,
  type MagicVerdict,
  type PlusApiError,
  type PlusClientConfig,
} from "./plusClient";

/** Shown from the tap until the peek answers (R19). */
export const SIGNING_IN_MESSAGE = "Checking this sign-in link…";

/**
 * A 429 is its own outcome, not a generic failure: the link is still valid and
 * the user's action is to wait, which no other message tells them.
 */
export const MAGIC_LINK_RATE_LIMITED_MESSAGE =
  "Too many sign-in attempts from this device. Wait a minute, then tap the link again — it still works.";

export const MAGIC_LINK_NETWORK_MESSAGE =
  "Could not reach Atoms Plus to check this sign-in link. Check your connection, then tap the link again — it still works.";

/** Nothing else to say, but silence is the symptom #240 exists to remove. */
export const MAGIC_LINK_UNKNOWN_MESSAGE =
  "Could not check this sign-in link. Tap it again, or request a new one from Settings → Atoms.";

/**
 * The peek has answered and the only thing left is the human. Live smoke found
 * "Checking this sign-in link…" still sitting behind the open confirmation,
 * which reads as work in progress when nothing is running (R19).
 */
export const SIGN_IN_AWAITING_CONFIRMATION_MESSAGE =
  "Confirm the sign-in to finish.";

/** Shown from the approval until the session lands (R19). */
export const SIGNING_IN_APPROVED_MESSAGE = "Signing in…";

/**
 * The exchange succeeded but the session could not be stored on this device.
 * The link is already spent, so the generic "tap it again" copy would be a lie —
 * the only way forward is a fresh link from Settings.
 */
export const SIGN_IN_STORAGE_FAILED_MESSAGE =
  "Signed in, but this device could not save the session. Request a new sign-in link from Settings → Atoms and try again.";

/**
 * Cancelling is a choice, not a failure — and the peek consumed nothing, so the
 * link genuinely still works. Saying so is what keeps a cancel recoverable.
 */
export const SIGN_IN_DECLINED_MESSAGE =
  "Left signed out. This sign-in link still works — tap it again if you change your mind.";

export function signedInMessage(email: string): string {
  return `Signed in to Atoms Plus as ${email}.`;
}

/** The surface the in-progress state and its outcome share. */
export type SignInStatusSurface = {
  /** Replace what is on screen — never stack a second surface. */
  update: (message: string) => void;
  /**
   * A dead end the user must acknowledge (R5). Separate from `update` because a
   * refusal that expires on a timer is indistinguishable from the silent drop
   * #240 exists to remove; the plugin surface renders this as a modal.
   */
  fail: (message: string) => void;
  hide: () => void;
};

/** What the confirmation needs, and nothing that could spend the token elsewhere. */
export type MagicHandoffApproval = {
  token: string;
  /**
   * The verifier that satisfied *this* peek. Carried rather than re-read at
   * approve time: a second **Send sign-in link** tap mints a newer verifier,
   * and presenting that against this link's row refuses a blameless user.
   */
  verifier: string;
  email: string;
  /** Server-attested requesting vault, when the service named one. */
  vault?: string;
  /** Same surface, so the confirmation's progress replaces the peek's. */
  status: SignInStatusSurface;
  /**
   * False once a newer deep link has superseded this handoff. Checked after the
   * confirmation resolves, because that await can park for as long as the user
   * takes to answer — ample time for a second tap to arrive. Defaults to always
   * current so a direct caller with no queue behind it is unaffected.
   */
  isCurrent?: () => boolean;
};

export type PlusSignInHost = {
  app: App & LocalStorageLike;
  settings: { plusBaseUrl: string };
  /**
   * Asks the human. Injected rather than constructed here so the whole flow runs
   * under vitest, and so the exchange has exactly one gate in front of it.
   */
  confirmSignIn: (request: SignInConfirmRequest) => Promise<ConfirmVerdict>;
};

/**
 * Control characters, including DEL — never rendered, never logged.
 *
 * The later ranges are invisible-but-active Unicode: zero-width spaces and
 * joiners, and the bidi overrides and isolates. They render as nothing while
 * reordering the text around them, which is how a vault name gets to *look*
 * like a different vault name in the one sentence a user reads before
 * approving (R5). Stripped at render rather than rejected at mint, so no
 * legitimate non-Latin vault name is ever turned away.
 */
const CONTROL_CHARS =
  /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]+/g;

/**
 * The deep link's `vault=` is attacker-controlled prose — any web page can fire
 * `obsidian://atoms-signin?vault=…` — so it is never presented as the attested
 * requesting vault (R5). This exists so that any *other* use of it is capped
 * and inert; the refusal copy reads the server-attested name or names none.
 */
export function sanitizeVaultLabel(raw: string): string {
  const flat = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

function refusalMessage(vault?: string): string {
  const named = vault ? sanitizeVaultLabel(vault) : "";
  if (!named) return MAGIC_LINK_REFUSED_MESSAGE;
  return `This sign-in link was requested by the vault “${named}”, so it was not used here. The link still works — open “${named}” and tap it again.`;
}

/**
 * The non-ok answer from either magic-link call. The peek and the exchange
 * speak one vocabulary (R12), so one shape explains both — `failureMessage`
 * runs over a peek verdict and over an exchange error without caring which.
 * Typed from the client's own exports rather than restated loosely, so a
 * mistyped verdict is a compile error instead of a silently unmatched branch.
 */
type MagicLinkFailure = PlusApiError & {
  verdict?: Exclude<MagicVerdict, "usable">;
  vault?: string;
};

function failureMessage(err: MagicLinkFailure): string {
  if (err.verdict === "refused" || err.code === "refused") {
    return refusalMessage(err.vault);
  }
  if (err.status === 429) return MAGIC_LINK_RATE_LIMITED_MESSAGE;
  if (err.code === "network") return MAGIC_LINK_NETWORK_MESSAGE;
  // `expired` / `invalid` already carry the client's request-a-new-link copy,
  // and any other explained refusal carries the service's own sentence.
  return err.message?.trim() || MAGIC_LINK_UNKNOWN_MESSAGE;
}

/**
 * Run the handoff for one deep link on an already-loaded host.
 *
 * Every live verifier is tried, newest first, advancing **only** on `refused`.
 * Peeking with the newest alone would refuse a still-valid older link — exactly
 * the case U7 keeps up to five verifiers for (R16) — and the peek's ceiling is
 * 30/min per IP, so at most five reads costs nothing. Any other verdict is the
 * server's answer about the token itself and ends the loop.
 */
export async function runSignInHandoff(
  host: PlusSignInHost,
  token: string,
  status: SignInStatusSurface,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const pending = readPendingSignIns(host.app);
  if (pending.length === 0) {
    // No verifier to present, so no peek can run and no name is attested.
    // Naming nothing beats naming the `vault=` param (R5).
    status.fail(refusalMessage());
    return;
  }

  const cfg = plusConfig(host);
  let lastRefusal: MagicLinkFailure | null = null;
  for (const entry of pending) {
    const result = await peekMagicToken(cfg, {
      token,
      verifier: entry.verifier,
    });
    if (result.ok) {
      await completeSignInHandoff(host, {
        token,
        verifier: entry.verifier,
        email: result.email,
        ...(result.vault ? { vault: result.vault } : {}),
        status,
        isCurrent,
      });
      return;
    }
    const failure = result as MagicLinkFailure;
    if (failure.verdict === "refused" || failure.code === "refused") {
      lastRefusal = failure;
      continue;
    }
    status.fail(failureMessage(failure));
    return;
  }
  status.fail(
    failureMessage(
      lastRefusal ?? { ok: false, status: 403, code: "refused", message: "" },
    ),
  );
}

function plusConfig(host: Pick<PlusSignInHost, "settings">): PlusClientConfig {
  const base = host.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
  return { baseUrl: base, request: plusFetchRequest };
}

/**
 * U10 — confirm, then exchange, and only in that order.
 *
 * The exchange carries **the verifier that satisfied this flow's peek**, never a
 * fresh read of the pending record: a second **Send sign-in link** tap while the
 * confirmation is open prepends a newer verifier, and presenting that against
 * this link's row would refuse a user whose only mistake was tapping twice.
 */
export async function completeSignInHandoff(
  host: Pick<PlusSignInHost, "app" | "settings" | "confirmSignIn">,
  approval: MagicHandoffApproval,
): Promise<void> {
  const { status, isCurrent = () => true } = approval;
  status.update(SIGN_IN_AWAITING_CONFIRMATION_MESSAGE);
  const verdict = await host.confirmSignIn({
    kind: "plus-signin",
    email: approval.email,
  });
  // A newer tap owns the screen now (KTD8). This answer is for a handoff the
  // user has already moved on from, so it must not spend its token: two
  // exchanges for one account revoke each other, and the loser would write a
  // session the server has already killed. Silent by design — the surface this
  // run was using is hidden, and the newer run owns the messaging.
  if (!isCurrent()) return;
  if (verdict !== "confirmed") {
    // Nothing to undo, because nothing was spent: no exchange, no revoke, no
    // request of any kind (AE2). A dismissal is counted here, not consented to.
    status.update(SIGN_IN_DECLINED_MESSAGE);
    return;
  }

  status.update(SIGNING_IN_APPROVED_MESSAGE);
  const result = await exchangeMagicToken(plusConfig(host), approval.token, {
    verifier: approval.verifier,
  });
  if (!result.ok) {
    // The device stays signed out and the pending verifier survives, so the
    // user's next tap can still complete.
    status.fail(failureMessage(result as MagicLinkFailure));
    return;
  }

  try {
    writePlusSession(host.app, result.session);
    // The link is spent and the session is stored, so the verifiers it was
    // redeemed against have no further use.
    clearPendingSignIn(host.app);
  } catch {
    // The exchange already succeeded, so the link is spent and the other
    // devices are signed out — "tap it again" is advice that cannot work here.
    // Say what actually happened instead of falling through to the generic
    // unknown-failure copy.
    status.fail(SIGN_IN_STORAGE_FAILED_MESSAGE);
    return;
  }
  status.update(signedInMessage(result.session.email || approval.email));
}

export type SignInHandoffQueue = {
  /** Protocol-handler entry point. Never throws; ignores a token-less link. */
  accept: (params: Record<string, string>) => Promise<void>;
  /** Called once settings are loaded; drains a handoff that arrived first. */
  ready: (host: PlusSignInHost) => Promise<void>;
};

/**
 * KTD8 — the handler registers above `onload`'s first `await`, which is before
 * `settings` exists. It therefore captures the params into a **one-slot** queue
 * that drains on `ready`. One slot, not a list: a second deep link during a
 * cold open supersedes the first rather than queuing a second sign-in. The
 * in-progress surface opens at the tap, not at the drain, so a cold open still
 * shows something immediately.
 */
export function createSignInHandoffQueue(opts: {
  /**
   * Required rather than defaulted: the surface is Obsidian UI (a `Notice` for
   * progress, a modal for a dead end) and `platform/` does not build UI.
   */
  openStatus: () => SignInStatusSurface;
}): SignInHandoffQueue {
  const { openStatus } = opts;

  let host: PlusSignInHost | null = null;
  let slot: { token: string; status: SignInStatusSurface } | null = null;
  /**
   * The surface the *previous* tap left behind. Terminal progress lines do not
   * expire (that is the point — see `fail`), so live smoke found a finished
   * handoff's "Left signed out" sitting beside a fresh confirmation. A new tap
   * owns the screen and retires the last one, queued or long since finished.
   */
  let live: SignInStatusSurface | null = null;
  /**
   * Bumped by every tap. `live?.hide()` retires the previous *Notice*, but a run
   * parked on its confirmation modal keeps going and would still spend its token
   * on the user's answer — two exchanges for one account revoke each other, so
   * the loser writes a session the server has already killed. A run compares the
   * generation it started with against this and stands down when superseded.
   */
  let generation = 0;

  const run = async (token: string, status: SignInStatusSurface) => {
    if (!host) return;
    const mine = generation;
    try {
      await runSignInHandoff(host, token, status, () => generation === mine);
    } catch {
      // Never let a deep link throw out of the protocol handler, and never
      // surface the thrown text — it is the one place a token could leak.
      if (generation === mine) status.fail(MAGIC_LINK_UNKNOWN_MESSAGE);
    }
  };

  return {
    async accept(params) {
      const token =
        typeof params?.token === "string" ? params.token.trim() : "";
      if (!token) return;
      generation += 1;
      live?.hide();
      const status = openStatus();
      live = status;
      status.update(SIGNING_IN_MESSAGE);
      if (host) {
        slot = null;
        await run(token, status);
        return;
      }
      slot = { token, status };
    },
    async ready(next) {
      host = next;
      const queued = slot;
      slot = null;
      if (queued) await run(queued.token, queued.status);
    },
  };
}
