/**
 * #408 — Manage subscription with a test-mode customer id under live keys.
 *
 * Stripe returns "similar object exists in test mode, but a live mode key was
 * used". Portal must clear the billing link (not the meter) and surface a
 * short reconnect message — never the raw Stripe string.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import {
  PORTAL_STALE_CUSTOMER_MESSAGE,
  createPortalSessionForAccount,
  isStaleStripeCustomerError,
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
      createSession: async () => ({ url: "https://billing.stripe.com/p/session/test" }),
    });
    assert.equal(portal.url, "https://billing.stripe.com/p/session/test");
    assert.equal(
      (await store.getAccount("ok@atoms.test")).stripeCustomerId,
      "cus_live_ok",
    );
  });

  it("clears the billing link and keeps filings on mode mismatch", async () => {
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

    await assert.rejects(
      () =>
        createPortalSessionForAccount(store, account, {
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
        }),
      (err) => {
        assert.equal(err.message, PORTAL_STALE_CUSTOMER_MESSAGE);
        assert.equal(err.status, 409);
        assert.equal(err.staleCustomer, true);
        return true;
      },
    );

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
});
