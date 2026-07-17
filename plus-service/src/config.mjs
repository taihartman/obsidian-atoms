/**
 * Env config — never log secret values.
 */

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "8787")),
  /** Operator Anthropic key for managed classify. Required for /v1/classify. */
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  /** Fixed model for Plus (R4 / KTD-P7). */
  anthropicModel: env("ATOMS_PLUS_MODEL", "claude-sonnet-5"),
  anthropicUrl: env(
    "ANTHROPIC_MESSAGES_URL",
    "https://api.anthropic.com/v1/messages",
  ),
  anthropicVersion: env("ANTHROPIC_VERSION", "2023-06-01"),
  /** Included filings per billing period (no rollover MVP). */
  includedFilings: Number(env("ATOMS_PLUS_INCLUDED", "150")),
  topUpFilings: Number(env("ATOMS_PLUS_TOPUP", "50")),
  /** Days for trial entitlement when granting trial. */
  trialDays: Number(env("ATOMS_PLUS_TRIAL_DAYS", "14")),
  /**
   * Dogfood: first magic-link exchange grants active/trial without Stripe.
   * Set DOGFOOD_AUTO_GRANT=0 in production.
   */
  dogfoodAutoGrant: env("DOGFOOD_AUTO_GRANT", "1") !== "0",
  dogfoodGrantStatus: env("DOGFOOD_GRANT_STATUS", "trialing"), // trialing | active
  /** Optional public base for magic links in logs (e.g. http://127.0.0.1:8787). */
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://127.0.0.1:8787"),
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
