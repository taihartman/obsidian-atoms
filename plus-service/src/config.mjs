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
  get anthropicUrl() {
    return env("ANTHROPIC_MESSAGES_URL", "https://api.anthropic.com/v1/messages");
  },
  get anthropicVersion() {
    return env("ANTHROPIC_VERSION", "2023-06-01");
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
    return parsePromos(env("ATOMS_PLUS_PROMOS", "FOUNDING=2"));
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
};
