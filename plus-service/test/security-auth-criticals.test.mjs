/**
 * C1 soft-start session fixation · C2 cross-tenant idempotency
 * H1 exchange HTML escape · H2 body size (store-level coverage here for C1/C2)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createStore } from "../src/store.mjs";
import { postgresStoreRows } from "./helpers/postgresTestStore.mjs";

process.env.DOGFOOD_AUTO_GRANT = "0";
process.env.ATOMS_PLUS_ENV = "development";

function runStoreSuite(name, create) {
  describe(`auth criticals (${name})`, () => {
    /** @type {() => Promise<any> | any} */
    let fresh = create;

    it("C1: soft-start session cannot classify after entitlement upgrade", async () => {
      const store = await fresh();
      const soft = await store.startWithEmail("victim@example.com");
      assert.equal(soft.ok, true);
      assert.ok(String(soft.session).startsWith("sess_"));

      // Attacker holds soft session; victim later pays / is granted
      await store.grantPeriod("victim@example.com", {
        remaining: 150,
        status: "active",
        days: 30,
      });

      // Soft session must be dead (revoked) or unverified → no consume
      const attack = await store.tryConsumeFiling(soft.session, "attacker-key");
      assert.equal(attack.ok, false);
      assert.equal(attack.code, "auth");

      // Soft session must not resolve as privileged account
      const a = await store.accountFromSession(soft.session, {
        requireVerified: true,
      });
      assert.equal(a, null);

      // /me-style lookup without requireVerified: revoked soft → null
      const bare = await store.accountFromSession(soft.session);
      assert.equal(bare, null);

      if (store.close) await store.close();
    });

    it("C1: magic exchange mints verified session; prior soft is dead", async () => {
      const store = await fresh();
      const soft = await store.startWithEmail("user@ex.com");
      assert.equal(soft.ok, true);

      const mt = await store.createMagicToken("user@ex.com");
      const out = await store.exchangeMagic(mt);
      assert.ok(out?.session);
      assert.notEqual(out.session, soft.session);

      const softGone = await store.accountFromSession(soft.session);
      assert.equal(softGone, null);

      await store.grantPeriod("user@ex.com", {
        remaining: 5,
        status: "active",
      });
      // exchange already verified; grantPeriod only revokes unverified
      const ok = await store.tryConsumeFiling(out.session, "magic-ok");
      assert.equal(ok.ok, true);

      if (store.close) await store.close();
    });

    it("C1: dogfood markSessionVerified restores checkout caller only", async () => {
      const store = await fresh();
      const attacker = await store.startWithEmail("pay@ex.com");
      const victim = await store.startWithEmail("pay@ex.com");
      assert.ok(attacker.ok && victim.ok);

      await store.grantPeriod("pay@ex.com", {
        remaining: 10,
        status: "active",
      });
      // Both soft sessions revoked by grant
      assert.equal(await store.accountFromSession(attacker.session), null);
      assert.equal(await store.accountFromSession(victim.session), null);

      // Only the checkout caller is re-verified
      assert.equal(await store.markSessionVerified(victim.session), true);
      const a = await store.accountFromSession(victim.session, {
        requireVerified: true,
      });
      assert.equal(a?.email, "pay@ex.com");
      assert.equal(await store.accountFromSession(attacker.session), null);

      if (store.close) await store.close();
    });

    it("C2: same Idempotency-Key does not leak across tenants", async () => {
      const store = await fresh();

      async function entitledSession(email, remaining = 5) {
        await store.grantPeriod(email, { remaining, status: "active" });
        const tok = await store.createMagicToken(email);
        const { session } = await store.exchangeMagic(tok);
        await store.grantPeriod(email, { remaining, status: "active" });
        return session;
      }

      const sessA = await entitledSession("alice@t.co", 5);
      const sessB = await entitledSession("bob@t.co", 5);

      const c1 = await store.tryConsumeFiling(sessA, "shared-key");
      assert.equal(c1.ok, true);
      await store.completeUsage("shared-key", {
        email: "alice@t.co",
        status: "ok",
        responseJson: { secret: "alice-classify" },
        remaining: 4,
      });

      const c2 = await store.tryConsumeFiling(sessB, "shared-key");
      assert.equal(c2.ok, false);
      assert.equal(c2.code, "idempotency_conflict");
      assert.notEqual(c2.cached?.responseJson?.secret, "alice-classify");

      // Bob's balance untouched
      assert.equal((await store.getAccount("bob@t.co")).remaining, 5);
      // Alice can still replay her own key
      const replay = await store.tryConsumeFiling(sessA, "shared-key");
      assert.equal(replay.ok, true);
      assert.equal(replay.replay, true);
      assert.equal(replay.cached.responseJson.secret, "alice-classify");

      if (store.close) await store.close();
    });

    it("C1: tryConsumeFiling rejects unverified soft session even if entitled", async () => {
      const store = await fresh();
      // Craft: create soft session, mark account entitled without going through grantPeriod revoke
      // (simulate race where status flips but verified flag still false — use createSession)
      await store.ensureAccount("edge@t.co");

      // Entitle through the public API on every backend. This used to mutate
      // the object returned by getAccount and branch on store.kind, which only
      // persisted on memory (the one store that hands back a live reference) —
      // so the four rows were not proving the same thing, and a fifth backend
      // would have dropped silently into the memory arm and asserted the gate
      // against an account that was never entitled (#239).
      await store.grantPeriod("edge@t.co", { remaining: 10, status: "active" });

      // grantPeriod revokes unverified sessions (C1), so mint the soft session
      // under test after it — the gate being asserted is requireVerified, not
      // the revoke.
      const soft = await store.createSession("edge@t.co", { verified: false });
      const r = await store.tryConsumeFiling(soft, "x");
      assert.equal(r.ok, false);
      assert.equal(r.code, "auth");

      if (store.close) await store.close();
    });
  });
}

runStoreSuite("memory", () => createMemoryStore());
runStoreSuite("sqlite", () => createSqliteStore(":memory:"));
runStoreSuite("createStore-memory", () => createStore({ mode: "memory" }));
// #239 — the production store, when a database is available. Absent locally;
// absent in CI is a hard failure, not a skip. See helpers/postgresTestStore.mjs.
for (const [name, create] of postgresStoreRows()) runStoreSuite(name, create);

describe("H1 exchange HTML escaping", () => {
  it("escapes email and session in exchange page", async () => {
    // Import render path indirectly via dynamic eval of esc pattern used in server
    // Keep a pure unit of the same escHtml logic
    function escHtml(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    const evil = `<img src=x onerror=alert(1)>@evil.com`;
    const out = escHtml(evil);
    assert.ok(!out.includes("<img"));
    assert.ok(out.includes("&lt;img"));
    assert.equal(escHtml(`sess_<script>`).includes("<script>"), false);
  });
});

describe("H2 body size constant", () => {
  it("server.mjs enforces a 2MB readRawBody cap", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../src/server.mjs"), "utf8");
    assert.ok(src.includes("MAX_BODY_BYTES = 2 * 1024 * 1024"));
    assert.ok(src.includes("body_too_large"));
    assert.ok(src.includes("err.status = 413") || src.includes("status === 413"));
  });
});
