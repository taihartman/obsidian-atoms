/**
 * #238 U1 — `stripe_incidents` store surface.
 *
 * KTD2: one row per (kind, UTC day, stripeId) with an occurrence counter.
 * `POST /v1/billing/webhook` has no rate limit and the class-A reject path needs
 * only a malformed signature header, so a row-per-request would let an anonymous
 * caller flood production Postgres. Class A has no parseable Stripe id → empty
 * string → one row per kind per day.
 * KTD7: incidents carry kind, Stripe id, email and a short detail only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createStore } from "../src/store.mjs";
import { postgresStoreRows } from "./helpers/postgresTestStore.mjs";

process.env.DOGFOOD_AUTO_GRANT = "0";
process.env.ATOMS_PLUS_ENV = "development";

const DAY_MS = 24 * 60 * 60 * 1000;

function runStoreSuite(name, create) {
  describe(`stripe incidents (${name})`, () => {
    it("records a first incident with occurrences 1", async () => {
      const store = await create();
      const row = await store.recordStripeIncident("webhook_reject", {
        stripeId: "",
        email: null,
        detail: "signature verification failed",
      });
      assert.ok(row.id);
      assert.equal(row.kind, "webhook_reject");
      assert.equal(row.stripeId, "");
      assert.equal(row.occurrences, 1);
      assert.equal(row.alertedAt, null);
      assert.equal(row.firstSeenAt, row.lastSeenAt);
      assert.equal(row.detail, "signature verification failed");

      if (store.close) await store.close();
    });

    it("collapses the same (kind, stripeId) in one day into one row", async () => {
      const store = await create();
      const t0 = Date.UTC(2026, 7, 4, 10, 0, 0);
      const first = await store.recordStripeIncident("missing_email", {
        stripeId: "cs_1",
        email: "a@ex.com",
        detail: "no email on session",
        now: t0,
      });
      const second = await store.recordStripeIncident("missing_email", {
        stripeId: "cs_1",
        email: "a@ex.com",
        detail: "no email on session",
        now: t0 + 5000,
      });

      assert.equal(second.id, first.id);
      assert.equal(second.occurrences, 2);
      assert.equal(second.firstSeenAt, first.firstSeenAt);
      assert.ok(
        Date.parse(second.lastSeenAt) > Date.parse(first.lastSeenAt),
        "last_seen_at must advance",
      );

      const all = await store.listStripeIncidents({ since: t0 - DAY_MS });
      assert.equal(all.length, 1);
      assert.equal(all[0].occurrences, 2);

      if (store.close) await store.close();
    });

    it("class-A flood: 50 anonymous rejects collapse to one row", async () => {
      const store = await create();
      const t0 = Date.UTC(2026, 7, 4, 0, 0, 0);
      for (let i = 0; i < 50; i += 1) {
        await store.recordStripeIncident("webhook_reject", {
          stripeId: "",
          detail: "bad signature",
          now: t0 + i,
        });
      }
      const rows = await store.listStripeIncidents({ since: t0 - DAY_MS });
      assert.equal(rows.length, 1, "one row per kind per day, not 50");
      assert.equal(rows[0].occurrences, 50);

      if (store.close) await store.close();
    });

    it("keeps distinct stripe ids of the same kind as distinct rows", async () => {
      const store = await create();
      const t0 = Date.UTC(2026, 7, 4, 12, 0, 0);
      await store.recordStripeIncident("email_mismatch", {
        stripeId: "cs_a",
        now: t0,
      });
      await store.recordStripeIncident("email_mismatch", {
        stripeId: "cs_b",
        now: t0 + 1,
      });
      const rows = await store.listStripeIncidents({ since: t0 - DAY_MS });
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((r) => r.stripeId).sort(),
        ["cs_a", "cs_b"],
      );
      assert.ok(rows.every((r) => r.occurrences === 1));

      if (store.close) await store.close();
    });

    it("buckets the same stripe id on a later UTC day into a new row", async () => {
      const store = await create();
      const t0 = Date.UTC(2026, 7, 4, 23, 59, 0);
      const day1 = await store.recordStripeIncident("unknown_price", {
        stripeId: "cs_x",
        now: t0,
      });
      const day2 = await store.recordStripeIncident("unknown_price", {
        stripeId: "cs_x",
        now: t0 + DAY_MS,
      });
      assert.notEqual(day2.id, day1.id);
      assert.equal(day2.occurrences, 1);

      if (store.close) await store.close();
    });

    it("lastStripeAlertAt gates on the alert window", async () => {
      const store = await create();
      const t0 = Date.UTC(2026, 7, 4, 8, 0, 0);
      const row = await store.recordStripeIncident("webhook_reject", {
        stripeId: "",
        now: t0,
      });

      assert.equal(await store.lastStripeAlertAt("webhook_reject", 0), null);

      const stamped = await store.markStripeIncidentAlerted(row.id, {
        now: t0 + 1000,
      });
      assert.ok(stamped.alertedAt);

      assert.equal(
        await store.lastStripeAlertAt("webhook_reject", t0),
        t0 + 1000,
      );
      // Outside the window → the throttle must let the next alert through.
      assert.equal(
        await store.lastStripeAlertAt("webhook_reject", t0 + 5000),
        null,
      );
      // A different kind throttles independently.
      assert.equal(await store.lastStripeAlertAt("missing_email", t0), null);

      if (store.close) await store.close();
    });

    it("listStripeIncidents honours kind, since and limit, newest first", async () => {
      const store = await create();
      const t0 = Date.UTC(2026, 7, 1, 0, 0, 0);
      await store.recordStripeIncident("missing_email", {
        stripeId: "cs_old",
        now: t0,
      });
      await store.recordStripeIncident("missing_email", {
        stripeId: "cs_mid",
        now: t0 + DAY_MS,
      });
      await store.recordStripeIncident("missing_email", {
        stripeId: "cs_new",
        now: t0 + 2 * DAY_MS,
      });
      await store.recordStripeIncident("webhook_reject", {
        stripeId: "",
        now: t0 + 2 * DAY_MS,
      });

      const all = await store.listStripeIncidents({ since: t0 - DAY_MS });
      assert.equal(all.length, 4);
      assert.deepEqual(
        all.map((r) => r.stripeId).sort(),
        ["", "cs_mid", "cs_new", "cs_old"],
      );
      // Newest first, regardless of kind.
      const seen = all.map((r) => Date.parse(r.lastSeenAt));
      assert.deepEqual(seen, [...seen].sort((a, b) => b - a));

      const byKind = await store.listStripeIncidents({
        kind: "missing_email",
        since: t0 - DAY_MS,
      });
      assert.deepEqual(
        byKind.map((r) => r.stripeId),
        ["cs_new", "cs_mid", "cs_old"],
      );

      const recent = await store.listStripeIncidents({
        kind: "missing_email",
        since: t0 + DAY_MS,
      });
      assert.deepEqual(
        recent.map((r) => r.stripeId),
        ["cs_new", "cs_mid"],
      );

      const capped = await store.listStripeIncidents({
        kind: "missing_email",
        since: t0 - DAY_MS,
        limit: 2,
      });
      assert.deepEqual(
        capped.map((r) => r.stripeId),
        ["cs_new", "cs_mid"],
      );

      if (store.close) await store.close();
    });

    it("exposes the whole incident surface", async () => {
      const store = await create();
      for (const m of [
        "recordStripeIncident",
        "lastStripeAlertAt",
        "markStripeIncidentAlerted",
        "listStripeIncidents",
      ]) {
        assert.equal(typeof store[m], "function", `${name} must define ${m}`);
      }
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
 * The source scan below predates #239, when nothing here executed postgres at
 * all. The rows above now do — but only where a database exists, and this file
 * is also read by contributors with no local postgres. Keep the scan: it holds
 * the surface even in the run where the postgres rows are absent.
 */
describe("#238 store parity", () => {
  it("all three stores define and export the incident methods", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const storeDir = join(dirname(fileURLToPath(import.meta.url)), "../src/store");

    for (const file of ["memory.mjs", "sqlite.mjs", "postgres.mjs"]) {
      const src = readFileSync(join(storeDir, file), "utf8");
      for (const method of [
        "recordStripeIncident",
        "lastStripeAlertAt",
        "markStripeIncidentAlerted",
        "listStripeIncidents",
      ]) {
        assert.match(
          src,
          new RegExp(`^\\s+(async )?${method}\\(`, "m"),
          `${file} must define ${method} on the returned store`,
        );
      }
    }
  });

  it("both SQL dialects migrate the incidents table with the KTD2 unique key", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const storeDir = join(dirname(fileURLToPath(import.meta.url)), "../src/store");

    for (const file of ["sqlite.mjs", "postgres.mjs"]) {
      const src = readFileSync(join(storeDir, file), "utf8");
      assert.match(src, /CREATE TABLE IF NOT EXISTS stripe_incidents/);
      assert.match(src, /UNIQUE \(kind, day_bucket, stripe_id\)/);
    }
  });
});
