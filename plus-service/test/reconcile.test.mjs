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

/**
 * Injected fetch over a list of pages; walks `starting_after` like Stripe.
 * `subscriptions` answers the repair path's `/subscriptions/{id}` lookup — an
 * id absent from the map 404s, which the sweep must treat as "no evidence of
 * cancellation" rather than as a cancellation.
 */
function stripeStub(pages, subscriptions = {}) {
  const urls = [];
  async function fetchImpl(url, init) {
    urls.push(String(url));
    assert.equal(init?.method, "GET");
    assert.match(String(init?.headers?.authorization || ""), /^Bearer sk_test_/);
    const parsed = new URL(String(url));
    const subMatch = parsed.pathname.match(/\/v1\/subscriptions\/(.+)$/);
    if (subMatch) {
      const sub = subscriptions[decodeURIComponent(subMatch[1])];
      if (!sub) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: "No such subscription" } }),
        };
      }
      return { ok: true, status: 200, json: async () => sub };
    }
    const after = parsed.searchParams.get("starting_after");
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

describe("#238 F6 — payment_status filter agrees with the webhook by construction", () => {
  it("skips only the literal unpaid, exactly as applyCheckoutCompleted does", async () => {
    const store = createMemoryStore();
    const { fetchImpl } = stripeStub([
      [checkoutEvent({ id: "evt_unpaid", session: { payment_status: "unpaid" } })],
    ]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.skippedUnpaid, 1);
    assert.equal(report.flagged.length, 0);
  });

  it("flags a payment_status it has never seen instead of dropping it", async () => {
    // An allowlist would silently drop this — while the webhook, which skips
    // only "unpaid", would have granted on it. That asymmetry can only ever
    // hide a real lost grant, so the sweep must flag the unknown status.
    const store = createMemoryStore();
    const unknown = { payment_status: "settled_via_some_future_rail" };
    const event = checkoutEvent({ id: "evt_future", session: unknown });
    const { fetchImpl } = stripeStub([[event]]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.skippedUnpaid, 0, "unknown is not unpaid");
    assert.deepEqual(
      report.flagged.map((f) => f.eventId),
      ["evt_future"],
      "an unrecognized payment status must surface, not vanish",
    );

    // Same input, same verdict on the webhook side — that is the invariant.
    const applied = await applyCheckoutCompleted(createMemoryStore(), event);
    assert.notEqual(applied.action, "unpaid_skip");
  });
});

describe("#238 F2 — repair only claims what it actually granted", () => {
  /** A session with no usable email: applyCheckoutCompleted claims, grants nothing. */
  function emaillessEvent(id) {
    return {
      id,
      type: "checkout.session.completed",
      created: Math.floor((NOW - DAY) / 1000),
      data: {
        object: {
          id: `cs_${id}`,
          mode: "subscription",
          payment_status: "paid",
          metadata: {},
        },
      },
    };
  }

  it("files missing_email under failed, not repaired", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub([[emaillessEvent("evt_noemail")]]);

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(calls.grantPeriod, 0);
    assert.equal(calls.addTopUp, 0);
    assert.equal(
      report.repaired.length,
      0,
      "an outcome that granted nothing must not print as repaired",
    );
    assert.equal(report.failed.length, 1);
    assert.equal(report.failed[0].action, "missing_email");
    assert.equal(report.failed[0].eventId, "evt_noemail");
    assert.equal(report.failed[0].claimed, true);
    assert.match(report.failed[0].reason, /granted nothing/i);
    assert.match(
      report.failed[0].reason,
      /not resurface/i,
      "the operator must be told the event is claimed either way",
    );
  });

  it("files email_mismatch under failed too", async () => {
    const { store } = spyStore();
    const event = checkoutEvent({
      id: "evt_mismatch",
      session: { customer_email: "someone.else@atoms.test" },
    });
    const { fetchImpl } = stripeStub([[event]]);

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(report.repaired.length, 0);
    assert.deepEqual(
      report.failed.map((f) => f.action),
      ["email_mismatch"],
    );
  });

  it("and the claim really is permanent — a second sweep never sees it again", async () => {
    const { store } = spyStore();
    const { fetchImpl } = stripeStub([[emaillessEvent("evt_gone")]]);

    await reconcileStripe({ store, fetchImpl, now: NOW, repair: true });
    const again = await reconcileStripe({ store, fetchImpl, now: NOW, repair: true });

    assert.equal(again.flagged.length, 0);
    assert.equal(again.failed.length, 0);
    assert.equal(again.processed, 1);
  });
});

describe("#238 F3 — repair never resurrects a canceled account", () => {
  const canceledEvent = checkoutEvent({
    id: "evt_canceled",
    session: { subscription: "sub_dead" },
  });

  it("skips a checkout whose subscription Stripe now reports canceled", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub([[canceledEvent]], {
      sub_dead: { id: "sub_dead", status: "canceled" },
    });

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(calls.grantPeriod, 0, "no fresh period for a departed customer");
    assert.equal(report.repaired.length, 0);
    assert.equal(report.failed.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].eventId, "evt_canceled");
    assert.equal(report.skipped[0].subscriptionStatus, "canceled");
    assert.match(report.skipped[0].reason, /resurrect/i);
    // Still flagged and still unclaimed — the loss stays visible.
    assert.equal(report.flagged.length, 1);
    assert.equal(await store.hasProcessedEvent("evt_canceled"), false);
  });

  it("--force widens the age window but never re-entitles a canceled account", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub([[canceledEvent]], {
      sub_dead: { id: "sub_dead", status: "canceled" },
    });

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
      force: true,
    });

    assert.equal(calls.grantPeriod, 0);
    assert.equal(report.skipped.length, 1);
  });

  it("repairs normally when the subscription is still alive", async () => {
    const { store, calls } = spyStore();
    const { fetchImpl } = stripeStub(
      [[checkoutEvent({ id: "evt_live", session: { subscription: "sub_live" } })]],
      { sub_live: { id: "sub_live", status: "active" } },
    );

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(calls.grantPeriod, 1);
    assert.equal(report.skipped.length, 0);
    assert.equal(report.repaired[0].action, "subscribe");
  });

  it("treats a failed subscription lookup as no evidence, not as cancellation", async () => {
    const { store, calls } = spyStore();
    // `sub_missing` is absent from the map, so the stub 404s.
    const { fetchImpl } = stripeStub([
      [checkoutEvent({ id: "evt_404", session: { subscription: "sub_missing" } })],
    ]);

    const report = await reconcileStripe({
      store,
      fetchImpl,
      now: NOW,
      repair: true,
    });

    assert.equal(report.skipped.length, 0);
    assert.equal(calls.grantPeriod, 1, "an outage must not block every repair");
  });

  it("costs no subscription lookup at all when not repairing", async () => {
    const store = createMemoryStore();
    const { fetchImpl, urls } = stripeStub([[canceledEvent]], {
      sub_dead: { id: "sub_dead", status: "canceled" },
    });

    await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(urls.length, 1, "report-only stays one list call");
    assert.ok(!urls[0].includes("/subscriptions/"));
  });
});

describe("#238 F7 — a truncated sweep says so", () => {
  it("is not truncated when Stripe runs out of pages", async () => {
    const store = createMemoryStore();
    const { fetchImpl } = stripeStub([[checkoutEvent({ id: "evt_small" })]]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.truncated, false);
  });

  it("flags truncation when the page cap runs out with has_more still set", async () => {
    const store = createMemoryStore();
    let n = 0;
    async function fetchImpl() {
      n += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [checkoutEvent({ id: `evt_cap_${n}` })],
          has_more: true,
        }),
      };
    }

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(
      report.truncated,
      true,
      "a silent cap reads as 'swept everything' when it did not",
    );
    assert.equal(report.scanned, report.pages);
    assert.ok(report.pages > 1);
  });
});

describe("#238 F1 — the report names the store it swept", () => {
  it("carries the store kind so an empty-store sweep is never mistaken for a clean one", async () => {
    const store = createMemoryStore();
    const { fetchImpl } = stripeStub([[checkoutEvent({ id: "evt_kind" })]]);

    const report = await reconcileStripe({ store, fetchImpl, now: NOW });

    assert.equal(report.storeKind, "memory");
  });
});
