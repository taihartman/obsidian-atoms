import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const saved = { ...process.env };

function resetEnv(overrides = {}) {
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith("ATOMS_") ||
      k.startsWith("STRIPE_") ||
      k.startsWith("DOGFOOD_") ||
      k === "NODE_ENV" ||
      k === "ANTHROPIC_API_KEY" ||
      k === "PUBLIC_BASE_URL"
    ) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, overrides);
}

async function loadGate() {
  const bust = `?t=${Date.now()}-${Math.random()}`;
  return import(`../src/prodGate.mjs${bust}`);
}

before(() => {
  resetEnv({
    DOGFOOD_AUTO_GRANT: "1",
    NODE_ENV: "test",
  });
});

after(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in saved)) delete process.env[k];
  }
  Object.assign(process.env, saved);
});

describe("prodGate", () => {
  beforeEach(() => {
    resetEnv({});
  });

  it("isProduction false by default", async () => {
    const { isProduction } = await loadGate();
    assert.equal(isProduction(), false);
  });

  it("isProduction true when ATOMS_PLUS_ENV=production", async () => {
    process.env.ATOMS_PLUS_ENV = "production";
    const { isProduction } = await loadGate();
    assert.equal(isProduction(), true);
  });

  it("allowDogfoodCheckout true in dev without Stripe", async () => {
    process.env.ATOMS_PLUS_ENV = "development";
    delete process.env.STRIPE_SECRET_KEY;
    const { allowDogfoodCheckout } = await loadGate();
    assert.equal(allowDogfoodCheckout(), true);
  });

  it("allowDogfoodCheckout false in production even without Stripe", async () => {
    process.env.ATOMS_PLUS_ENV = "production";
    delete process.env.STRIPE_SECRET_KEY;
    const { allowDogfoodCheckout, allowDevExchange } = await loadGate();
    assert.equal(allowDogfoodCheckout(), false);
    assert.equal(allowDevExchange(), false);
  });

  it("checkProductionReady fails on dogfood auto grant", async () => {
    process.env.ATOMS_PLUS_ENV = "production";
    process.env.DOGFOOD_AUTO_GRANT = "1";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
    process.env.STRIPE_PRICE_TOPUP = "price_t";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.PUBLIC_BASE_URL = "https://plus.tryatoms.app";
    const { checkProductionReady } = await loadGate();
    const r = checkProductionReady();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("DOGFOOD_AUTO_GRANT")));
  });

  it("checkProductionReady ok when fully configured", async () => {
    process.env.ATOMS_PLUS_ENV = "production";
    process.env.DOGFOOD_AUTO_GRANT = "0";
    process.env.STRIPE_DOGFOOD_CHECKOUT = "0";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
    process.env.STRIPE_PRICE_TOPUP = "price_t";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.PUBLIC_BASE_URL = "https://plus.tryatoms.app";
    const { checkProductionReady } = await loadGate();
    const r = checkProductionReady();
    assert.equal(r.ok, true, r.errors?.join("; "));
  });

  it("checkProductionReady rejects localhost PUBLIC_BASE_URL", async () => {
    process.env.ATOMS_PLUS_ENV = "production";
    process.env.DOGFOOD_AUTO_GRANT = "0";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
    process.env.STRIPE_PRICE_TOPUP = "price_t";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:8787";
    const { checkProductionReady } = await loadGate();
    const r = checkProductionReady();
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("PUBLIC_BASE_URL")));
  });
});
