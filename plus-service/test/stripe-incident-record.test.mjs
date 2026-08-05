/**
 * #238 U2 — record at both holes, and only at the holes.
 *
 * Class B: `applyStripeEvent`'s no-grant returns record an incident and return
 * the row on `result.incident` so the single alert call site (the webhook
 * handler) can alert without pulling Resend into pure-logic tests.
 *
 * The plan's "Not incidents" carve-out is load-bearing: `unpaid_skip`,
 * `invoice_skip` and `duplicate` are legitimate and recording them would
 * manufacture the alert fatigue KTD2 exists to prevent. The *revoke*-path
 * `missing_email` (customer.subscription.deleted/updated) is deliberately not
 * this issue — it is a failed revoke, the opposite harm direction.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { applyStripeEvent } from "../src/stripe.mjs";

before(() => {
  process.env.ATOMS_PLUS_ENV = "development";
  process.env.DOGFOOD_AUTO_GRANT = "0";
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  process.env.STRIPE_PRICE_MONTHLY = "price_monthly_test";
  process.env.STRIPE_PRICE_YEARLY = "price_yearly_test";
  process.env.STRIPE_PRICE_TOPUP = "price_topup_test";
});

async function allIncidents(store) {
  return store.listStripeIncidents({ since: 0 });
}

describe("#238 U2 class B — no-grant returns record an incident", () => {
  it("missing_email on checkout records with the session id", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_b_missing",
      type: "checkout.session.completed",
      data: { object: { id: "cs_missing", mode: "subscription", metadata: {} } },
    });
    assert.equal(r.action, "missing_email");
    assert.ok(r.incident, "result carries the recorded row for the alert site");

    const rows = await allIncidents(store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "missing_email");
    assert.equal(rows[0].stripeId, "cs_missing");
    assert.equal(rows[0].occurrences, 1);
    assert.equal(rows[0].id, r.incident.id);
  });

  it("email_mismatch records with the disputed email", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_b_mismatch",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_mismatch",
          mode: "subscription",
          metadata: { email: "plugin@atoms.test", kind: "start_trial" },
          customer_details: { email: "other@evil.test" },
        },
      },
    });
    assert.equal(r.action, "email_mismatch");

    const rows = await allIncidents(store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "email_mismatch");
    assert.equal(rows[0].stripeId, "cs_mismatch");
    assert.equal(rows[0].email, "plugin@atoms.test");
  });

  it("unknown_price records with the session id", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_b_price",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_price",
          mode: "subscription",
          metadata: { email: "p@atoms.test", kind: "subscribe_monthly" },
          line_items: { data: [{ price: { id: "price_not_ours" } }] },
        },
      },
    });
    assert.equal(r.action, "unknown_price");

    const rows = await allIncidents(store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "unknown_price");
    assert.equal(rows[0].stripeId, "cs_price");
  });

  it("a renewal invoice with no resolvable email records under its own kind", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_b_invoice",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_orphan",
          billing_reason: "subscription_cycle",
          metadata: {},
        },
      },
    });
    assert.equal(r.action, "missing_email");

    const rows = await allIncidents(store);
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].kind,
      "invoice_missing_email",
      "kept distinct from the checkout-path missing_email so the two throttle apart",
    );
    assert.equal(rows[0].stripeId, "in_orphan");
  });
});

describe("#238 U2 — legitimate outcomes record nothing", () => {
  it("unpaid_skip is not an incident", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_unpaid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_unpaid",
          mode: "subscription",
          payment_status: "unpaid",
          metadata: { email: "u@atoms.test", kind: "subscribe_monthly" },
        },
      },
    });
    assert.equal(r.action, "unpaid_skip");
    assert.deepEqual(await allIncidents(store), []);
  });

  it("invoice_skip is not an incident", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_inv_skip",
      type: "invoice.paid",
      data: {
        object: { id: "in_create", billing_reason: "subscription_create" },
      },
    });
    assert.equal(r.action, "invoice_skip");
    assert.deepEqual(await allIncidents(store), []);
  });

  it("duplicate is not an incident", async () => {
    const store = createMemoryStore();
    const event = {
      id: "evt_dup",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_dup",
          mode: "subscription",
          metadata: {
            email: "d@atoms.test",
            kind: "subscribe_monthly",
            plan: "monthly",
          },
        },
      },
    };
    assert.equal((await applyStripeEvent(store, event)).action, "subscribe");
    assert.equal((await applyStripeEvent(store, event)).action, "duplicate");
    assert.deepEqual(await allIncidents(store), []);
  });

  it("a successful grant is not an incident", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_ok_grant",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_ok",
          mode: "subscription",
          metadata: {
            email: "ok@atoms.test",
            kind: "start_trial",
            plan: "trial",
          },
        },
      },
    });
    assert.equal(r.action, "trial");
    assert.deepEqual(await allIncidents(store), []);
  });

});

describe("#238 U2 — the revoke path records too (F5)", () => {
  /**
   * The fifth no-grant branch. `customer.subscription.deleted` with no
   * resolvable email claims the event, revokes nothing, and Stripe never
   * retries — so the account keeps entitlement invisibly. Repairing revokes is
   * still out of scope; being invisible is not.
   */
  it("records revoke_missing_email when a cancellation cannot be attributed", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_revoke_orphan",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_orphan", metadata: {} } },
    });
    assert.equal(r.action, "missing_email");
    assert.equal(r.handled, false, "the webhook answer is unchanged");

    const rows = await allIncidents(store);
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].kind,
      "revoke_missing_email",
      "own kind — a stuck grant throttles apart from the lost-grant kinds",
    );
    assert.equal(rows[0].stripeId, "sub_orphan");
    assert.match(rows[0].detail, /not revoked/i);
  });

  it("covers the canceled subscription.updated shape as well", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_revoke_updated",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_upd", status: "canceled", metadata: {} } },
    });
    assert.equal(r.action, "missing_email");
    const rows = await allIncidents(store);
    assert.deepEqual(
      rows.map((x) => [x.kind, x.stripeId]),
      [["revoke_missing_email", "sub_upd"]],
    );
  });

  it("a resolvable cancellation revokes and records nothing", async () => {
    const store = createMemoryStore();
    const r = await applyStripeEvent(store, {
      id: "evt_revoke_ok",
      type: "customer.subscription.deleted",
      data: {
        object: { id: "sub_ok", metadata: { email: "gone@atoms.test" } },
      },
    });
    assert.equal(r.action, "revoke");
    assert.deepEqual(await allIncidents(store), []);
  });
});
