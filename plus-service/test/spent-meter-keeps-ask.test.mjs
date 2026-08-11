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

// The meter drain below exchanges a magic token; an auto-grant would refill
// the allotment we are deliberately spending down.
process.env.DOGFOOD_AUTO_GRANT = "0";

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

  it("a spent TRIAL meter also stays live — deliberate, and wider than the ask", () => {
    // The settled decision named a paying subscriber. The meter's own UPDATE
    // includes `trialing` in its `status IN (...)`, so a trial user who spends
    // their trial filings lands on exactly the same `exhausted` + live period
    // and keeps Ask/MCP for the rest of the 14-day trial.
    //
    // Pinned rather than left implicit: it follows from the principle (the
    // filing meter does not govern reading) but nobody asked for it, and it is
    // a monetization surface. To narrow it, gate on `plan` here — this test is
    // the one that should fail when someone does.
    assert.equal(
      subscriptionLive(
        { status: "exhausted", plan: "trial", periodEnd: future },
        NOW,
      ),
      true,
    );
    // An ended trial still revokes, which is what #442/#443 built the client
    // story around.
    assert.equal(
      subscriptionLive(
        { status: "exhausted", plan: "trial", periodEnd: past },
        NOW,
      ),
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
      it("spending the last filing through the real meter keeps Ask/MCP", async () => {
        await withStore(mode, async (store) => {
          const email = "spent@ex.co";
          // One filing left on a live 30-day period.
          await store.grantPeriod(email, {
            remaining: 1,
            status: "active",
            plan: "monthly",
            days: 30,
          });
          const t = await store.mintMcpTokensForTest(email, "c", RESOURCE);
          assert.ok(await store.accountFromMcpToken(t.accessToken));

          // Drive the *real* meter rather than seeding its end state: this is
          // the `status = CASE WHEN remaining - 1 <= 0 THEN 'exhausted'`
          // UPDATE that writes the second meaning of `exhausted`. Seeding
          // `remaining: 0` would assume that transition instead of proving it.
          const tok = await store.createMagicToken(email);
          const { session } = await store.exchangeMagic(tok);
          const consumed = await store.tryConsumeFiling(session, "idem-441");
          assert.ok(consumed.ok, "the last filing is spent");
          assert.equal(consumed.account.remaining, 0);

          const spent = await store.getAccount(email);
          assert.equal(spent.status, "exhausted", "the meter wrote exhausted");
          assert.ok(
            new Date(spent.periodEnd).getTime() > Date.now(),
            "and the period is still live — this is a paying subscriber",
          );

          const a = await store.accountFromMcpToken(t.accessToken);
          assert.ok(a, "a paid subscriber who spent the meter still reads");
          assert.equal(a.status, "exhausted");
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

  /**
   * A single `status` comparison against one of the entitled values. Catches
   * the shape the eleven original copies were written in, including the
   * multi-line spelling where the two halves sit on separate lines.
   */
  const STATUS_TUPLE = /status\s*[!=]==\s*"(active|trialing)"/;

  /**
   * Both values named on one line — a reversed `"active" === a.status` pair,
   * or an `["active","trialing"].includes(s)` / `new Set([...])` membership
   * test. The tuple regex alone misses every one of these, and a rewrite is at
   * least as likely to be written this way as copy-pasted verbatim.
   *
   * Naming both values is not enough on its own, because plenty of honest code
   * does: a ternary *choosing* which status to grant, and SQL selecting which
   * rows to update, both mention the pair and neither decides entitlement.
   * Those are excluded by shape rather than by an allowlist of lines, so they
   * stay excluded when someone edits them.
   *
   * Residual gap, accepted: a two-line Set built by `.add()`, or values held
   * in constants rather than literals, still slips through. This catches the
   * plausible rewrites, not every conceivable one.
   */
  const decidesEntitlement = (l) =>
    !l.includes("?") && // a ternary picks a status to write, not to gate on
    !/\bIN\s*\(/i.test(l) && // SQL row selection
    (/status/.test(l) ||
      /\.(includes|has)\(/.test(l) ||
      /new Set\(\[/.test(l) ||
      /\[\s*"(active|trialing)"/.test(l));

  const bothValues = (l) =>
    l.includes('"active"') && l.includes('"trialing"') && decidesEntitlement(l);

  /**
   * Quotes normalized so a single-quoted rewrite cannot slip past, and `//`
   * comments dropped so prose *about* the old tuple is not a failure. Without
   * the second step, a future comment mentioning `status === "active"` fails
   * this test with no logic change — the mirror of the gap above.
   */
  const codeOf = (line) =>
    line.replace(/\/\/.*$/, "").replace(/'/g, '"').trim();

  it("no file outside shared.mjs re-derives the entitlement tuple", () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      const rel = path.relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((raw, i) => {
          if (raw.trimStart().startsWith("*")) return; // block-comment body
          const line = codeOf(raw);
          if (STATUS_TUPLE.test(line) || bothValues(line)) {
            offenders.push(`${rel}:${i + 1}  ${line}`);
          }
        });
    }
    assert.deepEqual(
      offenders,
      [],
      "these sites must ask subscriptionLive() instead of deciding " +
        "entitlement locally:\n" + offenders.join("\n"),
    );
  });

  it("the parity check actually catches a rewritten copy", () => {
    // The guard above is only worth its comment if it survives paraphrase.
    // A check that catches copy-paste and nothing else advertises a guarantee
    // it does not have, which is how this bug reached eleven sites.
    const rewrites = [
      'if (a.status !== "active" && a.status !== "trialing") return null;',
      "if (a.status !== 'active' && a.status !== 'trialing') return null;",
      'if ("active" === a.status || "trialing" === a.status) ok();',
      'if (["active", "trialing"].includes(a.status)) ok();',
      'const LIVE = new Set(["active", "trialing"]);',
    ];
    for (const r of rewrites) {
      const line = codeOf(r);
      assert.ok(
        STATUS_TUPLE.test(line) || bothValues(line),
        `a copy written as \`${r}\` would slip past the parity check`,
      );
    }
    // ...and does not fire on honest code that merely names both values, or
    // on prose about the fix. Each of these was a real false positive before
    // `decidesEntitlement` narrowed the check.
    const innocent = [
      '  // the old gate compared status === "active" here',
      'config.dogfoodGrantStatus === "active" ? "active" : "trialing";',
      'a.status = a.plan === "trial" ? "trialing" : "active";',
      '`WHERE email = $1 AND remaining > 0 AND status IN (\'active\',\'trialing\')`',
    ];
    for (const line of innocent.map(codeOf)) {
      assert.ok(
        !STATUS_TUPLE.test(line) && !bothValues(line),
        `the parity check must not fire on \`${line}\``,
      );
    }
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
    // Deliberately not a line count — the guard spans two lines today and
    // reflowing it onto one would fail this for no reason. What matters is
    // that the only comparisons in the file belong to the trial guard.
    const guard = src.slice(src.indexOf('kind === "start_trial"'));
    assert.ok(
      guard.startsWith('kind === "start_trial"'),
      "server.mjs must still contain the start_trial guard",
    );
    const before = src.slice(0, src.indexOf('kind === "start_trial"'));
    const strays = before.split("\n").filter((l) => STATUS_TUPLE.test(codeOf(l)));
    assert.deepEqual(
      strays,
      [],
      "server.mjs compares these statuses only in the start_trial guard",
    );
  });
});
