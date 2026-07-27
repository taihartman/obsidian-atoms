#!/usr/bin/env node
/**
 * Create Atoms Plus products/prices from repo-root plus-pricing.json.
 *
 * Usage (test mode recommended):
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/create-stripe-catalog.mjs
 *
 * Prints env exports for plus-service. Idempotent by product metadata atoms_plus=1
 * + lookup_key when possible.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const key = process.env.STRIPE_SECRET_KEY || "";
if (!key.startsWith("sk_")) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_… preferred).");
  process.exit(1);
}
if (key.startsWith("sk_live_")) {
  console.warn("WARNING: using LIVE secret key. Prefer sk_test_ for dogfood.");
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pricing = JSON.parse(
  readFileSync(join(root, "plus-pricing.json"), "utf8"),
);

async function stripe(method, path, params) {
  const opts = {
    method,
    headers: { authorization: `Bearer ${key}` },
  };
  if (params) {
    opts.headers["content-type"] = "application/x-www-form-urlencoded";
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") body.set(k, String(v));
    }
    opts.body = body;
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `${method} ${path} → ${res.status}`);
  }
  return json;
}

async function findProduct(name) {
  const list = await stripe("GET", "/products?limit=100&active=true");
  return list.data.find(
    (p) => p.metadata?.atoms_plus === "1" && p.name === name,
  );
}

async function ensureProduct(name, description, metaKind) {
  const existing = await findProduct(name);
  if (existing) {
    console.log(`product exists ${existing.id} (${name})`);
    return existing;
  }
  const p = await stripe("POST", "/products", {
    name,
    description,
    "metadata[atoms_plus]": "1",
    "metadata[kind]": metaKind,
  });
  console.log(`created product ${p.id} (${name})`);
  return p;
}

async function ensurePrice(productId, opts) {
  const list = await stripe(
    "GET",
    `/prices?product=${productId}&active=true&limit=20`,
  );
  const match = list.data.find((pr) => {
    if (pr.unit_amount !== opts.unit_amount) return false;
    if (opts.recurring) {
      return (
        pr.type === "recurring" &&
        pr.recurring?.interval === opts.recurring.interval
      );
    }
    return pr.type === "one_time";
  });
  if (match) {
    console.log(`price exists ${match.id}`);
    return match;
  }
  /** @type {Record<string, string|number>} */
  const params = {
    product: productId,
    currency: (pricing.currency || "usd").toLowerCase(),
    unit_amount: opts.unit_amount,
    "metadata[atoms_plus]": "1",
    "metadata[kind]": opts.kind,
  };
  if (opts.lookup_key) params.lookup_key = opts.lookup_key;
  if (opts.recurring) {
    params["recurring[interval]"] = opts.recurring.interval;
  }
  const pr = await stripe("POST", "/prices", params);
  console.log(`created price ${pr.id}`);
  return pr;
}

const monthlyProd = await ensureProduct(
  "Atoms Plus Monthly",
  `${pricing.includedFilingsPerPeriod} managed filings / month`,
  "monthly",
);
const yearlyProd = await ensureProduct(
  "Atoms Plus Yearly",
  `${pricing.includedFilingsPerPeriod} managed filings / month, billed yearly`,
  "yearly",
);
const topupProd = await ensureProduct(
  "Atoms Plus Top-up",
  `+${pricing.topUpFilings} managed filings (one-time)`,
  "topup",
);

const monthly = await ensurePrice(monthlyProd.id, {
  unit_amount: Math.round(Number(pricing.monthlyUsd) * 100),
  recurring: { interval: "month" },
  kind: "monthly",
  lookup_key: "atoms_plus_monthly",
});
const yearly = await ensurePrice(yearlyProd.id, {
  unit_amount: Math.round(Number(pricing.yearlyUsd) * 100),
  recurring: { interval: "year" },
  kind: "yearly",
  lookup_key: "atoms_plus_yearly",
});
const topup = await ensurePrice(topupProd.id, {
  unit_amount: Math.round(Number(pricing.topUpUsd) * 100),
  kind: "topup",
  lookup_key: "atoms_plus_topup",
});

console.log(`
# Add to plus-service env (test keys → test prices only):
export STRIPE_SECRET_KEY=${key.startsWith("sk_test") ? "sk_test_…" : "sk_live_…"}
export STRIPE_PRICE_MONTHLY=${monthly.id}
export STRIPE_PRICE_YEARLY=${yearly.id}
export STRIPE_PRICE_TOPUP=${topup.id}
# After: stripe listen --forward-to localhost:8787/v1/billing/webhook
export STRIPE_WEBHOOK_SECRET=whsec_…
export DOGFOOD_AUTO_GRANT=0
`);
