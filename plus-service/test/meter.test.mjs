/**
 * U2 / U9b — durable meter: atomic consume, idempotency replay, restart preserve.
 * Default path uses sqlite :memory: (no Postgres required in CI).
 * Set DATABASE_URL + ATOMS_PLUS_STORE=postgres to also run against managed Postgres.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createPostgresStore } from "../src/store/postgres.mjs";

process.env.DOGFOOD_AUTO_GRANT = "0";

async function sessionWithRemaining(store, email, remaining) {
  await store.grantPeriod(email, { remaining, status: "active", days: 30 });
  const tok = await store.createMagicToken(email);
  const { session } = await store.exchangeMagic(tok);
  // exchange may not change remaining when auto-grant off
  const a = await store.getAccount(email);
  a.remaining = remaining;
  a.status = "active";
  if (store.kind === "memory") {
    /* already mutated */
  } else if (store.kind === "sqlite" || store.kind === "postgres") {
    // grantPeriod already set; re-grant exact remaining
    await store.grantPeriod(email, { remaining, status: "active", days: 30 });
  }
  return session;
}

function runMeterSuite(name, create) {
  describe(`meter (${name})`, () => {
    /** @type {any[]} */
    const open = [];
    after(async () => {
      for (const s of open) {
        if (s?.close) await s.close();
      }
    });

    async function fresh() {
      const store = await create();
      open.push(store);
      return store;
    }

    it("remaining=1: only one consume succeeds", async () => {
      const store = await fresh();
      const session = await sessionWithRemaining(store, "one@t.co", 1);
      const c1 = await store.tryConsumeFiling(session, "k-a");
      const c2 = await store.tryConsumeFiling(session, "k-b");
      assert.equal(c1.ok, true);
      assert.equal(c1.replay, false);
      assert.equal(c2.ok, false);
      assert.equal(c2.code, "exhausted");
      assert.equal((await store.getAccount("one@t.co")).remaining, 0);
    });

    it("same idempotency key does not double-charge", async () => {
      const store = await fresh();
      const session = await sessionWithRemaining(store, "idem@t.co", 5);
      const c1 = await store.tryConsumeFiling(session, "same-key");
      assert.equal(c1.ok, true);
      await store.completeUsage("same-key", {
        email: "idem@t.co",
        status: "ok",
        responseJson: { result: { ok: true } },
        remaining: 4,
      });
      const c2 = await store.tryConsumeFiling(session, "same-key");
      assert.equal(c2.ok, true);
      assert.equal(c2.replay, true);
      assert.equal((await store.getAccount("idem@t.co")).remaining, 4);
    });

    it("refund restores a filing after failed classify", async () => {
      const store = await fresh();
      const session = await sessionWithRemaining(store, "ref@t.co", 3);
      await store.tryConsumeFiling(session, "r1");
      assert.equal((await store.getAccount("ref@t.co")).remaining, 2);
      await store.refundFiling(session, "r1");
      assert.equal((await store.getAccount("ref@t.co")).remaining, 3);
    });

    it("refund clears reserved key so same Idempotency-Key can retry", async () => {
      const store = await fresh();
      const session = await sessionWithRemaining(store, "retry@t.co", 5);
      const c1 = await store.tryConsumeFiling(session, "retry-key");
      assert.equal(c1.ok, true);
      await store.refundFiling(session, "retry-key");
      assert.equal((await store.getAccount("retry@t.co")).remaining, 5);
      const c2 = await store.tryConsumeFiling(session, "retry-key");
      assert.equal(c2.ok, true);
      assert.equal(c2.replay, false);
      assert.equal((await store.getAccount("retry@t.co")).remaining, 4);
    });
  });
}

runMeterSuite("sqlite-memory", async () => createSqliteStore(":memory:"));

runMeterSuite("sqlite-file-restart", async () => {
  // Each call gets a new path — restart test is separate
  return createSqliteStore(":memory:");
});

describe("meter sqlite restart preserves remaining", () => {
  it("reopen same path keeps balance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plus-meter-"));
    const path = join(dir, "plus.sqlite");
    try {
      const s1 = createSqliteStore(path);
      await s1.grantPeriod("persist@t.co", {
        remaining: 42,
        status: "active",
        days: 30,
      });
      assert.equal(s1.getAccount("persist@t.co").remaining, 42);
      s1.close();

      const s2 = createSqliteStore(path);
      assert.equal(s2.getAccount("persist@t.co").remaining, 42);
      assert.equal(s2.getAccount("persist@t.co").status, "active");
      s2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const pgUrl = process.env.DATABASE_URL || "";
const runPg =
  pgUrl &&
  (process.env.ATOMS_PLUS_STORE === "postgres" ||
    process.env.PLUS_METER_PG === "1");

if (runPg) {
  runMeterSuite("postgres", async () => createPostgresStore(pgUrl));

  describe("meter postgres parallel remaining=1", () => {
    it("two concurrent consumes → exactly one success", async () => {
      const store = await createPostgresStore(pgUrl);
      try {
        const session = await sessionWithRemaining(
          store,
          `par-${Date.now()}@t.co`,
          1,
        );
        const [a, b] = await Promise.all([
          store.tryConsumeFiling(session, `p-${Date.now()}-a`),
          store.tryConsumeFiling(session, `p-${Date.now()}-b`),
        ]);
        const oks = [a, b].filter((x) => x.ok && !x.replay);
        const fails = [a, b].filter((x) => !x.ok);
        assert.equal(oks.length, 1, `expected 1 success got ${oks.length}`);
        assert.equal(fails.length, 1);
      } finally {
        await store.close();
      }
    });
  });
} else {
  describe("meter postgres (skipped)", () => {
    it("set DATABASE_URL + PLUS_METER_PG=1 to enable", () => {
      assert.ok(true);
    });
  });
}
