/**
 * Production fail-closed gates (plan U1).
 * ATOMS_PLUS_ENV=production (or PROD/production NODE_ENV) refuses unsafe dogfood.
 */

import { config } from "./config.mjs";
import { stripeConfigured } from "./stripe.mjs";

/** @returns {boolean} */
export function isProduction() {
  const a = (process.env.ATOMS_PLUS_ENV || "").trim().toLowerCase();
  if (a === "production" || a === "prod") return true;
  const n = (process.env.NODE_ENV || "").trim().toLowerCase();
  return n === "production";
}

/**
 * Whether instant checkout grants (no Stripe) are allowed.
 * Never in production.
 */
export function allowDogfoodCheckout() {
  if (isProduction()) return false;
  if (config.stripeDogfoodCheckout) return true;
  return !stripeConfigured();
}

/** HTML session dump helper — dogfood only. */
export function allowDevExchange() {
  return !isProduction();
}

/**
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function checkProductionReady() {
  if (!isProduction()) return { ok: true, errors: [] };

  /** @type {string[]} */
  const errors = [];

  if (config.dogfoodAutoGrant) {
    errors.push("DOGFOOD_AUTO_GRANT must be 0 in production");
  }
  if (config.stripeDogfoodCheckout) {
    errors.push("STRIPE_DOGFOOD_CHECKOUT must not be 1 in production");
  }
  if (!config.stripeSecretKey) {
    errors.push("STRIPE_SECRET_KEY required in production");
  }
  if (!config.stripeWebhookSecret) {
    errors.push("STRIPE_WEBHOOK_SECRET required in production");
  }
  if (!config.stripePriceMonthly) {
    errors.push("STRIPE_PRICE_MONTHLY required in production");
  }
  if (!config.stripePriceYearly) {
    errors.push("STRIPE_PRICE_YEARLY required in production");
  }
  if (!config.stripePriceTopup) {
    errors.push("STRIPE_PRICE_TOPUP required in production");
  }
  if (!config.anthropicApiKey) {
    errors.push("ANTHROPIC_API_KEY required in production");
  }
  if (!config.databaseUrl) {
    errors.push(
      "DATABASE_URL required in production (managed Postgres meter — KTD-B1)",
    );
  }
  const storeMode = (config.storeMode || "memory").toLowerCase();
  if (storeMode === "memory") {
    errors.push(
      "ATOMS_PLUS_STORE must not be memory in production (use postgres)",
    );
  }
  if (storeMode === "sqlite") {
    errors.push(
      "ATOMS_PLUS_STORE=sqlite is single-process only; production requires postgres",
    );
  }
  if (!config.resendApiKey) {
    errors.push("RESEND_API_KEY required in production (magic-link email)");
  }

  const base = (config.publicBaseUrl || "").toLowerCase();
  if (
    !base ||
    base.includes("127.0.0.1") ||
    base.includes("localhost")
  ) {
    errors.push(
      "PUBLIC_BASE_URL must be a public https host in production (not localhost)",
    );
  }
  if (base && !base.startsWith("https://")) {
    errors.push("PUBLIC_BASE_URL must use https in production");
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Throws Error with joined messages if production and not ready. */
export function assertProductionReady() {
  const r = checkProductionReady();
  if (!r.ok) {
    const err = new Error(
      `[plus] production gate failed:\n- ${r.errors.join("\n- ")}`,
    );
    err.code = "PROD_GATE";
    throw err;
  }
}
