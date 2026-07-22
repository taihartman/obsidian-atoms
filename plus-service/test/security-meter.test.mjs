import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import {
  allowDogfoodCheckout,
  allowDevExchange,
  checkProductionReady,
} from "../src/prodGate.mjs";
import { buildClassifyPayload } from "../src/anthropic.mjs";
import { applyStripeEvent } from "../src/stripe.mjs";

describe("U9 security meter regressions", () => {
  beforeEach(() => {
    process.env.ATOMS_PLUS_ENV = "development";
    process.env.DOGFOOD_AUTO_GRANT = "0";
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("P0-1: auto-grant off does not mint on exchange", () => {
    process.env.DOGFOOD_AUTO_GRANT = "0";
    const store = createMemoryStore();
    const t = store.createMagicToken("sec@test.co");
    const out = store.exchangeMagic(t);
    assert.equal(out.account.status, "inactive");
    assert.equal(out.account.remaining, 0);
  });

  it("P0-2: dogfood checkout blocked in production env flag", () => {
    process.env.ATOMS_PLUS_ENV = "production";
    assert.equal(allowDogfoodCheckout(), false);
    assert.equal(allowDevExchange(), false);
  });

  it("P0-3: oversized messagesRequest rejected", () => {
    const huge = "x".repeat(250_000);
    const r = buildClassifyPayload({
      messagesRequest: {
        model: "x",
        max_tokens: 99999,
        messages: [{ role: "user", content: huge }],
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 413);
  });

  it("P1-1: promo cannot re-mint same email", () => {
    process.env.ATOMS_PLUS_PROMOS = "FOUNDING=2";
    const store = createMemoryStore();
    const r1 = store.redeemPromo("p@t.co", "FOUNDING");
    assert.equal(r1.ok, true);
    const r2 = store.redeemPromo("p@t.co", "FOUNDING");
    assert.equal(r2.ok, false);
  });

  it("P1-6: idempotent classify key does not double consume", () => {
    const store = createMemoryStore();
    store.grantPeriod("i@t.co", { remaining: 5, status: "active" });
    const t = store.createMagicToken("i@t.co");
    // force session without auto grant
    process.env.DOGFOOD_AUTO_GRANT = "0";
    const store2 = createMemoryStore();
    store2.grantPeriod("i@t.co", { remaining: 5, status: "active" });
    const tok = store2.createMagicToken("i@t.co");
    const { session } = store2.exchangeMagic(tok);
    // manually set remaining after exchange
    store2.getAccount("i@t.co").remaining = 5;
    store2.getAccount("i@t.co").status = "active";

    const c1 = store2.tryConsumeFiling(session, "key-1");
    assert.equal(c1.ok, true);
    assert.equal(c1.replay, false);
    store2.completeUsage("key-1", {
      status: "ok",
      responseJson: { result: { ok: true } },
      remaining: 4,
    });
    const c2 = store2.tryConsumeFiling(session, "key-1");
    assert.equal(c2.ok, true);
    assert.equal(c2.replay, true);
    assert.equal(store2.getAccount("i@t.co").remaining, 4);
  });

  it("P1-2: unknown price action when line price not allowlisted", () => {
    process.env.STRIPE_PRICE_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_YEARLY = "price_y";
    process.env.STRIPE_PRICE_TOPUP = "price_t";
    const store = createMemoryStore();
    const r = applyStripeEvent(store, {
      id: "evt_bad_price",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          payment_status: "paid",
          metadata: { email: "x@y.co", kind: "subscribe_monthly" },
          line_items: { data: [{ price: { id: "price_evil" } }] },
        },
      },
    });
    assert.equal(r.action, "unknown_price");
    assert.equal(store.getAccount("x@y.co")?.remaining ?? 0, 0);
  });

  it("webhook replay is duplicate", () => {
    const store = createMemoryStore();
    const ev = {
      id: "evt_once",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          payment_status: "paid",
          metadata: {
            email: "dup@t.co",
            kind: "subscribe_monthly",
            plan: "monthly",
          },
        },
      },
    };
    assert.equal(applyStripeEvent(store, ev).action, "subscribe");
    assert.equal(applyStripeEvent(store, ev).action, "duplicate");
    assert.equal(store.getAccount("dup@t.co").remaining, 150);
  });

  it("prod gate fails without stripe", () => {
    process.env.ATOMS_PLUS_ENV = "production";
    process.env.DOGFOOD_AUTO_GRANT = "0";
    delete process.env.STRIPE_SECRET_KEY;
    process.env.PUBLIC_BASE_URL = "https://plus.tryatoms.app";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    const r = checkProductionReady();
    assert.equal(r.ok, false);
  });
});
