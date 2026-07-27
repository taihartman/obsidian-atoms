import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { OUTBOX_MAX_OPEN, OUTBOX_STALE_MS } from "../src/store/askHelpers.mjs";

async function withStore(mode, fn) {
  const opts =
    mode === "sqlite"
      ? { mode: "sqlite", path: ":memory:" }
      : { mode: "memory" };
  const store = await createStore(opts);
  try {
    await fn(store);
  } finally {
    if (store.close) store.close();
  }
}

function seed(store, email) {
  return store.grantPeriod(email, {
    remaining: 150,
    status: "active",
    plan: "monthly",
  });
}

describe("ask outbox store", () => {
  for (const mode of ["memory", "sqlite"]) {
    describe(mode, () => {
      it("enqueue pull claim ack applied", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "o@ex.co");
          const enq = await store.outboxEnqueue("o@ex.co", {
            kind: "create",
            payload: { title: "Hello", body: "world body" },
          });
          assert.equal(enq.ok, true);
          assert.equal(enq.status, "pending");
          assert.ok(enq.id.startsWith("obx_"));
          assert.equal(enq.payload.body, "world body");

          const pull1 = await store.outboxPull("o@ex.co", { limit: 1 });
          assert.equal(pull1.items.length, 1);
          assert.equal(pull1.items[0].status, "claimed");
          assert.equal(pull1.items[0].payload.title, "Hello");

          const pull2 = await store.outboxPull("o@ex.co", { limit: 1 });
          assert.equal(pull2.items.length, 0);

          const ack = await store.outboxAck("o@ex.co", {
            id: enq.id,
            status: "applied",
          });
          assert.equal(ack.ok, true);
          assert.equal(ack.status, "applied");

          const pull3 = await store.outboxPull("o@ex.co", { limit: 1 });
          assert.equal(pull3.items.length, 0);
        });
      });

      it("ack rejected persists error", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "r@ex.co");
          const enq = await store.outboxEnqueue("r@ex.co", {
            kind: "create",
            payload: { title: "T", body: "b" },
          });
          await store.outboxPull("r@ex.co");
          const ack = await store.outboxAck("r@ex.co", {
            id: enq.id,
            status: "rejected",
            error: "path_exists",
          });
          assert.equal(ack.status, "rejected");
          assert.equal(ack.error, "path_exists");
          const got = await store.outboxGet("r@ex.co", enq.id);
          assert.equal(got.status, "rejected");
        });
      });

      it("stale claim returns to pending", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "s@ex.co");
          const enq = await store.outboxEnqueue("s@ex.co", {
            kind: "create",
            payload: { title: "Stale", body: "x" },
          });
          await store.outboxPull("s@ex.co");
          const aged = await store.outboxGet("s@ex.co", enq.id);
          assert.equal(aged.status, "claimed");
          await store._forceOutboxClaimedAt(
            "s@ex.co",
            enq.id,
            new Date(Date.now() - OUTBOX_STALE_MS - 1000).toISOString(),
          );
          const pull = await store.outboxPull("s@ex.co");
          assert.equal(pull.items.length, 1);
          assert.equal(pull.items[0].id, enq.id);
        });
      });

      it("client_request_id idempotent", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "i@ex.co");
          const a = await store.outboxEnqueue("i@ex.co", {
            kind: "create",
            payload: { title: "A", body: "b" },
            client_request_id: "req-1",
          });
          const b = await store.outboxEnqueue("i@ex.co", {
            kind: "create",
            payload: { title: "B", body: "c" },
            client_request_id: "req-1",
          });
          assert.equal(a.id, b.id);
          assert.equal(b.duplicate, true);
          assert.equal(b.payload.title, "A");
        });
      });

      it("cap 50 open", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "c@ex.co");
          for (let i = 0; i < OUTBOX_MAX_OPEN; i++) {
            const r = await store.outboxEnqueue("c@ex.co", {
              kind: "create",
              payload: { title: `T${i}`, body: `b${i}` },
            });
            assert.equal(r.ok, true);
          }
          const full = await store.outboxEnqueue("c@ex.co", {
            kind: "create",
            payload: { title: "Overflow", body: "nope" },
          });
          assert.equal(full.ok, false);
          assert.equal(full.error, "outbox_full");
        });
      });

      it("wipe clears all outbox statuses", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "w@ex.co");
          const p = await store.outboxEnqueue("w@ex.co", {
            kind: "create",
            payload: { title: "P", body: "1" },
          });
          const c = await store.outboxEnqueue("w@ex.co", {
            kind: "create",
            payload: { title: "C", body: "2" },
          });
          const pull = await store.outboxPull("w@ex.co", { limit: 1 });
          await store.outboxAck("w@ex.co", {
            id: pull.items[0].id,
            status: "applied",
          });
          await store.outboxPull("w@ex.co", { limit: 1 });
          await store.outboxAck("w@ex.co", {
            id: c.id === pull.items[0].id ? p.id : c.id,
            status: "rejected",
            error: "x",
          });
          await store.mirrorWipe("w@ex.co");
          assert.equal(await store.outboxGet("w@ex.co", p.id), null);
          assert.equal(await store.outboxGet("w@ex.co", c.id), null);
          assert.equal(await store.outboxPendingCount("w@ex.co"), 0);
        });
      });

      it("cross-tenant cannot get or ack", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "a@ex.co");
          await seed(store, "b@ex.co");
          const enq = await store.outboxEnqueue("a@ex.co", {
            kind: "create",
            payload: { title: "Secret", body: "only a" },
          });
          assert.equal(await store.outboxGet("b@ex.co", enq.id), null);
          const ack = await store.outboxAck("b@ex.co", {
            id: enq.id,
            status: "applied",
          });
          assert.equal(ack.ok, false);
          assert.equal(ack.error, "not_found");
          const still = await store.outboxGet("a@ex.co", enq.id);
          assert.equal(still.status, "pending");
        });
      });
    });
  }
});
