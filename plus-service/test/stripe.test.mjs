import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStore } from "../src/store.mjs";
import {
  applyStripeEvent,
  constructEvent,
  resolveCheckoutKind,
  stripeConfigured,
} from "../src/stripe.mjs";

before(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  process.env.STRIPE_PRICE_MONTHLY = "price_monthly_test";
  process.env.STRIPE_PRICE_YEARLY = "price_yearly_test";
  process.env.STRIPE_PRICE_TOPUP = "price_topup_test";
  process.env.ATOMS_PLUS_INCLUDED = "150";
  process.env.ATOMS_PLUS_TOPUP = "50";
  process.env.ATOMS_PLUS_TRIAL_DAYS = "14";
});

function sign(raw, secret = "whsec_test_secret") {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret)
    .update(`${t}.${raw}`, "utf8")
    .digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("stripe kind map", () => {
  it("maps kinds to prices and modes", () => {
    assert.equal(stripeConfigured(), true);
    assert.deepEqual(resolveCheckoutKind("subscribe_monthly"), {
      mode: "subscription",
      priceId: "price_monthly_test",
      plan: "monthly",
    });
    assert.deepEqual(resolveCheckoutKind("subscribe_yearly"), {
      mode: "subscription",
      priceId: "price_yearly_test",
      plan: "yearly",
    });
    assert.equal(resolveCheckoutKind("start_trial")?.trialDays, 14);
    assert.equal(resolveCheckoutKind("topup_50")?.mode, "payment");
    assert.equal(resolveCheckoutKind("nope"), null);
  });
});

describe("webhook signature + grants", () => {
  it("rejects bad signature", () => {
    const raw = JSON.stringify({
      id: "evt_1",
      type: "ping",
      data: { object: {} },
    });
    assert.throws(
      () => constructEvent(raw, "t=1,v1=deadbeef"),
      /mismatch|Invalid|timestamp/,
    );
  });

  it("accepts valid signature", () => {
    const raw = JSON.stringify({
      id: "evt_ok",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const ev = constructEvent(raw, sign(raw));
    assert.equal(ev.id, "evt_ok");
  });

  it("grants period on checkout.session.completed and is idempotent", () => {
    const store = createStore();
    const event = {
      id: "evt_sub_1",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: {
            email: "pay@atoms.test",
            kind: "subscribe_monthly",
            plan: "monthly",
          },
          customer: "cus_pay",
          subscription: "sub_pay",
        },
      },
    };
    const r1 = applyStripeEvent(store, event);
    assert.equal(r1.action, "subscribe");
    assert.equal(store.getAccount("pay@atoms.test").remaining, 150);
    assert.equal(store.getAccount("pay@atoms.test").status, "active");

    const r2 = applyStripeEvent(store, event);
    assert.equal(r2.action, "duplicate");
    assert.equal(store.getAccount("pay@atoms.test").remaining, 150);
  });

  it("top-up adds 50", () => {
    const store = createStore();
    store.grantPeriod("t@atoms.test", { remaining: 10, status: "active" });
    applyStripeEvent(store, {
      id: "evt_top_1",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          metadata: { email: "t@atoms.test", kind: "topup_50" },
        },
      },
    });
    assert.equal(store.getAccount("t@atoms.test").remaining, 60);
  });

  it("renewal invoice resets remaining without rollover", () => {
    const store = createStore();
    store.grantPeriod("r@atoms.test", {
      remaining: 12,
      status: "active",
      plan: "monthly",
    });
    store.setStripeCustomer("r@atoms.test", "cus_r");
    applyStripeEvent(store, {
      id: "evt_inv_1",
      type: "invoice.paid",
      data: {
        object: {
          billing_reason: "subscription_cycle",
          customer: "cus_r",
          metadata: {},
        },
      },
    });
    assert.equal(store.getAccount("r@atoms.test").remaining, 150);
  });

  it("trial checkout marks trialing", () => {
    const store = createStore();
    applyStripeEvent(store, {
      id: "evt_trial",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          metadata: {
            email: "tr@atoms.test",
            kind: "start_trial",
            plan: "trial",
          },
        },
      },
    });
    const a = store.getAccount("tr@atoms.test");
    assert.equal(a.status, "trialing");
    assert.equal(a.plan, "trial");
    assert.equal(a.remaining, 150);
  });
});
