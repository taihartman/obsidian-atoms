/**
 * Env config — never log secret values.
 * Commercial numbers default from repo-root plus-pricing.json (SSOT).
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

const port = Number(env("PORT", "8787"));
/** Public base for magic links — defaults to same host:port as this process. */
const publicBaseUrl = env(
  "PUBLIC_BASE_URL",
  `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 8787}`,
);

export const config = {
  port: Number.isFinite(port) && port > 0 ? port : 8787,
  /** Operator Anthropic key for managed classify. Required for /v1/classify. */
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  /** Fixed model for Plus (R4 / KTD-P7). */
  anthropicModel: env("ATOMS_PLUS_MODEL", "claude-sonnet-5"),
  anthropicUrl: env(
    "ANTHROPIC_MESSAGES_URL",
    "https://api.anthropic.com/v1/messages",
  ),
  anthropicVersion: env("ANTHROPIC_VERSION", "2023-06-01"),
  /** From plus-pricing.json unless env override. */
  includedFilings: Number(
    env("ATOMS_PLUS_INCLUDED", String(pricing.includedFilingsPerPeriod ?? 150)),
  ),
  topUpFilings: Number(
    env("ATOMS_PLUS_TOPUP", String(pricing.topUpFilings ?? 50)),
  ),
  trialDays: Number(
    env("ATOMS_PLUS_TRIAL_DAYS", String(pricing.trialDays ?? 14)),
  ),
  monthlyUsd: pricing.monthlyUsd,
  yearlyUsd: pricing.yearlyUsd,
  topUpUsd: pricing.topUpUsd,
  /**
   * Dogfood: first magic-link exchange grants active/trial without Stripe.
   * Set DOGFOOD_AUTO_GRANT=0 in production.
   */
  dogfoodAutoGrant: env("DOGFOOD_AUTO_GRANT", "1") !== "0",
  dogfoodGrantStatus: env("DOGFOOD_GRANT_STATUS", "trialing"), // trialing | active
  publicBaseUrl,
  /** Comma-separated promo codes → free months (1–3). e.g. FOUNDING=2,FRIENDS=1 */
  promoCodes: parsePromos(env("ATOMS_PLUS_PROMOS", "FOUNDING=2")),
  promoMaxRedemptions: Number(env("ATOMS_PLUS_PROMO_MAX", "100")),
  /** Stripe (optional for dogfood). */
  stripeSecretKey: env("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET"),
  stripePriceMonthly: env("STRIPE_PRICE_MONTHLY"),
  stripePriceYearly: env("STRIPE_PRICE_YEARLY"),
  stripePriceTopup: env("STRIPE_PRICE_TOPUP"),
};

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
