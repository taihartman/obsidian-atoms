/**
 * #408 — Manage subscription with a test-mode customer id under live keys.
 *
 * Stripe returns "similar object exists in test mode, but a live mode key was
 * used". Portal must clear the billing link (not the meter) and open live
 * Checkout so the plugin's existing window.open path reconnects billing.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import {
  PORTAL_STALE_CUSTOMER_MESSAGE,
  createPortalSessionForAccount,
  isStaleStripeCustomerError,
  reconnectCheckoutKind,
} from "../src/stripe.mjs";

before(() => {
  process.env.STRIPE_SECRET_KEY = "sk_live_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  process.env.STRIPE_PRICE_MONTHLY = "price_monthly_test";
  process.env.STRIPE_PRICE_YEARLY = "price_yearly_test";
  process.env.STRIPE_PRICE_TOPUP = "price_topup_test";
});

describe("isStaleStripeCustomerError", () => {
  it("matches the live-key / test-customer mode mismatch", () => {
    const err = new Error(
      "No such customer: 'cus_UxIOqpgzNB3c5R'; a similar object exists in test mode, but a live mode key was used to make this request.",
    );
    assert.equal(isStaleStripeCustomerError(err), true);
  });

  it("matches the reverse mismatch", () => {
    const err = new Error(
      "No such customer: 'cus_x'; a similar object exists in live mode, but a test mode key was used to make this request.",
    );
    assert.equal(isStaleStripeCustomerError(err), true);
  });

  it("matches resource_missing on customer", () => {
    const err = new Error("No such customer: 'cus_gone'");
    err.stripe = {
      error: {
        code: "resource_missing",
        param: "customer",
        message: "No such customer: 'cus_gone'",
      },
    };
    assert.equal(isStaleStripeCustomerError(err), true);
  });

  it("ignores unrelated Stripe failures", () => {
    const err = new Error("Your card was declined.");
    err.stripe = { error: { code: "card_declined" } };
    assert.equal(isStaleStripeCustomerError(err), false);
  });
});

describe("reconnectCheckoutKind", () => {
  it("reopens trial Checkout while trialing", () => {
    assert.equal(reconnectCheckoutKind({ status: "trialing" }), "start_trial");
  });

  it("uses monthly subscribe once active or exhausted", () => {
    assert.equal(reconnectCheckoutKind({ status: "active" }), "subscribe_monthly");
    assert.equal(
      reconnectCheckoutKind({ status: "exhausted" }),
      "subscribe_monthly",
    );
  });
});

describe("createPortalSessionForAccount", () => {
  it("returns a portal url when Stripe accepts the customer", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("ok@atoms.test", {
      status: "trialing",
      remaining: 120,
      plan: "trial",
    });
    await store.setStripeCustomer("ok@atoms.test", "cus_live_ok");
    const account = await store.getAccount("ok@atoms.test");

    const portal = await createPortalSessionForAccount(store, account, {
      createSession: async () => ({
        url: "https://billing.stripe.com/p/session/test",
      }),
    });
    assert.equal(portal.url, "https://billing.stripe.com/p/session/test");
    assert.equal(portal.reconnect, false);
    assert.equal(
      (await store.getAccount("ok@atoms.test")).stripeCustomerId,
      "cus_live_ok",
    );
  });

  it("opens trial Checkout when there is no Stripe customer yet", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("tai@atoms.test", {
      status: "trialing",
      remaining: 120,
      plan: "trial",
      days: 14,
    });
    const account = await store.getAccount("tai@atoms.test");
    const kinds = [];

    const out = await createPortalSessionForAccount(store, account, {
      sessionToken: "sess_reconnect",
      createCheckout: async ({ email, kind }) => {
        kinds.push({ email, kind });
        return {
          id: "cs_reconnect_1",
          url: "https://checkout.stripe.com/c/pay/cs_reconnect_1",
        };
      },
    });

    assert.deepEqual(kinds, [{ email: "tai@atoms.test", kind: "start_trial" }]);
    assert.equal(out.reconnect, true);
    assert.equal(out.url, "https://checkout.stripe.com/c/pay/cs_reconnect_1");
    assert.equal(
      (await store.getAccount("tai@atoms.test")).status,
      "trialing",
    );
    assert.equal((await store.getAccount("tai@atoms.test")).remaining, 120);
  });

  it("clears a stale customer and opens live Checkout", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("tai@atoms.test", {
      status: "trialing",
      remaining: 120,
      plan: "trial",
      days: 14,
    });
    await store.setStripeCustomer("tai@atoms.test", "cus_UxIOqpgzNB3c5R");
    await store.setStripeSubscription("tai@atoms.test", "sub_test_stale");
    const account = await store.getAccount("tai@atoms.test");

    const out = await createPortalSessionForAccount(store, account, {
      sessionToken: "sess_tai",
      createSession: async () => {
        const err = new Error(
          "No such customer: 'cus_UxIOqpgzNB3c5R'; a similar object exists in test mode, but a live mode key was used to make this request.",
        );
        err.status = 400;
        err.stripe = {
          error: {
            code: "resource_missing",
            param: "customer",
            message: err.message,
          },
        };
        throw err;
      },
      createCheckout: async ({ kind }) => {
        assert.equal(kind, "start_trial");
        return {
          id: "cs_live_1",
          url: "https://checkout.stripe.com/c/pay/cs_live_1",
        };
      },
    });

    assert.equal(out.reconnect, true);
    assert.equal(out.url, "https://checkout.stripe.com/c/pay/cs_live_1");

    const after = await store.getAccount("tai@atoms.test");
    assert.equal(after.stripeCustomerId, undefined);
    assert.equal(after.stripeSubscriptionId, undefined);
    assert.equal(after.status, "trialing");
    assert.equal(after.remaining, 120);
    assert.equal(await store.emailFromStripeCustomer("cus_UxIOqpgzNB3c5R"), null);
  });

  it("re-throws unrelated portal failures without clearing", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("keep@atoms.test", {
      status: "active",
      remaining: 50,
    });
    await store.setStripeCustomer("keep@atoms.test", "cus_keep");
    const account = await store.getAccount("keep@atoms.test");

    await assert.rejects(
      () =>
        createPortalSessionForAccount(store, account, {
          createSession: async () => {
            throw new Error("Stripe 503");
          },
        }),
      /Stripe 503/,
    );
    assert.equal(
      (await store.getAccount("keep@atoms.test")).stripeCustomerId,
      "cus_keep",
    );
  });

  it("surfaces the stale message when reconnect Checkout has no url", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("bad@atoms.test", {
      status: "trialing",
      remaining: 10,
    });
    const account = await store.getAccount("bad@atoms.test");

    await assert.rejects(
      () =>
        createPortalSessionForAccount(store, account, {
          createCheckout: async () => ({ id: "cs_empty" }),
        }),
      (err) => {
        assert.equal(err.message, PORTAL_STALE_CUSTOMER_MESSAGE);
        assert.equal(err.status, 409);
        return true;
      },
    );
  });
});
