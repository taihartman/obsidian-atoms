/**
 * Durable SQLite store (node:sqlite). Path from config.databasePath.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.mjs";
import {
  applyStatusRules,
  CHECKOUT_BINDING_TTL_MS,
  hashToken,
  id,
  isEntitledAccount,
  MAGIC_EXCHANGE_REFUSED,
  MAGIC_PEEK_MISS,
  normalizeStripeIncident,
  periodEndFromNow,
  publicAccount,
  rowToAccount,
  rowToIncident,
  toMs,
  verifierMatches,
} from "./shared.mjs";
import {
  ASK_SQLITE_DDL,
  createAskSqliteMethods,
} from "./askSqliteMethods.mjs";

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
      exp_ms INTEGER NOT NULL,
      verifier_hash TEXT,
      vault TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      exp_ms INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS checkout_bindings (
      checkout_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      session_hash TEXT NOT NULL,
      exp_ms INTEGER NOT NULL
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
    CREATE TABLE IF NOT EXISTS stripe_incidents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      day_bucket TEXT NOT NULL,
      stripe_id TEXT NOT NULL DEFAULT '',
      email TEXT,
      detail TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      alerted_at TEXT,
      UNIQUE (kind, day_bucket, stripe_id)
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
  db.exec(ASK_SQLITE_DDL);
  const sessCols = db.prepare("PRAGMA table_info(sessions)").all();
  if (!sessCols.some((c) => c.name === "verified")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN verified INTEGER NOT NULL DEFAULT 1",
    );
  }
  // #240 U1 — already-deployed databases gain the magic-token columns on open.
  const magicCols = db.prepare("PRAGMA table_info(magic_tokens)").all();
  if (!magicCols.some((c) => c.name === "verifier_hash")) {
    db.exec("ALTER TABLE magic_tokens ADD COLUMN verifier_hash TEXT");
  }
  if (!magicCols.some((c) => c.name === "vault")) {
    db.exec("ALTER TABLE magic_tokens ADD COLUMN vault TEXT");
  }
  const mirrorCols = db.prepare("PRAGMA table_info(atom_mirror)").all();
  if (!mirrorCols.some((c) => c.name === "created")) {
    db.exec("ALTER TABLE atom_mirror ADD COLUMN created TEXT");
  }
  if (!mirrorCols.some((c) => c.name === "expand_enc")) {
    db.exec("ALTER TABLE atom_mirror ADD COLUMN expand_enc TEXT");
  }
}

export function createSqliteStore(dbPath = config.databasePath) {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);

  const sessionTtlMs = () => config.sessionTtlDays * 24 * 60 * 60 * 1000;

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
    const { dirty } = applyStatusRules(a);
    if (dirty) saveAccount(a);
    return a;
  }

  const ask = createAskSqliteMethods(db, {
    getAccount,
    refreshAccountStatus,
  });

  function grantPeriod(email, opts = {}) {
    const a = ensureAccount(email);
    a.status = opts.status ?? "active";
    a.plan = opts.plan ?? "monthly";
    a.remaining = opts.remaining ?? config.includedFilings;
    a.periodEnd = periodEndFromNow(opts.days ?? 30);
    const saved = saveAccount(a);
    revokeUnverifiedSessionsForEmail(saved.email);
    return saved;
  }

  /**
   * @param {string} email
   * @param {{ verifierHash?: string, vault?: string }} [opts] #240 U1 — the
   *   requesting device's verifier hash (R12) and the requesting vault's name
   *   (R3). Both optional: a caller that passes neither still works.
   */
  function createMagicToken(email, opts = {}) {
    // #240 U3 / KTD13 — every row past TTL, not only this email's. See the
    // memory store's sweep for why the predicate carries no email.
    db.prepare("DELETE FROM magic_tokens WHERE exp_ms < ?").run(Date.now());
    const token = id("mt");
    // KTD14 — the `token` column holds `hashToken(token)`, as sessions do.
    db.prepare(
      `INSERT INTO magic_tokens (token, email, exp_ms, verifier_hash, vault)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      hashToken(token),
      email.trim().toLowerCase(),
      Date.now() + 15 * 60 * 1000,
      opts.verifierHash || null,
      opts.vault || null,
    );
    return token;
  }

  /**
   * #240 U2 — answer whether a magic token is usable without spending it (R6,
   * R9). A plain SELECT: no delete, and no transaction that could hold one.
   * The expired row stays put for U3's mint sweep (KTD13).
   *
   * @param {string} token
   * @returns {MagicPeek}
   */
  function peekMagic(token) {
    const row = db
      .prepare("SELECT * FROM magic_tokens WHERE token = ?")
      .get(hashToken(token));
    if (!row) return MAGIC_PEEK_MISS.invalid;
    if (Date.now() > Number(row.exp_ms)) return MAGIC_PEEK_MISS.expired;
    return {
      ok: true,
      status: "usable",
      email: row.email,
      vault: row.vault ?? null,
      verifierBound: !!row.verifier_hash,
      verifierHash: row.verifier_hash ?? null,
    };
  }

  function magicRowsForTest() {
    return db
      .prepare("SELECT * FROM magic_tokens")
      .all()
      .map((r) => ({
        key: r.token,
        email: r.email,
        expMs: Number(r.exp_ms),
        verifierHash: r.verifier_hash ?? null,
        vault: r.vault ?? null,
      }));
  }

  function writeMagicRowForTest(key, row) {
    db.prepare(
      `INSERT INTO magic_tokens (token, email, exp_ms, verifier_hash, vault)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      key,
      String(row.email).trim().toLowerCase(),
      Number(row.expMs),
      row.verifierHash || null,
      row.vault || null,
    );
  }

  /**
   * @param {string} email
   * @param {{ verified?: boolean }} [opts]
   */
  function createSession(email, opts = {}) {
    const key = email.trim().toLowerCase();
    const session = id("sess");
    const verified = opts.verified !== false ? 1 : 0;
    db.prepare(
      "INSERT INTO sessions (token_hash, email, exp_ms, revoked, verified) VALUES (?, ?, ?, 0, ?)",
    ).run(hashToken(session), key, Date.now() + sessionTtlMs(), verified);
    return session;
  }

  function revokeAllSessionsForEmail(email) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE email = ?").run(
      email.trim().toLowerCase(),
    );
  }

  function revokeUnverifiedSessionsForEmail(email) {
    db.prepare(
      "UPDATE sessions SET revoked = 1 WHERE email = ? AND verified = 0",
    ).run(email.trim().toLowerCase());
  }

  /**
   * Remember which plugin session opened this Stripe Checkout. The webhook that
   * grants the trial has no session context of its own, and grantPeriod revokes
   * every unverified session for the email — without this binding the paying
   * user's session dies and never comes back (#230). Only the hash is stored,
   * same as sessions.
   */
  function bindCheckoutSession(checkoutId, email, sessionToken) {
    if (!checkoutId || !sessionToken) return false;
    db.prepare(
      `INSERT INTO checkout_bindings (checkout_id, email, session_hash, exp_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (checkout_id) DO UPDATE
         SET email = excluded.email,
             session_hash = excluded.session_hash,
             exp_ms = excluded.exp_ms`,
    ).run(
      String(checkoutId),
      email.trim().toLowerCase(),
      hashToken(sessionToken),
      Date.now() + CHECKOUT_BINDING_TTL_MS,
    );
    return true;
  }

  /**
   * Single-use: re-verify the one session that paid for this checkout, undoing
   * grantPeriod's revoke for it alone. A soft session that never opened checkout
   * has no binding and stays revoked — that is the C1 fixation case (#163).
   */
  function promoteCheckoutSession(checkoutId, email) {
    if (!checkoutId) return false;
    const key = String(email || "")
      .trim()
      .toLowerCase();
    const row = db
      .prepare("SELECT * FROM checkout_bindings WHERE checkout_id = ?")
      .get(String(checkoutId));
    if (!row || row.email !== key || Date.now() > Number(row.exp_ms)) {
      return false;
    }
    const r = db
      .prepare(
        `UPDATE sessions SET verified = 1, revoked = 0
         WHERE token_hash = ? AND exp_ms > ?
         RETURNING token_hash`,
      )
      .get(row.session_hash, Date.now());
    db.prepare("DELETE FROM checkout_bindings WHERE checkout_id = ?").run(
      String(checkoutId),
    );
    return Boolean(r);
  }

  /** Promote soft session after checkout; clears revoke from grantPeriod. */
  function markSessionVerified(sessionToken) {
    if (!sessionToken) return false;
    const r = db
      .prepare(
        `UPDATE sessions SET verified = 1, revoked = 0
         WHERE token_hash = ? AND exp_ms > ?
         RETURNING token_hash`,
      )
      .get(hashToken(sessionToken), Date.now());
    return Boolean(r);
  }

  function startWithEmail(email) {
    let a = refreshAccountStatus(ensureAccount(email));
    if (isEntitledAccount(a)) {
      return { ok: false, needsMagicLink: true, account: a };
    }
    const session = createSession(a.email, { verified: false });
    return { ok: true, session, account: a };
  }

  /**
   * @param {string} token
   * @param {MagicExchangeOpts} [opts] #240 U4 — see the typedef: the caller
   *   says either which verifier it holds or that no check applies to it.
   */
  function exchangeMagic(token, opts = {}) {
    const key = hashToken(token);
    const row = db
      .prepare("SELECT * FROM magic_tokens WHERE token = ?")
      .get(key);
    if (!row) return null;
    // #240 U4 / KTD3 — this used to delete here, before it had even checked
    // expiry, which made "refused" and "consumed" the same row state. The row
    // is now removed only once it is actually going to be spent (or is dead).
    if (Date.now() > row.exp_ms) {
      db.prepare("DELETE FROM magic_tokens WHERE token = ?").run(key);
      return null;
    }
    if (
      !opts.skipVerifierCheck &&
      !verifierMatches(row.verifier_hash, opts.verifier)
    ) {
      return MAGIC_EXCHANGE_REFUSED;
    }
    db.prepare("DELETE FROM magic_tokens WHERE token = ?").run(key);
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
    revokeAllSessionsForEmail(row.email);
    const session = createSession(row.email, { verified: true });
    return { session, account: a, vault: row.vault ?? null };
  }

  /**
   * @param {string} sessionToken
   * @param {{ requireVerified?: boolean }} [opts]
   */
  function accountFromSession(sessionToken, opts = {}) {
    if (!sessionToken) return null;
    const row = db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(hashToken(sessionToken));
    if (!row || row.revoked || Date.now() > row.exp_ms) return null;
    if (opts.requireVerified && !row.verified) return null;
    return refreshAccountStatus(getAccount(row.email));
  }

  function revokeSession(sessionToken) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(
      hashToken(sessionToken),
    );
  }

  function tryConsumeFiling(sessionToken, idempotencyKey) {
    const a = accountFromSession(sessionToken, { requireVerified: true });
    if (!a) return { ok: false, code: "auth" };
    if (a.status === "inactive") return { ok: false, code: "auth" };

    // Serialize meter + ledger (KTD-B5). Single-writer WAL; BEGIN IMMEDIATE locks.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (idempotencyKey) {
        const prev = db
          .prepare("SELECT * FROM usage_events WHERE idempotency_key = ?")
          .get(idempotencyKey);
        if (prev && prev.email && prev.email !== a.email) {
          db.exec("COMMIT");
          return { ok: false, code: "idempotency_conflict" };
        }
        if (prev && prev.status === "ok" && prev.response_json) {
          db.exec("COMMIT");
          return {
            ok: true,
            replay: true,
            account: accountFromSession(sessionToken, { requireVerified: true }),
            cached: {
              responseJson: JSON.parse(prev.response_json),
              remaining: prev.remaining,
              status: "ok",
            },
          };
        }
        if (prev && prev.status === "reserved") {
          db.exec("COMMIT");
          return { ok: false, code: "in_flight", account: getAccount(a.email) };
        }
        if (prev && prev.status === "refunded") {
          db.prepare(
            `UPDATE usage_events SET status = 'reserved', response_json = NULL,
              remaining = NULL, email = ?, created_at = ? WHERE idempotency_key = ?`,
          ).run(a.email, new Date().toISOString(), idempotencyKey);
        } else if (!prev) {
          db.prepare(
            `INSERT INTO usage_events (idempotency_key, email, status, created_at)
             VALUES (?, ?, 'reserved', ?)`,
          ).run(idempotencyKey, a.email, new Date().toISOString());
        }
      }

      const result = db
        .prepare(
          `UPDATE accounts SET remaining = remaining - 1,
            status = CASE WHEN remaining - 1 <= 0 THEN 'exhausted' ELSE status END
           WHERE email = ? AND remaining > 0 AND status IN ('active','trialing','unknown')
           RETURNING *`,
        )
        .get(a.email);

      if (!result) {
        if (idempotencyKey) {
          db.prepare(
            `DELETE FROM usage_events WHERE idempotency_key = ? AND status = 'reserved'`,
          ).run(idempotencyKey);
        }
        const cur = getAccount(a.email);
        if (cur) {
          cur.status = "exhausted";
          cur.remaining = 0;
          saveAccount(cur);
        }
        db.exec("COMMIT");
        return { ok: false, code: "exhausted", account: getAccount(a.email) };
      }

      db.exec("COMMIT");
      return { ok: true, account: rowToAccount(result), replay: false };
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    }
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

  function refundFiling(sessionToken, idempotencyKey) {
    const a = accountFromSession(sessionToken, { requireVerified: true });
    if (!a) return;
    db.prepare(
      `UPDATE accounts SET remaining = remaining + 1,
        status = CASE
          WHEN plan = 'trial' THEN 'trialing'
          ELSE 'active'
        END
       WHERE email = ?`,
    ).run(a.email);
    if (idempotencyKey) {
      db.prepare(
        `UPDATE usage_events SET status = 'refunded', response_json = NULL
         WHERE idempotency_key = ? AND status = 'reserved'`,
      ).run(idempotencyKey);
    }
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

  return {
    kind: "sqlite",
    createMagicToken,
    magicRowsForTest,
    writeMagicRowForTest,
    createSession,
    startWithEmail,
    exchangeMagic,
    peekMagic,
    accountFromSession,
    revokeSession,
    revokeAllSessionsForEmail,
    revokeUnverifiedSessionsForEmail,
    bindCheckoutSession,
    promoteCheckoutSession,
    markSessionVerified,
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
    /** @returns {boolean} true if newly claimed */
    claimEvent(eventId) {
      if (!eventId) return false;
      const info = db
        .prepare(
          "INSERT OR IGNORE INTO stripe_events (event_id, processed_at) VALUES (?, ?)",
        )
        .run(eventId, new Date().toISOString());
      return info.changes > 0;
    },
    markEventProcessed(eventId) {
      if (!eventId) return;
      db.prepare(
        "INSERT OR IGNORE INTO stripe_events (event_id, processed_at) VALUES (?, ?)",
      ).run(eventId, new Date().toISOString());
    },
    recordStripeIncident(kind, opts = {}) {
      const n = normalizeStripeIncident(kind, opts);
      const at = new Date(n.now).toISOString();
      const row = db
        .prepare(
          `INSERT INTO stripe_incidents
             (id, kind, day_bucket, stripe_id, email, detail, occurrences, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(kind, day_bucket, stripe_id) DO UPDATE SET
             occurrences = occurrences + 1,
             last_seen_at = excluded.last_seen_at,
             email = COALESCE(excluded.email, email),
             detail = COALESCE(excluded.detail, detail)
           RETURNING *`,
        )
        .get(
          id("inc"),
          n.kind,
          n.dayBucket,
          n.stripeId,
          n.email,
          n.detail,
          at,
          at,
        );
      return rowToIncident(row);
    },
    /** Newest alert epoch ms for this kind at or after `sinceMs`, else null. */
    lastStripeAlertAt(kind, sinceMs = 0) {
      const r = db
        .prepare(
          `SELECT MAX(alerted_at) AS last FROM stripe_incidents
            WHERE kind = ? AND alerted_at IS NOT NULL AND alerted_at >= ?`,
        )
        .get(kind, new Date(sinceMs).toISOString());
      return r?.last ? Date.parse(r.last) : null;
    },
    markStripeIncidentAlerted(incidentId, opts = {}) {
      const now = Number.isFinite(opts.now) ? opts.now : Date.now();
      const row = db
        .prepare(
          "UPDATE stripe_incidents SET alerted_at = ? WHERE id = ? RETURNING *",
        )
        .get(new Date(now).toISOString(), incidentId);
      return rowToIncident(row);
    },
    listStripeIncidents({ since, kind, limit } = {}) {
      const cutoff = new Date(toMs(since, 0)).toISOString();
      const cap = Number.isFinite(limit) ? limit : 100;
      const rows = db
        .prepare(
          `SELECT * FROM stripe_incidents
            WHERE (? IS NULL OR kind = ?) AND last_seen_at >= ?
            ORDER BY last_seen_at DESC, first_seen_at DESC
            LIMIT ?`,
        )
        .all(kind ?? null, kind ?? null, cutoff, cap);
      return rows.map(rowToIncident);
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
    /**
     * Drop the Stripe customer/subscription ids without touching the meter.
     * Used when the stored id is wrong-mode or deleted (#408).
     */
    clearStripeBillingLink(email) {
      const a = ensureAccount(email);
      const old = a.stripeCustomerId;
      a.stripeCustomerId = undefined;
      a.stripeSubscriptionId = undefined;
      saveAccount(a);
      if (old) {
        db.prepare("DELETE FROM stripe_customers WHERE customer_id = ?").run(
          old,
        );
      }
      db.prepare("DELETE FROM stripe_customers WHERE email = ?").run(a.email);
      return a;
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
      ask.mcpRevokeForEmail(a.email);
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
    ...ask,
  };
}
