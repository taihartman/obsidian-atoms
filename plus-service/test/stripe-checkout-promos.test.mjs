/**
 * Checkout sessions advertise Stripe promotion codes (Dashboard coupons).
 * Plan: docs/plans/2026-08-11-001-feat-stripe-checkout-promotion-codes-plan.md
 */
import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";
import { createCheckoutSession } from "../src/stripe.mjs";

before(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  process.env.STRIPE_PRICE_MONTHLY = "price_monthly_test";
  process.env.STRIPE_PRICE_YEARLY = "price_yearly_test";
  process.env.STRIPE_PRICE_TOPUP = "price_topup_test";
  process.env.ATOMS_PLUS_TRIAL_DAYS = "14";
  process.env.PUBLIC_BASE_URL = "https://plus.test";
});

/**
 * @param {(url: string, init: RequestInit) => Promise<Response> | Response} impl
 */
function withFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = mock.fn(async (url, init) => impl(String(url), init || {}));
  return () => {
    globalThis.fetch = original;
  };
}

describe("createCheckoutSession allow_promotion_codes", () => {
  it("subscribe_monthly sends allow_promotion_codes=true", async () => {
    let body = "";
    const restore = withFetch((url, init) => {
      assert.match(url, /\/v1\/checkout\/sessions$/);
      body = String(init.body || "");
      return new Response(JSON.stringify({ id: "cs_m", url: "https://checkout.stripe.test/m" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const session = await createCheckoutSession({
        email: "pay@atoms.test",
        kind: "subscribe_monthly",
      });
      assert.equal(session.url, "https://checkout.stripe.test/m");
      assert.match(body, /allow_promotion_codes=true/);
      assert.match(body, /mode=subscription/);
      assert.match(body, /price_monthly_test/);
    } finally {
      restore();
    }
  });

  it("topup_50 (payment mode) sends allow_promotion_codes=true", async () => {
    let body = "";
    const restore = withFetch((url, init) => {
      assert.match(url, /\/v1\/checkout\/sessions$/);
      body = String(init.body || "");
      return new Response(JSON.stringify({ id: "cs_t", url: "https://checkout.stripe.test/t" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      await createCheckoutSession({
        email: "pay@atoms.test",
        kind: "topup_50",
      });
      assert.match(body, /allow_promotion_codes=true/);
      assert.match(body, /mode=payment/);
      assert.match(body, /price_topup_test/);
    } finally {
      restore();
    }
  });

  it("start_trial keeps trial_period_days and promo flag together", async () => {
    let body = "";
    const restore = withFetch((_url, init) => {
      body = String(init.body || "");
      return new Response(JSON.stringify({ id: "cs_tr", url: "https://checkout.stripe.test/tr" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      await createCheckoutSession({
        email: "trial@atoms.test",
        kind: "start_trial",
      });
      assert.match(body, /allow_promotion_codes=true/);
      assert.match(body, /subscription_data%5Btrial_period_days%5D=14|subscription_data\[trial_period_days\]=14/);
    } finally {
      restore();
    }
  });

  it("throws when Stripe omits checkout url", async () => {
    const restore = withFetch(() =>
      new Response(JSON.stringify({ id: "cs_bad" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      await assert.rejects(
        () =>
          createCheckoutSession({
            email: "pay@atoms.test",
            kind: "subscribe_monthly",
          }),
        /missing url/i,
      );
    } finally {
      restore();
    }
  });
});
