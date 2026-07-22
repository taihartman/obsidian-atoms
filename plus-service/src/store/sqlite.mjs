/**
 * Durable SQLite store (node:sqlite). Path from config.databasePath.
 */
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.mjs";

function id(prefix) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function periodEndFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      email TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      remaining INTEGER NOT NULL,
      period_end TEXT NOT NULL,
      plan TEXT NOT NULL,
      promo_redemptions INTEGER NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT
    );
    CREATE TABLE IF NOT EXISTS magic_tokens (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      exp_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      exp_ms INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS promo_global (
      code TEXT PRIMARY KEY,
      uses INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS promo_email (
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      PRIMARY KEY (email, code)
    );
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stripe_customers (
      customer_id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      idempotency_key TEXT PRIMARY KEY,
      email TEXT,
      status TEXT NOT NULL,
      response_json TEXT,
      remaining INTEGER,
      created_at TEXT NOT NULL
    );
  `);
}

export function createSqliteStore(dbPath = config.databasePath) {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);

  const sessionTtlMs = () => config.sessionTtlDays * 24 * 60 * 60 * 1000;

  function rowToAccount(r) {
    if (!r) return null;
    return {
      email: r.email,
      status: r.status,
      remaining: r.remaining,
      periodEnd: r.period_end,
      plan: r.plan,
      promoRedemptions: r.promo_redemptions,
      stripeCustomerId: r.stripe_customer_id || undefined,
      stripeSubscriptionId: r.stripe_subscription_id || undefined,
    };
  }

  function getAccount(email) {
    const key = email.trim().toLowerCase();
    const r = db
      .prepare("SELECT * FROM accounts WHERE email = ?")
      .get(key);
    return rowToAccount(r);
  }

  function ensureAccount(email) {
    const key = email.trim().toLowerCase();
    let a = getAccount(key);
    if (!a) {
      db.prepare(
        `INSERT INTO accounts (email, status, remaining, period_end, plan, promo_redemptions)
         VALUES (?, 'inactive', 0, ?, 'trial', 0)`,
      ).run(key, new Date().toISOString());
      a = getAccount(key);
    }
    return a;
  }

  function saveAccount(a) {
    db.prepare(
      `UPDATE accounts SET status=?, remaining=?, period_end=?, plan=?,
        promo_redemptions=?, stripe_customer_id=?, stripe_subscription_id=?
       WHERE email=?`,
    ).run(
      a.status,
      a.remaining,
      a.periodEnd,
      a.plan,
      a.promoRedemptions ?? 0,
      a.stripeCustomerId ?? null,
      a.stripeSubscriptionId ?? null,
      a.email,
    );
    return a;
  }

  function refreshAccountStatus(a) {
    if (!a) return a;
    let dirty = false;
    if (a.status !== "inactive" && new Date(a.periodEnd) < new Date()) {
      a.status = "exhausted";
      a.remaining = 0;
      dirty = true;
    } else if (a.remaining <= 0 && a.status !== "inactive") {
      a.status = "exhausted";
      dirty = true;
    }
    if (dirty) saveAccount(a);
    return a;
  }

  function grantPeriod(email, opts = {}) {
    const a = ensureAccount(email);
    a.status = opts.status ?? "active";
    a.plan = opts.plan ?? "monthly";
    a.remaining = opts.remaining ?? config.includedFilings;
    a.periodEnd = periodEndFromNow(opts.days ?? 30);
    return saveAccount(a);
  }

  function createMagicToken(email) {
    const token = id("mt");
    db.prepare(
      "INSERT INTO magic_tokens (token, email, exp_ms) VALUES (?, ?, ?)",
    ).run(token, email.trim().toLowerCase(), Date.now() + 15 * 60 * 1000);
    return token;
  }

  function exchangeMagic(token) {
    const row = db
      .prepare("SELECT * FROM magic_tokens WHERE token = ?")
      .get(token);
    if (!row) return null;
    db.prepare("DELETE FROM magic_tokens WHERE token = ?").run(token);
    if (Date.now() > row.exp_ms) return null;
    let a = ensureAccount(row.email);
    if (
      config.dogfoodAutoGrant &&
      (a.status === "inactive" || a.remaining <= 0)
    ) {
      const st =
        config.dogfoodGrantStatus === "active" ? "active" : "trialing";
      a = grantPeriod(row.email, {
        status: st,
        plan: st === "trialing" ? "trial" : "monthly",
        days: st === "trialing" ? config.trialDays : 30,
        remaining: config.includedFilings,
      });
    }
    a = refreshAccountStatus(a);
    const session = id("sess");
    db.prepare(
      "INSERT INTO sessions (token_hash, email, exp_ms, revoked) VALUES (?, ?, ?, 0)",
    ).run(hashToken(session), row.email, Date.now() + sessionTtlMs());
    return { session, account: a };
  }

  function accountFromSession(sessionToken) {
    if (!sessionToken) return null;
    const row = db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(hashToken(sessionToken));
    if (!row || row.revoked || Date.now() > row.exp_ms) return null;
    return refreshAccountStatus(getAccount(row.email));
  }

  function revokeSession(sessionToken) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(
      hashToken(sessionToken),
    );
  }

  function tryConsumeFiling(sessionToken, idempotencyKey) {
    if (idempotencyKey) {
      const prev = db
        .prepare("SELECT * FROM usage_events WHERE idempotency_key = ?")
        .get(idempotencyKey);
      if (prev && prev.status === "ok" && prev.response_json) {
        return {
          ok: true,
          replay: true,
          account: accountFromSession(sessionToken),
          cached: {
            responseJson: JSON.parse(prev.response_json),
            remaining: prev.remaining,
            status: "ok",
          },
        };
      }
    }

    const a = accountFromSession(sessionToken);
    if (!a) return { ok: false, code: "auth" };
    if (a.status === "inactive") return { ok: false, code: "auth" };

    const result = db
      .prepare(
        `UPDATE accounts SET remaining = remaining - 1,
          status = CASE WHEN remaining - 1 <= 0 THEN 'exhausted' ELSE status END
         WHERE email = ? AND remaining > 0 AND status IN ('active','trialing','unknown')
         RETURNING *`,
      )
      .get(a.email);

    if (!result) {
      const cur = getAccount(a.email);
      if (cur) {
        cur.status = "exhausted";
        cur.remaining = 0;
        saveAccount(cur);
      }
      return { ok: false, code: "exhausted", account: getAccount(a.email) };
    }

    if (idempotencyKey) {
      db.prepare(
        `INSERT OR IGNORE INTO usage_events (idempotency_key, email, status, created_at)
         VALUES (?, ?, 'reserved', ?)`,
      ).run(idempotencyKey, a.email, new Date().toISOString());
    }

    return { ok: true, account: rowToAccount(result), replay: false };
  }

  function completeUsage(idempotencyKey, payload) {
    if (!idempotencyKey) return;
    db.prepare(
      `INSERT INTO usage_events (idempotency_key, email, status, response_json, remaining, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         status=excluded.status,
         response_json=excluded.response_json,
         remaining=excluded.remaining`,
    ).run(
      idempotencyKey,
      payload.email ?? null,
      payload.status ?? "ok",
      JSON.stringify(payload.responseJson ?? null),
      payload.remaining ?? null,
      new Date().toISOString(),
    );
  }

  function refundFiling(sessionToken) {
    const a = accountFromSession(sessionToken);
    if (!a) return;
    db.prepare(
      `UPDATE accounts SET remaining = remaining + 1,
        status = CASE
          WHEN plan = 'trial' THEN 'trialing'
          ELSE 'active'
        END
       WHERE email = ?`,
    ).run(a.email);
  }

  function addTopUp(email, n = config.topUpFilings) {
    const a = ensureAccount(email);
    a.remaining += n;
    if (a.status === "exhausted" || a.status === "inactive") a.status = "active";
    return saveAccount(a);
  }

  function redeemPromo(email, code) {
    const upper = code.trim().toUpperCase();
    const months = config.promoCodes.get(upper);
    if (!months) return { ok: false, message: "Invalid promo code" };
    const em = email.trim().toLowerCase();
    const existing = db
      .prepare("SELECT 1 FROM promo_email WHERE email = ? AND code = ?")
      .get(em, upper);
    if (existing) {
      return { ok: false, message: "Promo already redeemed on this account" };
    }
    let g = db.prepare("SELECT uses FROM promo_global WHERE code = ?").get(upper);
    if (!g) {
      db.prepare("INSERT INTO promo_global (code, uses) VALUES (?, 0)").run(upper);
      g = { uses: 0 };
    }
    if (g.uses >= config.promoMaxRedemptions) {
      return { ok: false, message: "Promo code fully redeemed" };
    }
    db.prepare("UPDATE promo_global SET uses = uses + 1 WHERE code = ?").run(
      upper,
    );
    db.prepare("INSERT INTO promo_email (email, code) VALUES (?, ?)").run(
      em,
      upper,
    );
    const a = grantPeriod(email, {
      status: "active",
      plan: "promo",
      days: months * 30,
      remaining: config.includedFilings,
    });
    a.promoRedemptions += 1;
    saveAccount(a);
    return { ok: true, account: a, months };
  }

  function publicAccount(a) {
    return {
      email: a.email,
      status: a.status,
      remaining: a.remaining,
      periodEnd: a.periodEnd,
      plan: a.plan,
    };
  }

  return {
    kind: "sqlite",
    createMagicToken,
    exchangeMagic,
    accountFromSession,
    revokeSession,
    tryConsumeFiling,
    completeUsage,
    refundFiling,
    grantPeriod,
    addTopUp,
    redeemPromo,
    publicAccount,
    ensureAccount,
    getAccount,
    hasProcessedEvent(eventId) {
      return Boolean(
        db.prepare("SELECT 1 FROM stripe_events WHERE event_id = ?").get(eventId),
      );
    },
    markEventProcessed(eventId) {
      if (!eventId) return;
      db.prepare(
        "INSERT OR IGNORE INTO stripe_events (event_id, processed_at) VALUES (?, ?)",
      ).run(eventId, new Date().toISOString());
    },
    setStripeCustomer(email, customerId) {
      const a = ensureAccount(email);
      a.stripeCustomerId = customerId;
      saveAccount(a);
      db.prepare(
        `INSERT INTO stripe_customers (customer_id, email) VALUES (?, ?)
         ON CONFLICT(customer_id) DO UPDATE SET email=excluded.email`,
      ).run(customerId, a.email);
      return a;
    },
    setStripeSubscription(email, subId) {
      const a = ensureAccount(email);
      a.stripeSubscriptionId = subId;
      return saveAccount(a);
    },
    emailFromStripeCustomer(customerId) {
      const r = db
        .prepare("SELECT email FROM stripe_customers WHERE customer_id = ?")
        .get(customerId);
      return r?.email ?? null;
    },
    revokeSubscription(email) {
      const a = ensureAccount(email);
      a.stripeSubscriptionId = undefined;
      if (a.remaining > 0) a.status = "active";
      else {
        a.status = "inactive";
        a.remaining = 0;
      }
      return saveAccount(a);
    },
    close() {
      db.close();
    },
  };
}
