import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";

describe("plus store", () => {
  it("magic link exchange grants dogfood period", () => {
    const store = createStore();
    const token = store.createMagicToken("User@Example.com");
    const out = store.exchangeMagic(token);
    assert.ok(out);
    assert.equal(out.account.email, "user@example.com");
    assert.ok(["trialing", "active"].includes(out.account.status));
    assert.equal(out.account.remaining, 150);
  });

  it("consume then exhaust", () => {
    const store = createStore();
    const token = store.createMagicToken("a@b.co");
    const { session } = store.exchangeMagic(token);
    // force small remaining
    const a = store.getAccount("a@b.co");
    a.remaining = 1;
    a.status = "active";
    const ok = store.tryConsumeFiling(session);
    assert.equal(ok.ok, true);
    assert.equal(ok.account.remaining, 0);
    assert.equal(ok.account.status, "exhausted");
    const fail = store.tryConsumeFiling(session);
    assert.equal(fail.ok, false);
    assert.equal(fail.code, "exhausted");
  });

  it("no rollover on re-grant", () => {
    const store = createStore();
    store.grantPeriod("x@y.co", { remaining: 20, status: "active" });
    store.grantPeriod("x@y.co", { remaining: 150, status: "active" });
    assert.equal(store.getAccount("x@y.co").remaining, 150);
  });

  it("top-up adds filings", () => {
    const store = createStore();
    store.grantPeriod("t@t.co", { remaining: 0, status: "exhausted" });
    const a = store.addTopUp("t@t.co", 50);
    assert.equal(a.remaining, 50);
    assert.equal(a.status, "active");
  });

  it("refund after failed classify", () => {
    const store = createStore();
    const token = store.createMagicToken("r@r.co");
    const { session } = store.exchangeMagic(token);
    const a = store.getAccount("r@r.co");
    a.remaining = 5;
    store.tryConsumeFiling(session);
    assert.equal(store.getAccount("r@r.co").remaining, 4);
    store.refundFiling(session);
    assert.equal(store.getAccount("r@r.co").remaining, 5);
  });
});
