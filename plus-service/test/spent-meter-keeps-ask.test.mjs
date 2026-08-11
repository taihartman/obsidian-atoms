/**
 * #441 — a spent filing meter must not revoke Ask/MCP for a paying subscriber.
 *
 * `exhausted` carries two unrelated meanings (period ended · allotment spent)
 * and every gate downstream read it as one. The tests are layered to match
 * where each defect actually lives:
 *
 * 1. `subscriptionLive` — the split itself, including the boundary and the
 *    stale-`status` case the OAuth gates reach it with.
 * 2. `accountFromMcpToken` across **all three stores** — the real bug, and the
 *    real hazard: the gate had three byte-identical copies, so a partial fix
 *    passes on whichever store the suite happens to run.
 * 3. Source parity — that no gate hand-rolls the status tuple any more. This is
 *    what catches copy number four, which is how this bug got three.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";
import { periodEnded, subscriptionLive } from "../src/store/shared.mjs";

const SRC = path.dirname(fileURLToPath(import.meta.url)) + "/../src";
const RESOURCE = "https://plus.tryatoms.app/mcp";

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);
const future = new Date(NOW + 5 * 86_400_000).toISOString();
const past = new Date(NOW - 5 * 86_400_000).toISOString();

describe("#441 subscriptionLive — ended period vs spent meter", () => {
  it("a spent meter is still live: the period has not ended", () => {
    // What the meter's UPDATE writes on the last filing of a live period.
    assert.equal(
      subscriptionLive({ status: "exhausted", periodEnd: future }, NOW),
      true,
    );
  });

  it("an ended period is not live", () => {
    assert.equal(
      subscriptionLive({ status: "exhausted", periodEnd: past }, NOW),
      false,
    );
  });

  it("active and trialing are live", () => {
    for (const status of ["active", "trialing"]) {
      assert.equal(subscriptionLive({ status, periodEnd: future }, NOW), true);
    }
  });

  it("a stale 'active' with a past period is NOT live", () => {
    // The OAuth gates call getAccount() without refreshAccountStatus, so they
    // reach this with an un-normalized status. The period check has to come
    // first or a lapsed account connects an AI app.
    assert.equal(
      subscriptionLive({ status: "active", periodEnd: past }, NOW),
      false,
    );
    assert.equal(
      subscriptionLive({ status: "trialing", periodEnd: past }, NOW),
      false,
    );
  });

  it("inactive and unknown stay out — this widens `exhausted` only", () => {
    for (const status of ["inactive", "unknown", "", undefined]) {
      assert.equal(
        subscriptionLive({ status, periodEnd: future }, NOW),
        false,
        `status ${String(status)} must not be entitled`,
      );
    }
  });

  it("no account is not live", () => {
    assert.equal(subscriptionLive(null, NOW), false);
    assert.equal(subscriptionLive(undefined, NOW), false);
  });

  it("an unreadable periodEnd fails closed", () => {
    for (const periodEnd of ["", "not-a-date", null, undefined]) {
      assert.equal(periodEnded({ periodEnd }, NOW), true);
      assert.equal(
        subscriptionLive({ status: "exhausted", periodEnd }, NOW),
        false,
        `periodEnd ${String(periodEnd)} must fail closed`,
      );
    }
  });

  it("the boundary is periodEnd itself: live up to it, not past it", () => {
    const end = new Date(NOW).toISOString();
    // Strictly-past is ended, matching applyStatusRules' own `<` comparison.
    assert.equal(subscriptionLive({ status: "exhausted", periodEnd: end }, NOW), true);
    assert.equal(
      subscriptionLive({ status: "exhausted", periodEnd: end }, NOW + 1),
      false,
    );
    assert.equal(
      subscriptionLive({ status: "exhausted", periodEnd: end }, NOW - 1),
      true,
    );
  });
});

describe("#441 a spent meter keeps the MCP token working", () => {
  for (const mode of askStoreModes()) {
    describe(mode, () => {
      it("spent meter (remaining 0, period live) keeps Ask/MCP", async () => {
        await withStore(mode, async (store) => {
          const email = "spent@ex.co";
          await store.grantPeriod(email, {
            remaining: 150,
            status: "active",
            plan: "monthly",
          });
          const t = await store.mintMcpTokensForTest(email, "c", RESOURCE);
          assert.ok(await store.accountFromMcpToken(t.accessToken));

          // Spend the allotment through the public API, leaving the period
          // live — the exact state the meter's UPDATE writes on the last
          // filing. (Mutating the object getAccount returns would be a no-op
          // on every store but memory; see store-ask.test.mjs.)
          await store.grantPeriod(email, {
            remaining: 0,
            status: "active",
            plan: "monthly",
            days: 30,
          });

          const a = await store.accountFromMcpToken(t.accessToken);
          assert.ok(a, "a paid subscriber who spent the meter still reads");
          assert.equal(a.status, "exhausted", "status is still exhausted");
          assert.deepEqual(a.mcpScopes, ["atoms:read"]);
        });
      });

      it("ended period still revokes Ask/MCP", async () => {
        await withStore(mode, async (store) => {
          const email = "ended@ex.co";
          await store.grantPeriod(email, {
            remaining: 150,
            status: "active",
            plan: "monthly",
          });
          const t = await store.mintMcpTokensForTest(email, "c", RESOURCE);
          assert.ok(await store.accountFromMcpToken(t.accessToken));

          await store.grantPeriod(email, {
            remaining: 150,
            status: "active",
            plan: "monthly",
            days: -1,
          });

          assert.equal(
            await store.accountFromMcpToken(t.accessToken),
            null,
            "an ended period revokes — #442/#443 tell the user why",
          );
        });
      });

      it("a live period with filings left is unaffected", async () => {
        await withStore(mode, async (store) => {
          const email = "healthy@ex.co";
          await store.grantPeriod(email, {
            remaining: 150,
            status: "active",
            plan: "monthly",
          });
          const t = await store.mintMcpTokensForTest(email, "c", RESOURCE);
          assert.ok(await store.accountFromMcpToken(t.accessToken));
        });
      });
    });
  }
});

/** Every .mjs under src/, recursively. */
function sourceFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

describe("#441 the entitlement gate has one home", () => {
  // A hand-rolled `status === "active" || status === "trialing"` IS the bug:
  // it reads `exhausted` as one thing when it means two. Only two files may
  // compare these statuses directly — shared.mjs, which owns the split, and
  // server.mjs, whose match is a different question entirely (may this account
  // start a second free trial).
  const ALLOWED = new Set(["store/shared.mjs", "server.mjs"]);
  const STATUS_TUPLE = /status\s*[!=]==\s*"(active|trialing)"/;

  it("no file outside shared.mjs re-derives the entitlement tuple", () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      const rel = path.relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (STATUS_TUPLE.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    assert.deepEqual(
      offenders,
      [],
      "these sites must ask subscriptionLive() instead of comparing status:\n" +
        offenders.join("\n"),
    );
  });

  it("every gate that lost its tuple actually asks subscriptionLive", () => {
    // Reads as the complement of the check above: proving the tuple is gone
    // is only half — it must have been replaced, not deleted.
    const gates = [
      "store/askPostgresMethods.mjs",
      "store/askSqliteMethods.mjs",
      "store/memory.mjs",
      "mirror/http.mjs",
      "oauth/routes.mjs",
    ];
    for (const rel of gates) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      assert.ok(
        src.includes("subscriptionLive"),
        `${rel} must gate on subscriptionLive()`,
      );
    }
  });

  it("server.mjs's allowed match is the trial guard, not an Ask gate", () => {
    // Pins why the exception exists, so widening the allowlist is deliberate.
    const src = readFileSync(path.join(SRC, "server.mjs"), "utf8");
    const hits = src
      .split("\n")
      .filter((l) => STATUS_TUPLE.test(l))
      .length;
    assert.equal(hits, 2, "only the start_trial already-on-a-plan guard");
    assert.ok(src.includes('kind === "start_trial"'));
  });
});
