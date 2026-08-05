import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";
import { assertMirrorPath } from "../src/store/askHelpers.mjs";

function seed(store, email) {
  return store.grantPeriod(email, {
    remaining: 150,
    status: "active",
    plan: "monthly",
  });
}

describe("assertMirrorPath", () => {
  it("allows flat Atoms/*.md and hub paths", () => {
    assert.equal(assertMirrorPath("Atoms/Tea.md").ok, true);
    assert.equal(assertMirrorPath("Atoms/Tea.md", { kind: "atom" }).ok, true);
    assert.equal(assertMirrorPath("Daily/foo.md", { kind: "atom" }).ok, false);
    assert.equal(assertMirrorPath("Daily/foo.md", { kind: "hub" }).ok, true);
    assert.equal(assertMirrorPath("Social/People/N.md", { kind: "hub" }).ok, true);
    assert.equal(assertMirrorPath("Atoms/sub/x.md").ok, false);
    assert.equal(assertMirrorPath("Atoms/../x.md").ok, false);
    assert.equal(assertMirrorPath("/Atoms/x.md").ok, false);
    assert.equal(assertMirrorPath("Atoms\\x.md").ok, false);
    assert.equal(assertMirrorPath("Atoms/x.txt").ok, false);
  });
});

describe("mirror delete + reconcile", () => {
  for (const mode of askStoreModes()) {
    describe(mode, () => {
      it("delete existing path", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "d@ex.co");
          await store.mirrorUpsert("d@ex.co", [
            { path: "Atoms/A.md", title: "A", body: "a" },
            { path: "Atoms/B.md", title: "B", body: "b" },
          ]);
          const r = await store.mirrorDelete("d@ex.co", ["Atoms/A.md"]);
          assert.equal(r.deleted, 1);
          assert.equal(await store.mirrorFetch("d@ex.co", "A"), null);
          assert.ok(await store.mirrorFetch("d@ex.co", "B"));
        });
      });

      it("delete missing is idempotent", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "d@ex.co");
          const r = await store.mirrorDelete("d@ex.co", ["Atoms/Gone.md"]);
          assert.equal(r.deleted, 0);
          assert.equal(r.missing, 1);
        });
      });

      it("reconcile keep set", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "r@ex.co");
          await store.mirrorUpsert("r@ex.co", [
            { path: "Atoms/A.md", title: "A", body: "a" },
            { path: "Atoms/B.md", title: "B", body: "b" },
            { path: "Atoms/C.md", title: "C", body: "c" },
          ]);
          const r = await store.mirrorReconcileKeep("r@ex.co", [
            "Atoms/A.md",
            "Atoms/B.md",
          ]);
          assert.equal(r.deleted, 1);
          assert.equal(await store.mirrorFetch("r@ex.co", "C"), null);
          assert.ok(await store.mirrorFetch("r@ex.co", "A"));
        });
      });

      it("reconcile empty keep deletes all", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "r@ex.co");
          await store.mirrorUpsert("r@ex.co", [
            { path: "Atoms/A.md", title: "A", body: "a" },
          ]);
          const r = await store.mirrorReconcileKeep("r@ex.co", []);
          assert.equal(r.deleted, 1);
          assert.equal(r.count, 0);
        });
      });

      it("upsert rejects non-Atoms path", async () => {
        await withStore(mode, async (store) => {
          await seed(store, "x@ex.co");
          await assert.rejects(
            async () =>
              store.mirrorUpsert("x@ex.co", [
                { path: "Daily/foo.md", title: "F", body: "x" },
              ]),
            /Atoms/,
          );
        });
      });
    });
  }
});
