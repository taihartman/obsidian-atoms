import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";

describe("plus store", () => {
  it("magic link exchange grants dogfood period", async () => {
    const store = await createStore({ mode: "memory" });
    const token = await store.createMagicToken("User@Example.com");
    const out = await store.exchangeMagic(token);
    assert.ok(out);
    assert.equal(out.account.email, "user@example.com");
    assert.ok(["trialing", "active"].includes(out.account.status));
    assert.equal(out.account.remaining, 150);
  });

  it("consume then exhaust", async () => {
    const store = await createStore({ mode: "memory" });
    const token = await store.createMagicToken("a@b.co");
    const { session } = await store.exchangeMagic(token);
    const a = await store.getAccount("a@b.co");
    a.remaining = 1;
    a.status = "active";
    const ok = await store.tryConsumeFiling(session);
    assert.equal(ok.ok, true);
    assert.equal(ok.account.remaining, 0);
    assert.equal(ok.account.status, "exhausted");
    const fail = await store.tryConsumeFiling(session);
    assert.equal(fail.ok, false);
    assert.equal(fail.code, "exhausted");
  });

  it("no rollover on re-grant", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("x@y.co", { remaining: 20, status: "active" });
    await store.grantPeriod("x@y.co", { remaining: 150, status: "active" });
    assert.equal((await store.getAccount("x@y.co")).remaining, 150);
  });

  it("top-up adds filings", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("t@t.co", { remaining: 0, status: "exhausted" });
    const a = await store.addTopUp("t@t.co", 50);
    assert.equal(a.remaining, 50);
    assert.equal(a.status, "active");
  });

  it("refund after failed classify", async () => {
    const store = await createStore({ mode: "memory" });
    const token = await store.createMagicToken("r@r.co");
    const { session } = await store.exchangeMagic(token);
    const a = await store.getAccount("r@r.co");
    a.remaining = 5;
    await store.tryConsumeFiling(session);
    assert.equal((await store.getAccount("r@r.co")).remaining, 4);
    await store.refundFiling(session);
    assert.equal((await store.getAccount("r@r.co")).remaining, 5);
  });

  it("sqlite factory works", async () => {
    const store = await createStore({ mode: "sqlite", path: ":memory:" });
    assert.equal(store.kind, "sqlite");
    await store.grantPeriod("s@q.co", { remaining: 3, status: "active" });
    assert.equal((await store.getAccount("s@q.co")).remaining, 3);
    if (store.close) store.close();
  });

  it("startWithEmail soft account inactive no filings", async () => {
    const store = await createStore({ mode: "memory" });
    const out = await store.startWithEmail("Soft@Ex.com");
    assert.equal(out.ok, true);
    assert.ok(String(out.session).startsWith("sess_"));
    assert.equal(out.account.email, "soft@ex.com");
    assert.equal(out.account.status, "inactive");
    assert.equal(out.account.remaining, 0);
    const fail = await store.tryConsumeFiling(out.session);
    assert.equal(fail.ok, false);
    assert.equal(fail.code, "auth");
  });

  it("startWithEmail refuses entitled account", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("paid@x.co", {
      remaining: 10,
      status: "active",
    });
    const out = await store.startWithEmail("paid@x.co");
    assert.equal(out.ok, false);
    assert.equal(out.needsMagicLink, true);
    assert.equal(out.session, undefined);
  });

  it("second start mints new session still inactive", async () => {
    const store = await createStore({ mode: "memory" });
    const a = await store.startWithEmail("twice@x.co");
    const b = await store.startWithEmail("twice@x.co");
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.session, b.session);
    assert.equal(b.account.status, "inactive");
  });
});
