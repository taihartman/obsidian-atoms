/**
 * #230 — production trial checkout must not kill the paying user's session.
 *
 * grantPeriod revokes every unverified session for an email (C1, #163). The
 * dogfood branch repaired that with markSessionVerified; the real Stripe branch
 * never did, so every production trial signup dead-ended on "Invalid session".
 * These tests drive the Stripe path, which had no session-lifecycle coverage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createStore } from "../src/store.mjs";
import { applyStripeEvent } from "../src/stripe.mjs";
import { CHECKOUT_BINDING_TTL_MS } from "../src/store/shared.mjs";

process.env.DOGFOOD_AUTO_GRANT = "0";
process.env.ATOMS_PLUS_ENV = "development";

function runStoreSuite(name, create) {
  describe(`checkout session binding (${name})`, () => {
    it("promotes the session that opened checkout, so refresh works after paying", async () => {
      const store = await create();
      const soft = await store.startWithEmail("payer@ex.com");
      assert.equal(soft.ok, true);

      await store.bindCheckoutSession("cs_live_1", "payer@ex.com", soft.session);
      await store.grantPeriod("payer@ex.com", {
        status: "trialing",
        plan: "trial",
        days: 14,
        remaining: 150,
      });
      // Without the promote this is where the user is stranded.
      assert.equal(await store.accountFromSession(soft.session), null);

      assert.equal(
        await store.promoteCheckoutSession("cs_live_1", "payer@ex.com"),
        true,
      );
      const me = await store.accountFromSession(soft.session);
      assert.equal(me?.email, "payer@ex.com");
      assert.equal(me?.status, "trialing");
      // Verified too — an unverified session cannot file (C1 consume gate).
      const strict = await store.accountFromSession(soft.session, {
        requireVerified: true,
      });
      assert.equal(strict?.email, "payer@ex.com");

      if (store.close) await store.close();
    });

    it("C1 preserved: a soft session that never opened checkout stays revoked", async () => {
      const store = await create();
      const attacker = await store.startWithEmail("victim@ex.com");
      const victim = await store.startWithEmail("victim@ex.com");
      assert.ok(attacker.ok && victim.ok);

      // Only the victim's session opened checkout.
      await store.bindCheckoutSession("cs_live_2", "victim@ex.com", victim.session);
      await store.grantPeriod("victim@ex.com", {
        status: "trialing",
        plan: "trial",
        days: 14,
        remaining: 150,
      });
      await store.promoteCheckoutSession("cs_live_2", "victim@ex.com");

      assert.equal(await store.accountFromSession(attacker.session), null);
      const consume = await store.tryConsumeFiling(attacker.session, "k1");
      assert.equal(consume.ok, false);
      assert.equal(consume.code, "auth");
      assert.ok(await store.accountFromSession(victim.session));

      if (store.close) await store.close();
    });

    it("is single-use: replaying the same checkout id does not re-verify", async () => {
      const store = await create();
      const soft = await store.startWithEmail("replay@ex.com");
      await store.bindCheckoutSession("cs_live_3", "replay@ex.com", soft.session);
      await store.grantPeriod("replay@ex.com", { status: "active", remaining: 5 });

      assert.equal(
        await store.promoteCheckoutSession("cs_live_3", "replay@ex.com"),
        true,
      );
      await store.revokeAllSessionsForEmail("replay@ex.com");
      assert.equal(
        await store.promoteCheckoutSession("cs_live_3", "replay@ex.com"),
        false,
      );
      assert.equal(await store.accountFromSession(soft.session), null);

      if (store.close) await store.close();
    });

    it("refuses a binding whose email does not match the granted account", async () => {
      const store = await create();
      const soft = await store.startWithEmail("bound@ex.com");
      await store.bindCheckoutSession("cs_live_4", "bound@ex.com", soft.session);
      await store.grantPeriod("bound@ex.com", { status: "active", remaining: 5 });

      assert.equal(
        await store.promoteCheckoutSession("cs_live_4", "other@ex.com"),
        false,
      );
      assert.equal(await store.accountFromSession(soft.session), null);

      if (store.close) await store.close();
    });

    it("refuses an unknown checkout id", async () => {
      const store = await create();
      assert.equal(
        await store.promoteCheckoutSession("cs_never_seen", "nobody@ex.com"),
        false,
      );
      assert.equal(await store.promoteCheckoutSession("", "nobody@ex.com"), false);
      if (store.close) await store.close();
    });
  });
}

runStoreSuite("memory", () => createMemoryStore());
runStoreSuite("sqlite", () => createSqliteStore(":memory:"));
runStoreSuite("createStore-memory", () => createStore({ mode: "memory" }));

describe("#230 production trial webhook end-to-end", () => {
  it("checkout.session.completed leaves the original plugin session usable", async () => {
    const store = await createStore({ mode: "memory" });
    const soft = await store.startWithEmail("plugin@atoms.test");
    assert.equal(soft.ok, true);

    // What POST /v1/billing/checkout does on the real Stripe branch.
    await store.bindCheckoutSession("cs_test_230", "plugin@atoms.test", soft.session);

    const r = await applyStripeEvent(store, {
      id: "evt_230",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_230",
          mode: "subscription",
          metadata: {
            email: "plugin@atoms.test",
            kind: "start_trial",
            plan: "trial",
          },
        },
      },
    });
    assert.equal(r.action, "trial");

    // The reported bug: this was null, and every Refresh status returned 401.
    const me = await store.accountFromSession(soft.session);
    assert.equal(me?.email, "plugin@atoms.test");
    assert.equal(me?.status, "trialing");

    // And the session can actually file.
    const consume = await store.tryConsumeFiling(soft.session, "k-230");
    assert.equal(consume.ok, true);
  });

  it("a webhook for an unbound checkout grants but promotes nothing", async () => {
    const store = await createStore({ mode: "memory" });
    const soft = await store.startWithEmail("unbound@atoms.test");

    const r = await applyStripeEvent(store, {
      id: "evt_230_unbound",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_unbound",
          mode: "subscription",
          metadata: {
            email: "unbound@atoms.test",
            kind: "start_trial",
            plan: "trial",
          },
        },
      },
    });
    assert.equal(r.action, "trial");
    assert.equal(
      (await store.getAccount("unbound@atoms.test"))?.status,
      "trialing",
    );
    assert.equal(await store.accountFromSession(soft.session), null);
  });
});

/**
 * The suite above can only run memory + sqlite; postgres is the production store
 * and needs a live DB, so nothing here executes it. That gap is real — it is how
 * a wrong parameter in the postgres binding survived a fully green run during
 * this fix. Until there is a postgres-backed integration job, at least hold the
 * three stores to the same method surface so one can never silently lack it.
 */
describe("#230 store parity", () => {
  it("all three stores define and export the checkout binding methods", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const storeDir = join(dirname(fileURLToPath(import.meta.url)), "../src/store");

    for (const file of ["memory.mjs", "sqlite.mjs", "postgres.mjs"]) {
      const src = readFileSync(join(storeDir, file), "utf8");
      for (const method of ["bindCheckoutSession", "promoteCheckoutSession"]) {
        assert.match(
          src,
          new RegExp(`function ${method}\\(`),
          `${file} must define ${method}`,
        );
        assert.match(
          src,
          new RegExp(`^\\s+${method},$`, "m"),
          `${file} must export ${method}`,
        );
      }
    }
  });
});

describe("#230 binding TTL", () => {
  it("is bounded to the Stripe Checkout Session lifetime", () => {
    assert.ok(CHECKOUT_BINDING_TTL_MS > 0);
    assert.ok(CHECKOUT_BINDING_TTL_MS <= 24 * 60 * 60 * 1000);
  });
});
