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
 * @returns {{ ok: true, errors: string[] } | { ok: false, errors: string[] }}
 */
export function checkProductionReady() {
  if (!isProduction()) return { ok: true, errors: [] };

  /** @type {string[]} */
  const errors = [];
  const need = (cond, msg) => {
    if (cond) errors.push(msg);
  };

  need(config.dogfoodAutoGrant, "DOGFOOD_AUTO_GRANT must be 0 in production");
  need(
    config.stripeDogfoodCheckout,
    "STRIPE_DOGFOOD_CHECKOUT must not be 1 in production",
  );
  need(!config.stripeSecretKey, "STRIPE_SECRET_KEY required in production");
  need(
    !config.stripeWebhookSecret,
    "STRIPE_WEBHOOK_SECRET required in production",
  );
  need(!config.stripePriceMonthly, "STRIPE_PRICE_MONTHLY required in production");
  need(!config.stripePriceYearly, "STRIPE_PRICE_YEARLY required in production");
  need(!config.stripePriceTopup, "STRIPE_PRICE_TOPUP required in production");
  need(!config.anthropicApiKey, "ANTHROPIC_API_KEY required in production");
  need(
    !config.databaseUrl,
    "DATABASE_URL required in production (managed Postgres meter — KTD-B1)",
  );
  need(
    !config.resendApiKey,
    "RESEND_API_KEY required in production (magic-link email)",
  );

  const storeMode = (config.storeMode || "memory").toLowerCase();
  need(
    storeMode === "memory",
    "ATOMS_PLUS_STORE must not be memory in production (use postgres)",
  );
  need(
    storeMode === "sqlite",
    "ATOMS_PLUS_STORE=sqlite is single-process only; production requires postgres",
  );

  const base = (config.publicBaseUrl || "").toLowerCase();
  need(
    !base || base.includes("127.0.0.1") || base.includes("localhost"),
    "PUBLIC_BASE_URL must be a public https host in production (not localhost)",
  );
  need(
    Boolean(base) &&
      !base.includes("127.0.0.1") &&
      !base.includes("localhost") &&
      !base.startsWith("https://"),
    "PUBLIC_BASE_URL must use https in production",
  );

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
