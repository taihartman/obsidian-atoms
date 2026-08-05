/**
 * #240 U9 — the `obsidian://atoms-signin` handoff: peek first, route every
 * outcome, spend nothing before the user has chosen.
 *
 * The exchange lives in U10 and runs only on approval; this module stops at
 * handing a usable peek to `onPeekUsable`, carrying the verifier that satisfied
 * it (KD4, KTD15).
 */
import { Notice } from "obsidian";
import type { App } from "obsidian";
import { readPendingSignIns, type LocalStorageLike } from "./filingAuth";
import {
  DEFAULT_PLUS_BASE_URL,
  MAGIC_LINK_REFUSED_MESSAGE,
  peekMagicToken,
  plusFetchRequest,
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

/** The surface the in-progress state and its outcome share. */
export type SignInStatusSurface = {
  /** Replace what is on screen — never stack a second surface. */
  update: (message: string) => void;
  hide: () => void;
};

/** What U10's confirmation needs, and nothing that could spend the token here. */
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
};

export type PlusSignInHost = {
  app: App & LocalStorageLike;
  settings: { plusBaseUrl: string };
  /** U10 owns the confirmation and the exchange; U9 only reaches this. */
  onPeekUsable?: (approval: MagicHandoffApproval) => void | Promise<void>;
};

/** Control characters, including DEL — never rendered, never logged. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;

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

type PeekFailure = {
  status: number;
  code?: string;
  message: string;
  verdict?: string;
  vault?: string;
};

function failureMessage(err: PeekFailure): string {
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
): Promise<void> {
  const pending = readPendingSignIns(host.app);
  if (pending.length === 0) {
    // No verifier to present, so no peek can run and no name is attested.
    // Naming nothing beats naming the `vault=` param (R5).
    status.update(refusalMessage());
    return;
  }

  const base = host.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
  const cfg: PlusClientConfig = { baseUrl: base, request: plusFetchRequest };

  let lastRefusal: PeekFailure | null = null;
  for (const entry of pending) {
    const result = await peekMagicToken(cfg, {
      token,
      verifier: entry.verifier,
    });
    if (result.ok) {
      await host.onPeekUsable?.({
        token,
        verifier: entry.verifier,
        email: result.email,
        ...(result.vault ? { vault: result.vault } : {}),
        status,
      });
      return;
    }
    const failure = result as PeekFailure;
    if (failure.verdict === "refused" || failure.code === "refused") {
      lastRefusal = failure;
      continue;
    }
    status.update(failureMessage(failure));
    return;
  }
  status.update(
    failureMessage(
      lastRefusal ?? { status: 403, code: "refused", message: "" },
    ),
  );
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
export function createSignInHandoffQueue(opts?: {
  openStatus?: () => SignInStatusSurface;
}): SignInHandoffQueue {
  const openStatus =
    opts?.openStatus ??
    (() => {
      // Timeout 0 — this notice is replaced by its own outcome, and F13 removed
      // the auto-dismiss so a refusal stays until the user dismisses it.
      const notice = new Notice(SIGNING_IN_MESSAGE, 0);
      return {
        update: (message: string) => notice.setMessage(message),
        hide: () => notice.hide(),
      };
    });

  let host: PlusSignInHost | null = null;
  let slot: { token: string; status: SignInStatusSurface } | null = null;

  const run = async (token: string, status: SignInStatusSurface) => {
    if (!host) return;
    try {
      await runSignInHandoff(host, token, status);
    } catch {
      // Never let a deep link throw out of the protocol handler, and never
      // surface the thrown text — it is the one place a token could leak.
      status.update(MAGIC_LINK_UNKNOWN_MESSAGE);
    }
  };

  return {
    async accept(params) {
      const token =
        typeof params?.token === "string" ? params.token.trim() : "";
      if (!token) return;
      slot?.status.hide();
      const status = openStatus();
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
