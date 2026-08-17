/**
 * Map FilingAuth → classifyCapture deps (U3 wire-up).
 */

import type { ClassifyDeps } from "../pipeline/classify";
import {
  plusCanClassify,
  plusIsExhausted,
  plusLapse,
  type FilingAuth,
} from "./filingAuth";
import type { PlusBaseStamp, PlusBaseVerdict } from "./plusBaseVerify";
import {
  DEFAULT_PLUS_BASE_URL,
  isAllowedPlusBaseUrl,
  PLUS_BASE_URL_INVALID_MESSAGE,
} from "./plusClient";

export type ClassifyAuthOk = {
  ok: true;
  apiKey: string;
  plus?: NonNullable<ClassifyDeps["plus"]>;
  /** Model id for BYOK; Plus path ignores client model server-side. */
  modelHint: "byok" | "plus";
  /**
   * Set only when this resolution moved a *known* issuer, so the caller can say
   * so once. Silent on a first stamp: there is no move to report if the plugin
   * never knew where the session began.
   */
  issuerMovedFrom?: string;
};

export type ClassifyAuthFail = {
  ok: false;
  /**
   * `unverified_base` is #508: this session was not issued by the base we are
   * about to send capture text to, and could not be shown to belong to it.
   * Distinct from `none` because the copy points at a different thing and
   * because an auto-run log that says "no filing auth" for it would be wrong.
   */
  reason: "none" | "exhausted" | "unverified_base";
  /** Safe Notice string — no BYOK pitch on exhausted. */
  message: string;
};

/**
 * The #508 U3 gate, injected. Bound by the caller to `verifyPlusBase` with the
 * device's storage and request function.
 *
 * Required, not optional: an omitted verifier would be a silent fail-open, and
 * the same reasoning that made `installPlusSession`'s stamp a required argument
 * (KTD4) applies to the check that reads it.
 */
export type ClassifyBaseVerifier = (input: {
  session: PlusBaseStamp;
  resolvedBase: string;
}) => Promise<PlusBaseVerdict>;

/**
 * Build credentials for Process / Preview / Update / auto-run.
 * Prefer Plus when active/trialing/unknown; exhausted blocks with Get More language.
 *
 * Async since #508: the Plus branch may have to ask the resolved base whether it
 * actually holds this session before any capture text is handed to it.
 */
export async function resolveClassifyAuth(
  auth: FilingAuth,
  opts: {
    verifyBase: ClassifyBaseVerifier;
    plusBaseUrl?: string;
    onRemaining?: (remaining: number) => void;
    /** Injectable clock — the lapse read is date-based, so tests must own it. */
    now?: number;
  },
): Promise<ClassifyAuthOk | ClassifyAuthFail> {
  if (auth.mode === "plus") {
    // An ended period is checked first because it wears the same `exhausted` status as a spent
    // meter while wanting the opposite sentence: there is no next billing date to wait for, and
    // no allotment coming back (#442).
    const lapse = plusLapse(auth, opts?.now);
    if (lapse) {
      return {
        ok: false,
        reason: "exhausted",
        message:
          lapse.kind === "trial"
            ? "Your Atoms Plus trial has ended. Subscribe in Settings to keep filing captures."
            : "Your Atoms Plus subscription has ended. Subscribe in Settings to keep filing captures.",
      };
    }
    if (plusIsExhausted(auth)) {
      return {
        ok: false,
        reason: "exhausted",
        message:
          "Monthly Limit Reached. Your allotment starts over on your next billing date, or Get More in Settings.",
      };
    }
    if (!plusCanClassify(auth)) {
      return {
        ok: false,
        reason: "none",
        message: "Atoms Plus is not active on this device. Sign in from Settings.",
      };
    }
    const configured = opts.plusBaseUrl ?? "";
    const base = configured.trim() || DEFAULT_PLUS_BASE_URL;
    // #500. `/v1/classify` is the one Plus call that carries the capture body as
    // well as the session token, so an unvetted base would leak the note text
    // too. Refuse here, where the base is resolved, rather than at the request:
    // Process, Preview, Update and auto-run all come through this function.
    if (!isAllowedPlusBaseUrl(base)) {
      return {
        ok: false,
        reason: "none",
        message: PLUS_BASE_URL_INVALID_MESSAGE,
      };
    }
    // #508. `/v1/classify` carries the capture body, so "is this base allowed"
    // is not enough — the question is whether *this session* was issued by it.
    // A cleared field resolves to the hosted default and passes every #500
    // check, which is exactly how a self-hoster's note text reached production.
    const verdict = await opts.verifyBase({ session: auth, resolvedBase: base });
    if (verdict.kind !== "verified") {
      return { ok: false, reason: "unverified_base", message: verdict.message };
    }
    return {
      ok: true,
      apiKey: "",
      modelHint: "plus",
      issuerMovedFrom: verdict.restamped ? verdict.previousBase : undefined,
      plus: {
        baseUrl: base,
        sessionToken: auth.sessionToken,
        onRemaining: opts.onRemaining,
        // What the egress backstop in `classifyCapture` compares against. It is
        // the *verified* base rather than the resolved one so that the two can
        // disagree: a caller assembling `plus` from settings gets a mismatch
        // instead of a tautology.
        verifiedBase: verdict.base,
      },
    };
  }

  if (auth.mode === "byok") {
    return {
      ok: true,
      apiKey: auth.apiKey,
      modelHint: "byok",
    };
  }

  return {
    ok: false,
    reason: "none",
    message:
      "Set an Anthropic API key in Settings, or try Atoms Plus.",
  };
}
