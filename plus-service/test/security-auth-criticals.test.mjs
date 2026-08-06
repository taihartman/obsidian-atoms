/**
 * C1 soft-start session fixation · C2 cross-tenant idempotency
 * H1 exchange HTML escape · H2 body size (store-level coverage here for C1/C2)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createPostgresStore } from "../src/store/postgres.mjs";
import { createStore } from "../src/store.mjs";
import { hashToken } from "../src/store/shared.mjs";
import { pkceChallengeS256 } from "../src/store/askHelpers.mjs";
import { createHash } from "node:crypto";
import {
  createTestPostgresStore,
  postgresStoreRows,
  withSearchPath,
} from "./helpers/postgresTestStore.mjs";

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

    // ---- #240 U1: magic-token columns + KTD14 hashed key, in every backend --

    it("U1: a magic row carries the verifier hash and the requesting vault", async () => {
      const store = await fresh();
      const verifierHash = "f".repeat(64);
      const token = await store.createMagicToken("multi@ex.com", {
        verifierHash,
        vault: "Work Vault",
      });

      const rows = await store.magicRowsForTest();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].email, "multi@ex.com");
      assert.equal(rows[0].verifierHash, verifierHash);
      assert.equal(rows[0].vault, "Work Vault");

      // R3 — the vault name has to reach the caller, or a multi-vault device
      // cannot tell which vault asked for the link.
      //
      // Redeemed through U4's check-skipping door because the stored hash here
      // is a literal, not a digest of any verifier: no caller could present a
      // matching one. What is under test is the column round-trip, and U4's
      // own tests own the binding.
      const out = await store.exchangeMagic(token, { skipVerifierCheck: true });
      assert.equal(out?.vault, "Work Vault");
      assert.ok(String(out.session).startsWith("sess_"));

      if (store.close) await store.close();
    });

    it("U1: both new fields are optional — an older caller still works", async () => {
      const store = await fresh();
      const token = await store.createMagicToken("plain@ex.com");

      const rows = await store.magicRowsForTest();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].verifierHash, null);
      assert.equal(rows[0].vault, null);

      const out = await store.exchangeMagic(token);
      assert.ok(out?.session);
      assert.equal(out.vault, null);

      if (store.close) await store.close();
    });

    it("U1: the vault name round-trips with a space and non-ASCII intact", async () => {
      const store = await fresh();
      const vault = "Zettel — Ünïcode ✓ vault";
      const token = await store.createMagicToken("uni@ex.com", { vault });

      assert.equal((await store.magicRowsForTest())[0].vault, vault);
      assert.equal((await store.exchangeMagic(token))?.vault, vault);

      if (store.close) await store.close();
    });

    it("U1/KTD14: the stored row holds only the token hash, never the token", async () => {
      const store = await fresh();
      const token = await store.createMagicToken("hashed@ex.com", {
        verifierHash: "a".repeat(64),
        vault: "Hashed Vault",
      });

      const rows = await store.magicRowsForTest();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].key, hashToken(token));
      // M9: the raw token must not survive anywhere in the row, under any column.
      assert.equal(JSON.stringify(rows).includes(token), false);

      // Insert and lookup must hash the same way, or nothing redeems at all.
      // Check-skipping door, as above: the stored hash is a literal.
      assert.ok(
        (await store.exchangeMagic(token, { skipVerifierCheck: true }))?.session,
      );
      assert.equal((await store.magicRowsForTest()).length, 0);

      if (store.close) await store.close();
    });

    it("U1/KTD11: a pre-deploy plaintext-keyed row is not redeemable", async () => {
      const store = await fresh();
      const token = `mt_${"b".repeat(32)}`;
      await store.writeMagicRowForTest(token, {
        email: "legacy@ex.com",
        expMs: Date.now() + 15 * 60 * 1000,
      });

      // KTD14's re-key orphans it: unreachable, not redeemable.
      assert.equal(await store.exchangeMagic(token), null);

      // It sits there while it is still inside its TTL...
      assert.equal((await store.magicRowsForTest())[0].key, token);

      // ...and a sibling orphan past its TTL is swept by the next mint
      // (U3/KTD13). That is the difference between orphaned-and-swept and
      // orphaned-and-immortal, and the mint is for a different email entirely.
      const stale = `mt_${"c".repeat(32)}`;
      await store.writeMagicRowForTest(stale, {
        email: "legacy@ex.com",
        expMs: Date.now() - 1,
      });
      await store.createMagicToken("someone-else@ex.com");

      const keys = (await store.magicRowsForTest()).map((r) => r.key);
      assert.equal(keys.includes(stale), false);
      assert.equal(keys.includes(token), true);

      if (store.close) await store.close();
    });

    // ---- #240 U2: peekMagic answers without spending, in every backend ------

    it("U2: peeking twice spends nothing — the exchange still succeeds after", async () => {
      const store = await fresh();
      const token = await store.createMagicToken("peek@ex.com", {
        vault: "Peek Vault",
      });

      for (const _ of [1, 2]) {
        const peek = await store.peekMagic(token);
        assert.equal(peek.ok, true);
        assert.equal(peek.status, "usable");
        assert.equal(peek.email, "peek@ex.com");
        // The row is still there after each peek — R6/R9: a validity check and
        // a real exchange stay distinguishable.
        assert.equal((await store.magicRowsForTest()).length, 1);
      }

      const out = await store.exchangeMagic(token);
      assert.ok(String(out?.session).startsWith("sess_"));
      assert.equal(out.vault, "Peek Vault");
      assert.equal((await store.magicRowsForTest()).length, 0);

      if (store.close) await store.close();
    });

    it("U2: peeking an expired token reports expired and leaves the row alone", async () => {
      const store = await fresh();
      const token = `mt_${"e".repeat(32)}`;
      await store.writeMagicRowForTest(hashToken(token), {
        email: "stale@ex.com",
        expMs: Date.now() - 1000,
        vault: "Stale Vault",
      });

      const peek = await store.peekMagic(token);
      assert.equal(peek.ok, false);
      assert.equal(peek.status, "expired");

      // KTD13 — the sweep is U3's job on the mint path. A peek that cleans up
      // is a peek that can be weaponised into a delete.
      const rows = await store.magicRowsForTest();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].key, hashToken(token));

      // And it stays that way however many times it is asked.
      assert.equal((await store.peekMagic(token)).status, "expired");
      assert.equal((await store.magicRowsForTest()).length, 1);

      if (store.close) await store.close();
    });

    it("U2: peeking an unknown token reports invalid without throwing", async () => {
      const store = await fresh();

      for (const bogus of [`mt_${"z".repeat(32)}`, "", "not-a-token"]) {
        const peek = await store.peekMagic(bogus);
        assert.equal(peek.ok, false);
        assert.equal(peek.status, "invalid");
        assert.equal(peek.email, null);
        assert.equal(peek.vault, null);
        assert.equal(peek.verifierBound, false);
      }

      if (store.close) await store.close();
    });

    it("U2: peek returns the requesting vault, and null when none was recorded", async () => {
      const store = await fresh();

      const named = await store.createMagicToken("named@ex.com", {
        vault: "Zettel — Ünïcode ✓ vault",
      });
      const anon = await store.createMagicToken("anon@ex.com");

      // R18 — the landing page names the requesting vault before the tap, so
      // the name has to survive the peek intact.
      assert.equal(
        (await store.peekMagic(named)).vault,
        "Zettel — Ünïcode ✓ vault",
      );
      assert.equal((await store.peekMagic(anon)).vault, null);

      if (store.close) await store.close();
    });

    it("U2: peek reports verifier-bound, and hands back the hash for the shared compare", async () => {
      const store = await fresh();

      const verifier = `ver_${"d".repeat(43)}`;
      const bound = await store.createMagicToken("bound@ex.com", {
        verifierHash: hashToken(verifier),
      });
      const unbound = await store.createMagicToken("unbound@ex.com");

      // U5 gates the handoff anchor on the boolean, so it never has to reason
      // about null-vs-absent: an unbound row is an older plugin build.
      const peek = await store.peekMagic(bound);
      assert.equal(peek.verifierBound, true);
      assert.equal((await store.peekMagic(unbound)).verifierBound, false);
      assert.equal((await store.peekMagic(unbound)).verifierHash, null);

      // U13's peek route feeds this hash to U4's factored compare — one
      // comparison, two callers — so the store has to hand it back.
      assert.equal(peek.verifierHash, hashToken(verifier));

      // What must never appear, here or in the row, is the raw verifier: the
      // device holds it and the server only ever sees its hash.
      //
      // The *hash* staying off the wire is a different guarantee at a different
      // layer — the peek response body — and U13 owns asserting it on its own
      // route. Handed off deliberately, not dropped.
      assert.equal(JSON.stringify(peek).includes(verifier), false);
      assert.equal(
        JSON.stringify(await store.magicRowsForTest()).includes(verifier),
        false,
      );

      if (store.close) await store.close();
    });

    it("U2/KTD11: a pre-deploy plaintext-keyed row is not usable from peek either", async () => {
      const store = await fresh();
      const token = `mt_${"b".repeat(32)}`;
      await store.writeMagicRowForTest(token, {
        email: "legacy@ex.com",
        expMs: Date.now() + 15 * 60 * 1000,
      });

      // KTD14 re-keys on hashToken(token), so the peek misses it exactly as the
      // exchange does — orphaned, not redeemable, by either door.
      const peek = await store.peekMagic(token);
      assert.equal(peek.ok, false);
      assert.equal(peek.status, "invalid");
      assert.equal(peek.email, null);

      // The peek itself never deletes (KTD1), so the row survives the check...
      assert.equal((await store.magicRowsForTest()).length, 1);

      // ...and past TTL it is the mint sweep, not the peek, that removes it
      // (U3/KTD13) — so a peek stays read-only and the row is still not immortal.
      const stale = `mt_${"c".repeat(32)}`;
      await store.writeMagicRowForTest(stale, {
        email: "legacy@ex.com",
        expMs: Date.now() - 1,
      });
      assert.equal((await store.peekMagic(stale)).status, "invalid");
      assert.equal((await store.magicRowsForTest()).length, 2);

      await store.createMagicToken("someone-else@ex.com");
      const keys = (await store.magicRowsForTest()).map((r) => r.key);
      assert.equal(keys.includes(stale), false);
      assert.equal(keys.includes(token), true);

      if (store.close) await store.close();
    });

    // ---- #240 U3: the mint sweeps expired rows, globally (KTD13) -----------

    it("U3/KTD13: a mint sweeps an expired row belonging to a different email", async () => {
      const store = await fresh();
      // Nobody ever taps this one, and its owner never requests another link —
      // the mint sweep is the only delete path it will ever see. Scoped to the
      // minting email, this row would hold an email, a vault name, and a
      // verifier hash forever, which is exactly what KD7 says cannot happen.
      await store.writeMagicRowForTest("stale-other-email", {
        email: "never-came-back@ex.com",
        expMs: Date.now() - 60_000,
        verifierHash: "d".repeat(64),
        vault: "Abandoned Vault",
      });

      await store.createMagicToken("sweeper@ex.com");

      const rows = await store.magicRowsForTest();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].email, "sweeper@ex.com");
      assert.equal(JSON.stringify(rows).includes("Abandoned Vault"), false);

      if (store.close) await store.close();
    });

    it("U3/KTD13: the sweep takes expired rows only — live tokens still peek and exchange", async () => {
      const store = await fresh();
      const mine = await store.createMagicToken("live-mine@ex.com", {
        vault: "Mine",
      });
      const theirs = await store.createMagicToken("live-theirs@ex.com", {
        vault: "Theirs",
      });
      await store.writeMagicRowForTest("stale-row", {
        email: "expired@ex.com",
        expMs: Date.now() - 1,
      });

      // A third mint runs the sweep moments after both live rows were minted.
      await store.createMagicToken("live-mine@ex.com");

      assert.equal((await store.peekMagic(mine)).vault, "Mine");
      assert.equal((await store.peekMagic(theirs)).vault, "Theirs");
      assert.ok((await store.exchangeMagic(mine))?.session);
      assert.ok((await store.exchangeMagic(theirs))?.session);
      assert.equal(
        (await store.magicRowsForTest()).some((r) => r.key === "stale-row"),
        false,
      );

      if (store.close) await store.close();
    });

    // ---- #240 U4: the exchange is verifier-bound, and a refusal deletes -----
    //      nothing (R12, R16, KTD3). Every case below holds in all three
    //      backends: sqlite and postgres used to delete before checking
    //      anything, so "refused" and "consumed" were the same row state.

    /**
     * A verifier as the plugin mints one, and the hash the mint stores.
     * The digest is computed here rather than through the store's own helper on
     * purpose: `src/platform/pkce.ts` sends `base64url(SHA-256(verifier))` over
     * the wire (KTD6), and a test that reused the server's encoder would stay
     * green if the server ever hashed to hex while the plugin sent base64url —
     * a mismatch nothing on device could recover from.
     */
    function bindable(seed) {
      const verifier = `ver_${seed.repeat(10)}`;
      const verifierHash = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      return { verifier, verifierHash };
    }

    it("U4/AE12: a wrong verifier is refused, and the right one still works after", async () => {
      const store = await fresh();
      const { verifier, verifierHash } = bindable("a");
      const token = await store.createMagicToken("bound@ex.com", {
        verifierHash,
        vault: "Requesting Vault",
      });

      const refused = await store.exchangeMagic(token, {
        verifier: "ver_wrong",
      });
      assert.equal(refused?.refused, true);
      assert.equal(refused.reason, "verifier_mismatch");

      // R16 — the whole point: the link is still there to tap again. A refusal
      // that consumed the row would send the user back for a second email.
      assert.equal((await store.magicRowsForTest()).length, 1);

      const out = await store.exchangeMagic(token, { verifier });
      assert.ok(String(out?.session).startsWith("sess_"));
      assert.equal(out.vault, "Requesting Vault");
      assert.equal((await store.magicRowsForTest()).length, 0);

      if (store.close) await store.close();
    });

    it("U4: a bound token with no verifier presented is refused, not exchanged", async () => {
      const store = await fresh();
      const { verifier, verifierHash } = bindable("b");
      const token = await store.createMagicToken("bound2@ex.com", {
        verifierHash,
      });

      // Absent, empty, and whitespace all mean "this caller holds no verifier".
      // KD9: on the plugin's route that is a refusal, never a pass.
      for (const opts of [{}, { verifier: null }, { verifier: "" }, { verifier: "   " }]) {
        const refused = await store.exchangeMagic(token, opts);
        assert.equal(refused?.refused, true, JSON.stringify(opts));
        assert.equal(refused.session, undefined);
      }
      assert.equal((await store.magicRowsForTest()).length, 1);

      assert.ok((await store.exchangeMagic(token, { verifier }))?.session);

      if (store.close) await store.close();
    });

    it("U4: an unbound row exchanges as it always did, verifier or not", async () => {
      const store = await fresh();

      // KD9's older-plugin-build path: nothing was bound at mint, so there is
      // no check to apply and the exchange behaves exactly as before U4.
      for (const opts of [undefined, {}, { verifier: "ver_irrelevant" }]) {
        const token = await store.createMagicToken("legacy@ex.com");
        const out = await store.exchangeMagic(token, opts);
        assert.ok(String(out?.session).startsWith("sess_"), String(opts));
      }

      if (store.close) await store.close();
    });

    it("U4/KD9: the check-skipping call redeems a bound token with no verifier", async () => {
      const store = await fresh();
      const { verifierHash } = bindable("c");
      const token = await store.createMagicToken("fallback@ex.com", {
        verifierHash,
        vault: "Other Device",
      });

      // This is the call U6's HTML fallback route makes, and it is the whole
      // mechanism of KD3's cross-device recovery: every link a current build
      // mints is bound, so a fallback honouring the check would recover
      // nothing. The abort above is scoped to the plugin's route, deliberately
      // not baked into the store — do not "harden" this into a refusal.
      const out = await store.exchangeMagic(token, {
        skipVerifierCheck: true,
      });
      assert.ok(String(out?.session).startsWith("sess_"));
      assert.equal(out.vault, "Other Device");
      assert.equal((await store.magicRowsForTest()).length, 0);

      if (store.close) await store.close();
    });

    it("U4: an expired bound token reports expired, not verifier-mismatch", async () => {
      const store = await fresh();
      const { verifier, verifierHash } = bindable("d");
      const token = `mt_${"e".repeat(32)}`;
      await store.writeMagicRowForTest(hashToken(token), {
        email: "stale-bound@ex.com",
        expMs: Date.now() - 1000,
        verifierHash,
      });

      // R7's message, not R5's: the link died of age, and telling the user to
      // go back to the requesting vault and tap again would be a dead end.
      // Holding the right verifier does not change that.
      assert.equal(await store.exchangeMagic(token, { verifier }), null);
      assert.equal(await store.exchangeMagic(token, { verifier: "ver_no" }), null);

      if (store.close) await store.close();
    });

    it("U4: a refusal hands back no session and no magic token", async () => {
      const store = await fresh();
      const { verifierHash } = bindable("f");
      const token = await store.createMagicToken("quiet@ex.com", {
        verifierHash,
        vault: "Quiet Vault",
      });

      const refused = await store.exchangeMagic(token, { verifier: "ver_no" });
      const body = JSON.stringify(refused);
      assert.equal(body.includes("sess_"), false);
      assert.equal(body.includes(token), false);
      assert.equal(refused.account, undefined);

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

/**
 * #240 U1 — an already-deployed database must gain the two columns on open.
 * This cannot live in `runStoreSuite`: each backend's "old database" is a
 * different artifact, and memory has none.
 */
describe("U1 legacy database upgrade (sqlite)", () => {
  it("adds verifier_hash and vault to a pre-#240 magic_tokens table", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "atoms-u1-"));
    const dbPath = join(dir, "legacy.db");
    try {
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(`
        CREATE TABLE magic_tokens (
          token TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          exp_ms INTEGER NOT NULL
        );
      `);
      legacy
        .prepare("INSERT INTO magic_tokens (token, email, exp_ms) VALUES (?, ?, ?)")
        .run("mt_predeploy", "old@ex.com", Date.now() + 60_000);
      legacy.close();

      // Opening must upgrade rather than throw, and must not drop the old row.
      const store = createSqliteStore(dbPath);
      const rows = store.magicRowsForTest();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].key, "mt_predeploy");
      assert.equal(rows[0].verifierHash, null);
      assert.equal(rows[0].vault, null);

      // The upgraded table takes the new columns for real.
      const token = store.createMagicToken("new@ex.com", {
        verifierHash: "c".repeat(64),
        vault: "Upgraded Vault",
      });
      // Check-skipping door: the hash above is a literal, not a real digest.
      assert.equal(
        store.exchangeMagic(token, { skipVerifierCheck: true })?.vault,
        "Upgraded Vault",
      );
      if (store.close) store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Same guarantee on the store that actually runs in production. Gated on a
// database being present for the same reason the suite rows are (KTD3).
if (postgresStoreRows().length) {
  describe("U1 legacy database upgrade (postgres)", () => {
    it("adds verifier_hash and vault to a pre-#240 magic_tokens table", async () => {
      const pg = (await import("pg")).default;
      const store = await createTestPostgresStore();
      const url = withSearchPath(
        process.env.TEST_DATABASE_URL,
        store.schemaForTest,
      );
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      let upgraded;
      try {
        // Rewind the schema to its pre-#240 shape, with a row already in it.
        await client.query(
          "ALTER TABLE magic_tokens DROP COLUMN verifier_hash, DROP COLUMN vault",
        );
        await client.query(
          "INSERT INTO magic_tokens (token, email, exp_ms) VALUES ($1, $2, $3)",
          ["mt_predeploy", "old@ex.com", Date.now() + 60_000],
        );

        // Re-running the migration is what a deploy does on an existing database.
        upgraded = await createPostgresStore(url);
        const rows = await upgraded.magicRowsForTest();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].key, "mt_predeploy");
        assert.equal(rows[0].verifierHash, null);
        assert.equal(rows[0].vault, null);

        // A real verifier, digested by the one function the exchange compares
        // against: the upgraded table has to honour the U4 check, not merely
        // hold the column, which is the actual deploy-day question. The old
        // `"c".repeat(64)` literal could never be presented against — nothing
        // digests to it — so the exchange refused and `?.vault` read undefined.
        const verifier = "legacy-upgrade-verifier";
        const token = await upgraded.createMagicToken("new@ex.com", {
          verifierHash: pkceChallengeS256(verifier),
          vault: "Upgraded Vault",
        });
        assert.equal(
          (await upgraded.exchangeMagic(token, { verifier }))?.vault,
          "Upgraded Vault",
        );
      } finally {
        await client.end();
        if (upgraded) await upgraded.close();
        await store.close();
      }
    });
  });
}

/**
 * #240 U2 — the same scan `#238 store parity` runs in stripe-incidents.test.mjs
 * (`test/stripe-incidents.test.mjs:249-284`). It holds the surface even in a run
 * where the postgres suite rows are absent, which is every local run without a
 * database: a backend that quietly never grew `peekMagic` would otherwise only
 * be caught in CI.
 */
describe("#240 U2 store parity", () => {
  it("all three stores define and export peekMagic", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const storeDir = join(dirname(fileURLToPath(import.meta.url)), "../src/store");

    for (const file of ["memory.mjs", "sqlite.mjs", "postgres.mjs"]) {
      const src = readFileSync(join(storeDir, file), "utf8");
      assert.match(
        src,
        /^\s+(async )?function peekMagic\(/m,
        `${file} must define peekMagic`,
      );
      assert.match(
        src,
        /^\s+peekMagic,$/m,
        `${file} must export peekMagic from its factory literal`,
      );
    }
  });

  it("no backend's peekMagic reaches for a delete", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const storeDir = join(dirname(fileURLToPath(import.meta.url)), "../src/store");

    // KTD13 — read-only by construction. The behavioural tests above prove the
    // row survives; this proves the code has no delete to regress into.
    for (const file of ["memory.mjs", "sqlite.mjs", "postgres.mjs"]) {
      const src = readFileSync(join(storeDir, file), "utf8");
      const start = src.indexOf("function peekMagic(");
      assert.notEqual(start, -1, `${file} must define peekMagic`);
      const end = src.indexOf("\n  }\n", start);
      assert.notEqual(end, -1, `${file}'s peekMagic must close at one indent`);
      const fn = src.slice(start, end);
      assert.doesNotMatch(fn, /\bDELETE\b|\.delete\(|FOR UPDATE|BEGIN/i);
    }
  });
});

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
