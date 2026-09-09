import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

const modes = askStoreModes();

describe("G2 device store contract", () => {
  for (const mode of modes) {
    it(`${mode}: G2_REDEEM_004 code is single-use and tenant-scoped`, async () => {
      await withStore(mode, async (store) => {
        store.ensureAccount("owner@atoms.test");
        await store.grantPeriod("owner@atoms.test", { status: "active" });
        const minted = await store.g2PairMint("owner@atoms.test", {
          scopes: ["g2:query", "g2:commit", "not-real"],
        });
        const displayed = `${minted.code.slice(0, 4)}-${minted.code.slice(4)}`;
        const first = await store.g2PairRedeem(displayed, {
          jkt: "jkt-owner",
          name: "My G2",
        });
        assert.ok(first?.accessToken?.startsWith("g2a_"));
        assert.ok(first?.refreshToken?.startsWith("g2r_"));
        assert.deepEqual(first.scopes, ["g2:commit", "g2:query"]);
        assert.equal(await store.g2PairRedeem(minted.code, { jkt: "jkt-other" }), null);
        assert.equal((await store.g2ListDevices("foreign@atoms.test")).length, 0);
      });
    });

    it(`${mode}: G2_REFRESH_005 replay revokes the family atomically`, async () => {
      await withStore(mode, async (store) => {
        store.ensureAccount("refresh@atoms.test");
        await store.grantPeriod("refresh@atoms.test", { status: "active" });
        const pair = await store.g2PairMint("refresh@atoms.test", { scopes: ["g2:query"] });
        const issued = await store.g2PairRedeem(pair.code, { jkt: "jkt-refresh" });
        const rotated = await store.g2Refresh(issued.refreshToken, "jkt-refresh");
        assert.ok(rotated?.refreshToken?.startsWith("g2r_"));
        assert.equal(await store.g2Refresh(issued.refreshToken, "jkt-refresh"), null);
        assert.equal(await store.g2AccessLookup(rotated.accessToken), null);
        assert.equal(await store.g2Refresh(rotated.refreshToken, "jkt-refresh"), null);
      });
    });

    it(`${mode}: G2_SESSION_REVOKE_003 revokes only the owned family`, async () => {
      await withStore(mode, async (store) => {
        for (const email of ["a@atoms.test", "b@atoms.test"]) {
          store.ensureAccount(email);
          await store.grantPeriod(email, { status: "active" });
        }
        const ca = await store.g2PairMint("a@atoms.test", { scopes: ["g2:fetch"] });
        const cb = await store.g2PairMint("b@atoms.test", { scopes: ["g2:fetch"] });
        const a = await store.g2PairRedeem(ca.code, { jkt: "a" });
        const b = await store.g2PairRedeem(cb.code, { jkt: "b" });
        assert.equal(await store.g2RevokeDevice("b@atoms.test", a.device.id), false);
        assert.equal(await store.g2RevokeDevice("a@atoms.test", a.device.id), true);
        assert.equal(await store.g2AccessLookup(a.accessToken), null);
        assert.ok(await store.g2AccessLookup(b.accessToken));
      });
    });
  }
});
