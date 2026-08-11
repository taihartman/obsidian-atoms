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
import { DEFAULT_PLUS_BASE_URL } from "./plusClient";

export type ClassifyAuthOk = {
  ok: true;
  apiKey: string;
  plus?: NonNullable<ClassifyDeps["plus"]>;
  /** Model id for BYOK; Plus path ignores client model server-side. */
  modelHint: "byok" | "plus";
};

export type ClassifyAuthFail = {
  ok: false;
  reason: "none" | "exhausted";
  /** Safe Notice string — no BYOK pitch on exhausted. */
  message: string;
};

/**
 * Build credentials for Process / Preview / Update / auto-run.
 * Prefer Plus when active/trialing/unknown; exhausted blocks with Get More language.
 */
export function resolveClassifyAuth(
  auth: FilingAuth,
  opts?: {
    plusBaseUrl?: string;
    onRemaining?: (remaining: number) => void;
    /** Injectable clock — the lapse read is date-based, so tests must own it. */
    now?: number;
  },
): ClassifyAuthOk | ClassifyAuthFail {
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
    const base =
      opts?.plusBaseUrl?.trim() || DEFAULT_PLUS_BASE_URL;
    return {
      ok: true,
      apiKey: "",
      modelHint: "plus",
      plus: {
        baseUrl: base,
        sessionToken: auth.sessionToken,
        onRemaining: opts?.onRemaining,
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
