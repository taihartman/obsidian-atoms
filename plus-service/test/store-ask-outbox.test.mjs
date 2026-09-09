import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";
import { OUTBOX_MAX_OPEN, OUTBOX_STALE_MS } from "../src/store/askHelpers.mjs";

function seed(store, email) {
  return store.grantPeriod(email, {
    remaining: 150,
    status: "active",
    plan: "monthly",
  });
}

describe("ask outbox store", () => {
  for (const mode of askStoreModes()) {
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

      it("atomically converges concurrent G2 commits on one outbox item", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "concurrent-g2@ex.co");
          const enqueue = () => store.outboxEnqueue("concurrent-g2@ex.co", {
            kind: "create",
            payload: {
              title: "One capture",
              body: "sacred record\n",
              origin: "g2",
              proposal_fingerprint: "fp-same",
            },
            client_request_id: "g2-commit-key",
            proposal_fingerprint: "fp-same",
          });
          const [first, second] = await Promise.all([enqueue(), enqueue()]);
          assert.equal(first.ok, true);
          assert.equal(second.ok, true);
          assert.equal(first.id, second.id);
          assert.equal(Number(first.duplicate) + Number(second.duplicate), 1);

          const changed = await store.outboxEnqueue("concurrent-g2@ex.co", {
            kind: "create",
            payload: {
              title: "Changed capture",
              body: "different record\n",
              origin: "g2",
              proposal_fingerprint: "fp-changed",
            },
            client_request_id: "g2-commit-key",
            proposal_fingerprint: "fp-changed",
          });
          assert.deepEqual(changed, {
            ok: false,
            error: "idempotency_conflict",
          });
          assert.equal(
            (await store.outboxPull("concurrent-g2@ex.co", { limit: 10 }))
              .items.length,
            1,
          );
        });
      });

      it("mints a G2 saved receipt only from the matching mirrored target", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "receipt@ex.co");
          const body = "exact G2 record\n";
          const hash = "6f039b24b715fb27e0a4ca9353092625d705978d5d80ccccd72478e0ce414b65";
          const enq = await store.outboxEnqueue("receipt@ex.co", {
            kind: "create",
            payload: { title: "Receipt target", body, origin: "g2", captured_record_sha256: hash },
            client_request_id: "receipt-key",
            proposal_fingerprint: "fp-one",
          });
          await store.outboxPull("receipt@ex.co");
          const before = await store.outboxAck("receipt@ex.co", { id: enq.id, status: "applied" });
          assert.equal(before.ok, false);
          assert.equal(before.error, "mirror_receipt_required");
          await store.mirrorUpsert("receipt@ex.co", [{
            path: "Memory Shelf/Receipt target.md", title: "Receipt target", body,
          }]);
          const ack = await store.outboxAck("receipt@ex.co", {
            id: enq.id, status: "applied", target_path: "Memory Shelf/Receipt target.md",
          });
          assert.equal(ack.status, "applied");
          assert.equal(ack.receipt.path, "Memory Shelf/Receipt target.md");
          assert.equal(ack.receipt.captured_record_sha256, hash);
          assert.deepEqual((await store.outboxGet("receipt@ex.co", enq.id)).receipt, ack.receipt);
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

      it("cancel pending outbox", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "z@ex.co");
          const enq = await store.outboxEnqueue("z@ex.co", {
            kind: "create",
            payload: { title: "Oops", body: "typo" },
          });
          const c = await store.outboxCancel("z@ex.co", enq.id);
          assert.equal(c.ok, true);
          assert.equal(c.status, "rejected");
          assert.equal(c.error, "cancelled");
          const pull = await store.outboxPull("z@ex.co");
          assert.equal(pull.items.length, 0);
        });
      });

      it("outboxHasOpenTitle for pending parent", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "p@ex.co");
          assert.equal(
            await store.outboxHasOpenTitle("p@ex.co", "Parent"),
            false,
          );
          await store.outboxEnqueue("p@ex.co", {
            kind: "create",
            payload: { title: "Parent", body: "first" },
          });
          assert.equal(
            await store.outboxHasOpenTitle("p@ex.co", "Parent"),
            true,
          );
          assert.equal(
            await store.outboxHasOpenTitle("p@ex.co", "Other"),
            false,
          );
        });
      });

      it("mirrorList paginates", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "l@ex.co");
          const atoms = [];
          for (let i = 0; i < 5; i++) {
            atoms.push({
              path: `Atoms/N${i}.md`,
              title: `Note ${i}`,
              body: `body ${i}`,
            });
          }
          await store.mirrorUpsert("l@ex.co", atoms);
          const p1 = await store.mirrorList("l@ex.co", {
            limit: 2,
            offset: 0,
          });
          assert.equal(p1.items.length, 2);
          assert.equal(p1.total, 5);
          assert.equal(p1.next_offset, 2);
          const p2 = await store.mirrorList("l@ex.co", {
            limit: 2,
            offset: 2,
          });
          assert.equal(p2.items.length, 2);
          const p3 = await store.mirrorList("l@ex.co", {
            limit: 2,
            offset: 4,
          });
          assert.equal(p3.items.length, 1);
          assert.equal(p3.next_offset, null);
        });
      });

      it("mirrorList items expose synced_at + kind; status has last update", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "s@ex.co");
          await store.mirrorUpsert("s@ex.co", [
            {
              path: "Atoms/Tea.md",
              title: "Tea",
              body: "I prefer tea.",
              tags: ["drink"],
            },
            {
              path: "Social/People/Nichita.md",
              title: "Nichita",
              body: "# Nichita\n",
              kind: "hub",
            },
          ]);
          const page = await store.mirrorList("s@ex.co", {
            limit: 10,
            offset: 0,
          });
          assert.equal(page.total, 2);
          for (const item of page.items) {
            assert.ok(item.synced_at, "each list item needs synced_at");
            assert.ok(
              typeof item.synced_at === "string" && item.synced_at.length > 0,
            );
            assert.ok(item.kind === "atom" || item.kind === "hub");
          }
          const hub = page.items.find((i) => i.title === "Nichita");
          assert.equal(hub?.kind, "hub");
          const st = await store.mirrorStatus("s@ex.co");
          assert.equal(st.count, 2);
          assert.ok(st.updatedAt, "mirrorStatus.updatedAt feeds last_synced_at");
        });
      });
    });
  }

  it("Postgres resolves concurrent idempotency through the unique insert", () => {
    const source = readFileSync(new URL("../src/store/askPostgresMethods.mjs", import.meta.url), "utf8");
    assert.match(source, /INSERT INTO ask_outbox[\s\S]+ON CONFLICT \(email, client_request_id\)[\s\S]+DO NOTHING[\s\S]+RETURNING/);
  });
});
