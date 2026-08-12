/**
 * #320 — multi-device sessions: second sign-in must not kill the first verified device.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";

process.env.DOGFOOD_AUTO_GRANT = "0";
process.env.ATOMS_PLUS_ENV = "development";

describe("multi-device sessions (#320)", () => {
  it("two exchanges leave two live verified sessions", async () => {
    const store = createMemoryStore();
    const email = `multi-${Date.now()}@ex.com`;
    await store.grantPeriod(email, {
      remaining: 50,
      status: "active",
      days: 30,
    });
    const t1 = await store.createMagicToken(email);
    const t2 = await store.createMagicToken(email);
    const a = await store.exchangeMagic(t1);
    const b = await store.exchangeMagic(t2);
    assert.ok(a?.session);
    assert.ok(b?.session);
    assert.notEqual(a.session, b.session);
    assert.ok(await store.accountFromSession(a.session, { requireVerified: true }));
    assert.ok(await store.accountFromSession(b.session, { requireVerified: true }));
    if (store.close) await store.close();
  });

  it("sign-out-all revokes every session including the caller's", async () => {
    const store = createMemoryStore();
    const email = `allout-${Date.now()}@ex.com`;
    await store.grantPeriod(email, {
      remaining: 50,
      status: "active",
      days: 30,
    });
    const a = await store.exchangeMagic(await store.createMagicToken(email));
    const b = await store.exchangeMagic(await store.createMagicToken(email));
    const n = await store.revokeAllSessionsForEmail(email);
    assert.ok(n >= 2);
    assert.equal(await store.accountFromSession(a.session), null);
    assert.equal(await store.accountFromSession(b.session), null);
    if (store.close) await store.close();
  });

  it("C1: soft start session dies on exchange", async () => {
    const store = createMemoryStore();
    const email = `c1-${Date.now()}@ex.com`;
    const soft = await store.startWithEmail(email);
    assert.equal(soft.ok, true);
    await store.grantPeriod(email, {
      remaining: 50,
      status: "active",
      days: 30,
    });
    await store.exchangeMagic(await store.createMagicToken(email));
    assert.equal(await store.accountFromSession(soft.session), null);
    if (store.close) await store.close();
  });
});
