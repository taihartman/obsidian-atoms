/**
 * Env config — never log secret values.
 * Commercial numbers default from repo-root plus-pricing.json (SSOT).
 * Env-backed fields are getters so tests can set process.env before access.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function loadPricingSsot() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const raw = readFileSync(join(root, "plus-pricing.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      monthlyUsd: 6,
      yearlyUsd: 60,
      topUpUsd: 2,
      includedFilingsPerPeriod: 150,
      topUpFilings: 50,
      trialDays: 14,
    };
  }
}

const pricing = loadPricingSsot();

function parsePromos(raw) {
  const map = new Map();
  for (const part of raw.split(",")) {
    const [code, months] = part.split("=").map((s) => s.trim());
    if (!code) continue;
    const m = Number(months || "1");
    if (m >= 1 && m <= 3) map.set(code.toUpperCase(), m);
  }
  return map;
}

export const config = {
  get port() {
    const port = Number(env("PORT", "8787"));
    return Number.isFinite(port) && port > 0 ? port : 8787;
  },
  get anthropicApiKey() {
    return env("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return env("ATOMS_PLUS_MODEL", "claude-sonnet-5");
  },
  /**
   * Optional Messages API output_config.effort (low|medium|high|xhigh|max).
   * Empty → omit (API defaults high on Sonnet/Opus 5).
   */
  get anthropicEffort() {
    const raw = env("ATOMS_PLUS_EFFORT", "").toLowerCase().trim();
    if (!raw) return "";
    const allowed = new Set(["low", "medium", "high", "xhigh", "max"]);
    return allowed.has(raw) ? raw : "";
  },
  get anthropicUrl() {
    return env("ANTHROPIC_MESSAGES_URL", "https://api.anthropic.com/v1/messages");
  },
  get anthropicVersion() {
    return env("ANTHROPIC_VERSION", "2023-06-01");
  },
  /**
   * Ask search: index-time expand on mirror upsert (0 disables).
   *
   * **On by default as of 0.6.87 (#340).** This is the first Ask path that
   * sends note **body plaintext** to Anthropic — classify is titles-only — so
   * it was held off by default until the consent it rides on could be made
   * honest. `askPrivacyAckAt` used to be a bare timestamp with no version, so
   * a device that accepted the six-clause Ask privacy copy (which never
   * mentioned body egress) still read as granted, with no way to invalidate it.
   *
   * #360 shipped the ack version, and #340 bumped `ASK_PRIVACY_ACK_VERSION` to
   * "2026-08-07" against seven-clause wording whose clause (4) discloses this
   * egress by name. Every existing device re-prompts before its mirror moves
   * again, which is the condition this default was waiting on.
   *
   * Two gates still stand in front of the egress, and neither is this flag:
   * a deployment with no `ANTHROPIC_API_KEY` is inert (`expandSearch.mjs:104`
   * returns `no_key`), and an operator who wants it off sets
   * `ASK_EXPAND_ENABLED=0`. See #339, plan R18.
   */
  get askExpandEnabled() {
    return env("ASK_EXPAND_ENABLED", "1") !== "0";
  },
  /** Prefer Plus classify model when ASK_EXPAND_MODEL unset (avoid hard-coded Haiku ids). */
  get askExpandModel() {
    const explicit = env("ASK_EXPAND_MODEL", "");
    if (explicit) return explicit;
    return env("ATOMS_PLUS_MODEL", "claude-sonnet-4-5-20250929");
  },
  get askExpandTimeoutMs() {
    const n = Number(env("ASK_EXPAND_TIMEOUT_MS", "12000"));
    return Number.isFinite(n) && n >= 1000 ? n : 12000;
  },
  get askExpandConcurrency() {
    const n = Number(env("ASK_EXPAND_CONCURRENCY", "3"));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3;
  },
  get askExpandPerEmailPerHour() {
    const n = Number(env("ASK_EXPAND_PER_EMAIL_PER_HOUR", "200"));
    return Number.isFinite(n) && n >= 0 ? n : 200;
  },
  /**
   * Min expand_coverage to advertise retrieval=lexical_expanded.
   *
   * KTD1/R22: a mostly-unexpanded index must not claim paraphrase mode. The
   * old 0.01 floor advertised `lexical_expanded` off a single expanded row in
   * a hundred, which is the "the column exists" claim the plan forbids. 0.8 is
   * the plan's dogfood floor.
   */
  get askExpandCoverageFloor() {
    const n = Number(env("ASK_EXPAND_COVERAGE_FLOOR", "0.8"));
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.8;
  },
  get askExpandPerUpsertCap() {
    const n = Number(env("ASK_EXPAND_PER_UPSERT_CAP", "40"));
    return Number.isFinite(n) && n >= 0 ? n : 40;
  },
  get includedFilings() {
    return Number(
      env("ATOMS_PLUS_INCLUDED", String(pricing.includedFilingsPerPeriod ?? 150)),
    );
  },
  get topUpFilings() {
    return Number(env("ATOMS_PLUS_TOPUP", String(pricing.topUpFilings ?? 50)));
  },
  get trialDays() {
    return Number(env("ATOMS_PLUS_TRIAL_DAYS", String(pricing.trialDays ?? 14)));
  },
  get monthlyUsd() {
    return pricing.monthlyUsd;
  },
  get yearlyUsd() {
    return pricing.yearlyUsd;
  },
  get topUpUsd() {
    return pricing.topUpUsd;
  },
  /**
   * Dogfood: first magic-link exchange grants active/trial without Stripe.
   * Set DOGFOOD_AUTO_GRANT=0 in production.
   */
  get dogfoodAutoGrant() {
    return env("DOGFOOD_AUTO_GRANT", "1") !== "0";
  },
  get dogfoodGrantStatus() {
    return env("DOGFOOD_GRANT_STATUS", "trialing");
  },
  get publicBaseUrl() {
    return env("PUBLIC_BASE_URL", `http://127.0.0.1:${this.port}`);
  },
  get promoCodes() {
    // KTD-B8: no default public FOUNDING in production — env only
    const a = env("ATOMS_PLUS_ENV", env("NODE_ENV", "development")).toLowerCase();
    const isProd = a === "production" || a === "prod";
    const defaultPromos = isProd ? "" : "FOUNDING=2";
    return parsePromos(env("ATOMS_PLUS_PROMOS", defaultPromos));
  },
  get promoMaxRedemptions() {
    return Number(env("ATOMS_PLUS_PROMO_MAX", "100"));
  },
  get stripeSecretKey() {
    return env("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return env("STRIPE_WEBHOOK_SECRET");
  },
  get stripePriceMonthly() {
    return env("STRIPE_PRICE_MONTHLY");
  },
  get stripePriceYearly() {
    return env("STRIPE_PRICE_YEARLY");
  },
  get stripePriceTopup() {
    return env("STRIPE_PRICE_TOPUP");
  },
  /** Force instant grants even when Stripe is configured. Never honor in production (see prodGate). */
  get stripeDogfoodCheckout() {
    return env("STRIPE_DOGFOOD_CHECKOUT", "0") === "1";
  },
  /**
   * Product env: set ATOMS_PLUS_ENV=production for fail-closed boot.
   * Also treats NODE_ENV=production as production.
   */
  get atomsPlusEnv() {
    return env("ATOMS_PLUS_ENV", env("NODE_ENV", "development"));
  },
  /** memory | sqlite | postgres */
  get storeMode() {
    return env("ATOMS_PLUS_STORE", "memory").toLowerCase();
  },
  get databasePath() {
    return env(
      "ATOMS_PLUS_DATABASE_PATH",
      join(dirname(fileURLToPath(import.meta.url)), "../data/plus.sqlite"),
    );
  },
  /** Managed Postgres connection string (KTD-B1). */
  get databaseUrl() {
    return env("DATABASE_URL");
  },
  get sessionTtlDays() {
    return Number(env("ATOMS_PLUS_SESSION_TTL_DAYS", "60"));
  },
  get maxCaptureChars() {
    return Number(env("ATOMS_PLUS_MAX_CAPTURE_CHARS", "8000"));
  },
  /**
   * Ceiling on a ranked shortlist from the device (KTD6 k=400). The device decides
   * *which* titles; this only bounds how many the service forwards.
   */
  get maxContextTitles() {
    return Number(env("ATOMS_PLUS_MAX_CONTEXT_TITLES", "400"));
  },
  /**
   * Cap for older clients that send the whole vault alphabetically. Held at the
   * historical 40 so a build already in the wild keeps its cost profile — 400
   * alphabetically-chosen titles would cost 10x and retrieve nothing better.
   */
  get maxLegacyContextTitles() {
    return Number(env("ATOMS_PLUS_MAX_LEGACY_CONTEXT_TITLES", "40"));
  },
  /** Classify body ceiling — must fit a 400-title shortlist plus the capture (U7). */
  get maxClassifyBytes() {
    return Number(env("ATOMS_PLUS_MAX_CLASSIFY_BYTES", "300000"));
  },
  get maxTokens() {
    return Number(env("ATOMS_PLUS_MAX_TOKENS", "2048"));
  },
  get rateLimitPerMinute() {
    return Number(env("ATOMS_PLUS_RATE_LIMIT_PER_MIN", "30"));
  },
  get resendApiKey() {
    return env("RESEND_API_KEY");
  },
  get magicLinkFrom() {
    return env("ATOMS_PLUS_EMAIL_FROM", "Atoms Plus <plus@tryatoms.app>");
  },
  /** Operator address for Stripe incident alerts (#238). Required in production. */
  get alertEmail() {
    return env("ATOMS_PLUS_ALERT_EMAIL").trim();
  },
  /**
   * Per-(kind, window) alert throttle. A rotated webhook secret fails every
   * delivery, so one incident kind must not send one email per event.
   */
  get alertThrottleMs() {
    const min = Number(env("ATOMS_PLUS_ALERT_THROTTLE_MIN", "60"));
    return (Number.isFinite(min) && min > 0 ? min : 60) * 60 * 1000;
  },
  /**
   * AES-256-GCM key for atom mirror at rest (64 hex chars or passphrase).
   * Required in production when Ask mirror is used (prodGate).
   */
  get askMirrorKey() {
    return env("ATOMS_ASK_MIRROR_KEY");
  },
  /** Canonical MCP resource URL (no trailing slash). */
  get mcpResourceUrl() {
    return `${this.publicBaseUrl.replace(/\/$/, "")}/mcp`;
  },
};
