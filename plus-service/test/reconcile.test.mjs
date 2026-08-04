/**
 * #238 U4/U5 — class-C reconciliation sweep.
 *
 * KTD5 is the load-bearing one: the oracle is `hasProcessedEvent`, never
 * account entitlement. An entitled-looking top-up would hide a lost payment,
 * and an expired-but-legitimate period would be "repaired" with a fresh one.
 *
 * Every Stripe call goes through an injected fetch — no network, no global
 * monkey-patching, consistent with `test/stripe.test.mjs`.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { reconcileStripe } from "../src/reconcile.mjs";
import { applyCheckoutCompleted } from "../src/stripe.mjs";
import { config } from "../src/config.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);

before(() => {
  process.env.ATOMS_PLUS_ENV = "development";
  process.env.DOGFOOD_AUTO_GRANT = "0";
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_PRICE_MONTHLY = "price_monthly_test";
  process.env.STRIPE_PRICE_YEARLY = "price_yearly_test";
  process.env.STRIPE_PRICE_TOPUP = "price_topup_test";
});

/** @param {{id: string, session?: object, createdMs?: number}} opts */
function checkoutEvent(opts) {
  const createdMs = opts.createdMs ?? NOW - DAY;
  return {
    id: opts.id,
    type: "checkout.session.completed",
    created: Math.floor(createdMs / 1000),
    data: {
      object: {
        id: `cs_${opts.id}`,
        mode: "subscription",
        payment_status: "paid",
        created: Math.floor(createdMs / 1000),
        metadata: { email: "payer@atoms.test", kind: "subscribe_monthly", plan: "monthly" },
        ...(opts.session || {}),
      },
    },
  };
}

/** Injected fetch over a list of pages; walks `starting_after` like Stripe. */
function stripeStub(pages) {
  const urls = [];
  async function fetchImpl(url, init) {
    urls.push(String(url));
    assert.equal(init?.method, "GET");
    assert.match(String(init?.headers?.authorization || ""), /^Bearer sk_test_/);
    const after = new URL(String(url)).searchParams.get("starting_after");
    const idx = after
      ? pages.findIndex((p) => p.some((e) => e.id === after)) + 1
      : 0;
    const data = pages[idx] || [];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data,
        has_more: idx < pages.length - 1,
      }),
    };
  }
  return { fetchImpl, urls };
}

/** Memory store with grant-path call counters. */
function spyStore() {
  const store = createMemoryStore();
  const calls = { grantPeriod: 0, addTopUp: 0 };
  const grantPeriod = store.grantPeriod;
  const addTopUp = store.addTopUp;
  store.grantPeriod = (...args) => {
    calls.grantPeriod += 1;
    return grantPeriod(...args);
  };
  store.addTopUp = (...args) => {
    calls.addTopUp += 1;
    return addTopUp(...args);
  };
  return { store, calls };
}

describe("#238 U4 sweep — hasProcessedEvent is the oracle", () => {
  it("flags an unprocessed event and leaves a processed one alone", async () => {
    const store = createMemoryStore();
    await store.markEventProcessed("evt_seen");
    const { fetchImpl } = stripeStub([
      [checkoutEvent({ id: "evt_seen" }), checkoutEvent({ id: "evt_lost" })],
    ]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.scanned, 2);
    assert.equal(report.flagged.length, 1);
    assert.equal(report.flagged[0].eventId, "evt_lost");
    assert.equal(report.flagged[0].sessionId, "cs_evt_lost");
    assert.equal(report.flagged[0].email, "payer@atoms.test");
  });

  it("walks every page via starting_after", async () => {
    const store = createMemoryStore();
    const { fetchImpl, urls } = stripeStub([
      [checkoutEvent({ id: "evt_p1a" }), checkoutEvent({ id: "evt_p1b" })],
      [checkoutEvent({ id: "evt_p2a" })],
    ]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(urls.length, 2);
    assert.match(urls[1], /starting_after=evt_p1b/);
    assert.equal(report.scanned, 3);
    assert.deepEqual(
      report.flagged.map((f) => f.eventId),
      ["evt_p1a", "evt_p1b", "evt_p2a"],
    );
  });

  it("flags a no_payment_required trial — the signup class #230 was about", async () => {
    const store = createMemoryStore();
    const { fetchImpl } = stripeStub([
      [
        checkoutEvent({
          id: "evt_trial",
          session: {
            payment_status: "no_payment_required",
            metadata: { email: "trialer@atoms.test", kind: "start_trial", plan: "trial" },
          },
        }),
      ],
    ]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.skippedUnpaid, 0);
    assert.deepEqual(
      report.flagged.map((f) => f.eventId),
      ["evt_trial"],
    );
    assert.equal(report.flagged[0].email, "trialer@atoms.test");
  });

  it("skips a session whose payment_status is not grantable", async () => {
    const store = createMemoryStore();
    const { fetchImpl } = stripeStub([
      [
        checkoutEvent({ id: "evt_unpaid", session: { payment_status: "unpaid" } }),
        checkoutEvent({ id: "evt_paid" }),
      ],
    ]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.skippedUnpaid, 1);
    assert.deepEqual(
      report.flagged.map((f) => f.eventId),
      ["evt_paid"],
    );
  });

  it("never sends payment_status as a list filter (not a valid Stripe filter)", async () => {
    const store = createMemoryStore();
    const { fetchImpl, urls } = stripeStub([[checkoutEvent({ id: "evt_q" })]]);

    await reconcileStripe({ store, fetchImpl, now: NOW });

    for (const url of urls) {
      assert.ok(
        !decodeURIComponent(url).includes("payment_status"),
        `query must not filter payment_status: ${url}`,
      );
      assert.match(decodeURIComponent(url), /type=checkout\.session\.completed/);
      assert.match(decodeURIComponent(url), /created\[gte\]=\d+/);
    }
  });

  it("records every flagged event as a class-C incident", async () => {
    const store = createMemoryStore();
    const { fetchImpl } = stripeStub([
      [checkoutEvent({ id: "evt_c1" }), checkoutEvent({ id: "evt_c2" })],
    ]);

    await reconcileStripe({ store, fetchImpl, now: NOW });

    const rows = await store.listStripeIncidents({ since: 0 });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.kind, "missing_webhook");
      assert.equal(row.email, "payer@atoms.test");
      assert.equal(row.occurrences, 1);
    }
    assert.deepEqual(
      rows.map((r) => r.stripeId).sort(),
      ["cs_evt_c1", "cs_evt_c2"],
    );
  });
});

describe("#238 U4 — report-only is the default", () => {
  it("grants nothing without --repair", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub([[checkoutEvent({ id: "evt_ro" })]]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.repair, false);
    assert.equal(report.repaired.length, 0);
    assert.equal(calls.grantPeriod, 0);
    assert.equal(calls.addTopUp, 0);
    assert.equal(await store.getAccount("payer@atoms.test"), null);
    assert.equal(await store.hasProcessedEvent("evt_ro"), false);
  });
});

describe("#238 U4 — --repair", () => {
  it("gives a topup_50 addTopUp, never a 30-day period", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub([
      [
        checkoutEvent({
          id: "evt_top",
          session: {
            mode: "payment",
            metadata: {
              email: "payer@atoms.test",
              kind: "topup_50",
              plan: "topup",
            },
          },
        }),
      ],
    ]);

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(calls.addTopUp, 1);
    assert.equal(calls.grantPeriod, 0);
    assert.equal(report.repaired.length, 1);
    assert.equal(report.repaired[0].action, "topup");
    // KTD6 — repair restores entitlement only; the session is unrecoverable.
    assert.equal(report.repaired[0].sessionRestored, false);
    assert.match(report.repaired[0].note, /sign in again/i);

    const acct = await store.getAccount("payer@atoms.test");
    assert.equal(acct.remaining, config.topUpFilings);
  });

  it("grants a subscription session a period", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub([[checkoutEvent({ id: "evt_sub" })]]);

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(calls.grantPeriod, 1);
    assert.equal(calls.addTopUp, 0);
    assert.equal(report.repaired[0].action, "subscribe");
    assert.equal((await store.getAccount("payer@atoms.test")).status, "active");
  });

  it("claims the event, so repairing the same event twice cannot double-mint", async () => {
    const { store, calls } = spyStore();
    const event = checkoutEvent({
      id: "evt_once",
      session: {
        mode: "payment",
        metadata: { email: "payer@atoms.test", kind: "topup_50", plan: "topup" },
      },
    });
    const { fetchImpl } = stripeStub([[event]]);

    await reconcileStripe({ store, fetchImpl, now: NOW, repair: true });
    assert.equal(calls.addTopUp, 1);
    assert.equal(await store.hasProcessedEvent("evt_once"), true);

    // A second sweep no longer sees it — the oracle says processed.
    const again = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });
    assert.equal(again.flagged.length, 0);
    assert.equal(calls.addTopUp, 1);

    // And a late Stripe redelivery of the same event grants nothing either.
    const dup = await applyCheckoutCompleted(store, event);
    assert.equal(dup.action, "duplicate");
    assert.equal(calls.addTopUp, 1);
    assert.equal((await store.getAccount("payer@atoms.test")).remaining, config.topUpFilings);
  });

  it("refuses a session older than the period it would grant, and proceeds with force", async () => {
    const stale = {
      id: "evt_old",
      createdMs: NOW - 20 * DAY,
      session: {
        metadata: {
          email: "payer@atoms.test",
          kind: "start_trial",
          plan: "trial",
        },
      },
    };

    const a = spyStore();
    const first = await reconcileStripe({
      store: a.store,
      fetchImpl: stripeStub([[checkoutEvent(stale)]]).fetchImpl,
      now: NOW,
      since: NOW - 30 * DAY,
      repair: true,
    });
    assert.equal(a.calls.grantPeriod, 0);
    assert.equal(first.repaired.length, 0);
    assert.equal(first.refused.length, 1);
    assert.equal(first.refused[0].eventId, "evt_old");
    assert.match(first.refused[0].reason, /older than/i);
    assert.equal(first.refused[0].maxAgeDays, config.trialDays);

    const b = spyStore();
    const forced = await reconcileStripe({
      store: b.store,
      fetchImpl: stripeStub([[checkoutEvent(stale)]]).fetchImpl,
      now: NOW,
      since: NOW - 30 * DAY,
      repair: true,
      force: true,
    });
    assert.equal(b.calls.grantPeriod, 1);
    assert.equal(forced.refused.length, 0);
    assert.equal(forced.repaired[0].action, "trial");
  });
});
