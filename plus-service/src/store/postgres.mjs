/**
 * Managed Postgres store (KTD-B1). Multi-instance safe meter + ledger.
 * Requires DATABASE_URL. Uses `pg` Pool.
 */
import pg from "pg";
import { config } from "../config.mjs";
import {
  applyStatusRules,
  CHECKOUT_BINDING_TTL_MS,
  hashToken,
  id,
  isEntitledAccount,
  periodEndFromNow,
  publicAccount,
  rowToAccount,
} from "./shared.mjs";
import {
  ASK_PG_DDL,
  createAskPostgresMethods,
} from "./askPostgresMethods.mjs";

const { Pool } = pg;

const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  remaining INTEGER NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  plan TEXT NOT NULL,
  promo_redemptions INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT
);
CREATE TABLE IF NOT EXISTS magic_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  exp_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  exp_ms BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  verified BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS checkout_bindings (
  checkout_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  exp_ms BIGINT NOT NULL
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
  processed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS stripe_customers (
  customer_id TEXT PRIMARY KEY,
  email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_events (
  idempotency_key TEXT PRIMARY KEY,
  email TEXT,
  status TEXT NOT NULL,
  response_json JSONB,
  remaining INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
${ASK_PG_DDL}
`;

/**
 * @param {string} databaseUrl
 */
export async function createPostgresStore(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL required for postgres store");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(MIGRATE_SQL);
  // Existing DBs created before verified column
  await pool.query(
    `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE`,
  );

  const sessionTtlMs = () => config.sessionTtlDays * 24 * 60 * 60 * 1000;

  async function getAccount(email) {
    const key = email.trim().toLowerCase();
    const { rows } = await pool.query(
      "SELECT * FROM accounts WHERE email = $1",
      [key],
    );
    return rowToAccount(rows[0]);
  }

  async function ensureAccount(email) {
    const key = email.trim().toLowerCase();
    let a = await getAccount(key);
    if (!a) {
      await pool.query(
        `INSERT INTO accounts (email, status, remaining, period_end, plan, promo_redemptions)
         VALUES ($1, 'inactive', 0, $2, 'trial', 0)
         ON CONFLICT (email) DO NOTHING`,
        [key, new Date().toISOString()],
      );
      a = await getAccount(key);
    }
    return a;
  }

  async function saveAccount(a) {
    await pool.query(
      `UPDATE accounts SET status=$1, remaining=$2, period_end=$3, plan=$4,
        promo_redemptions=$5, stripe_customer_id=$6, stripe_subscription_id=$7
       WHERE email=$8`,
      [
        a.status,
        a.remaining,
        a.periodEnd,
        a.plan,
        a.promoRedemptions ?? 0,
        a.stripeCustomerId ?? null,
        a.stripeSubscriptionId ?? null,
        a.email,
      ],
    );
    return a;
  }

  async function refreshAccountStatus(a) {
    if (!a) return a;
    const { dirty } = applyStatusRules(a);
    if (dirty) await saveAccount(a);
    return a;
  }

  const ask = createAskPostgresMethods(pool, {
    getAccount,
    refreshAccountStatus,
  });

  async function grantPeriod(email, opts = {}) {
    const a = await ensureAccount(email);
    a.status = opts.status ?? "active";
    a.plan = opts.plan ?? "monthly";
    a.remaining = opts.remaining ?? config.includedFilings;
    a.periodEnd = periodEndFromNow(opts.days ?? 30);
    const saved = await saveAccount(a);
    await revokeUnverifiedSessionsForEmail(saved.email);
    return saved;
  }

  /** Atomic top-up — avoids lost updates under concurrent webhooks. */
  async function addTopUp(email, n = config.topUpFilings) {
    await ensureAccount(email);
    const { rows } = await pool.query(
      `UPDATE accounts SET
         remaining = remaining + $2,
         status = CASE
           WHEN status IN ('exhausted', 'inactive') THEN 'active'
           ELSE status
         END
       WHERE email = $1
       RETURNING *`,
      [email.trim().toLowerCase(), n],
    );
    return rowToAccount(rows[0]);
  }

  async function createMagicToken(email) {
    const token = id("mt");
    await pool.query(
      "INSERT INTO magic_tokens (token, email, exp_ms) VALUES ($1, $2, $3)",
      [token, email.trim().toLowerCase(), Date.now() + 15 * 60 * 1000],
    );
    return token;
  }

  /**
   * @param {string} email
   * @param {{ verified?: boolean }} [opts]
   */
  async function createSession(email, opts = {}) {
    const key = email.trim().toLowerCase();
    const session = id("sess");
    const verified = opts.verified !== false;
    await pool.query(
      "INSERT INTO sessions (token_hash, email, exp_ms, revoked, verified) VALUES ($1, $2, $3, FALSE, $4)",
      [hashToken(session), key, Date.now() + sessionTtlMs(), verified],
    );
    return session;
  }

  async function revokeAllSessionsForEmail(email) {
    await pool.query(
      "UPDATE sessions SET revoked = TRUE WHERE email = $1",
      [email.trim().toLowerCase()],
    );
  }

  async function revokeUnverifiedSessionsForEmail(email) {
    await pool.query(
      "UPDATE sessions SET revoked = TRUE WHERE email = $1 AND verified = FALSE",
      [email.trim().toLowerCase()],
    );
  }

  /**
   * Remember which plugin session opened this Stripe Checkout. The webhook that
   * grants the trial has no session context of its own, and grantPeriod revokes
   * every unverified session for the email — without this binding the paying
   * user's session dies and never comes back (#230). Only the hash is stored,
   * same as sessions.
   */
  async function bindCheckoutSession(checkoutId, email, sessionToken) {
    if (!checkoutId || !sessionToken) return false;
    await pool.query(
      `INSERT INTO checkout_bindings (checkout_id, email, session_hash, exp_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (checkout_id) DO UPDATE
         SET email = EXCLUDED.email,
             session_hash = EXCLUDED.session_hash,
             exp_ms = EXCLUDED.exp_ms`,
      [
        String(checkoutId),
        email.trim().toLowerCase(),
        hashToken(sessionToken),
        Date.now() + CHECKOUT_BINDING_TTL_MS,
      ],
    );
    return true;
  }

  /**
   * Single-use: re-verify the one session that paid for this checkout, undoing
   * grantPeriod's revoke for it alone. A soft session that never opened checkout
   * has no binding and stays revoked — that is the C1 fixation case (#163).
   */
  async function promoteCheckoutSession(checkoutId, email) {
    if (!checkoutId) return false;
    const csId = String(checkoutId);
    const key = String(email || "")
      .trim()
      .toLowerCase();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM checkout_bindings WHERE checkout_id = $1 FOR UPDATE",
        [csId],
      );
      const row = rows[0];
      if (!row || row.email !== key || Date.now() > Number(row.exp_ms)) {
        await client.query("ROLLBACK");
        return false;
      }
      const r = await client.query(
        `UPDATE sessions SET verified = TRUE, revoked = FALSE
         WHERE token_hash = $1 AND exp_ms > $2
         RETURNING token_hash`,
        [row.session_hash, Date.now()],
      );
      await client.query(
        "DELETE FROM checkout_bindings WHERE checkout_id = $1",
        [csId],
      );
      await client.query("COMMIT");
      return Boolean(r.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Promote soft session after checkout; clears revoke from grantPeriod. */
  async function markSessionVerified(sessionToken) {
    if (!sessionToken) return false;
    const r = await pool.query(
      `UPDATE sessions SET verified = TRUE, revoked = FALSE
       WHERE token_hash = $1 AND exp_ms > $2
       RETURNING token_hash`,
      [hashToken(sessionToken), Date.now()],
    );
    return Boolean(r.rows[0]);
  }

  async function startWithEmail(email) {
    let a = await ensureAccount(email);
    a = await refreshAccountStatus(a);
    if (isEntitledAccount(a)) {
      return { ok: false, needsMagicLink: true, account: a };
    }
    const session = await createSession(a.email, { verified: false });
    return { ok: true, session, account: a };
  }

  async function exchangeMagic(token) {
    const client = await pool.connect();
    let email;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM magic_tokens WHERE token = $1 FOR UPDATE",
        [token],
      );
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      email = row.email;
      await client.query("DELETE FROM magic_tokens WHERE token = $1", [token]);
      if (Date.now() > Number(row.exp_ms)) {
        await client.query("COMMIT");
        return null;
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    let a = await ensureAccount(email);
    if (
      config.dogfoodAutoGrant &&
      (a.status === "inactive" || a.remaining <= 0)
    ) {
      const st =
        config.dogfoodGrantStatus === "active" ? "active" : "trialing";
      a = await grantPeriod(email, {
        status: st,
        plan: st === "trialing" ? "trial" : "monthly",
        days: st === "trialing" ? config.trialDays : 30,
        remaining: config.includedFilings,
      });
    }
    a = await refreshAccountStatus(a);
    await revokeAllSessionsForEmail(email);
    const session = await createSession(email, { verified: true });
    return { session, account: a };
  }

  /**
   * @param {string} sessionToken
   * @param {{ requireVerified?: boolean }} [opts]
   */
  async function accountFromSession(sessionToken, opts = {}) {
    if (!sessionToken) return null;
    const { rows } = await pool.query(
      "SELECT * FROM sessions WHERE token_hash = $1",
      [hashToken(sessionToken)],
    );
    const row = rows[0];
    if (!row || row.revoked || Date.now() > Number(row.exp_ms)) return null;
    if (opts.requireVerified && row.verified === false) return null;
    return refreshAccountStatus(await getAccount(row.email));
  }

  async function revokeSession(sessionToken) {
    await pool.query(
      "UPDATE sessions SET revoked = TRUE WHERE token_hash = $1",
      [hashToken(sessionToken)],
    );
  }

  /**
   * Atomic consume + idempotent replay (KTD-B5).
   * 1) If key has status=ok + response_json → replay (no second decrement)
   * 2) INSERT reserved row; on conflict reserved → treat as in-flight / fail safe
   * 3) UPDATE remaining WHERE remaining > 0 RETURNING
   * 4) On 0 rows → delete reserved, exhausted
   * Tenant: never replay another email's idempotency row (C2).
   */
  async function tryConsumeFiling(sessionToken, idempotencyKey) {
    const a0 = await accountFromSession(sessionToken, { requireVerified: true });
    if (!a0) return { ok: false, code: "auth" };
    if (a0.status === "inactive") return { ok: false, code: "auth" };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (idempotencyKey) {
        const prev = await client.query(
          "SELECT * FROM usage_events WHERE idempotency_key = $1 FOR UPDATE",
          [idempotencyKey],
        );
        const row = prev.rows[0];
        if (row && row.email && row.email !== a0.email) {
          await client.query("COMMIT");
          return { ok: false, code: "idempotency_conflict" };
        }
        if (row && row.status === "ok" && row.response_json != null) {
          await client.query("COMMIT");
          const responseJson =
            typeof row.response_json === "string"
              ? JSON.parse(row.response_json)
              : row.response_json;
          return {
            ok: true,
            replay: true,
            account: await accountFromSession(sessionToken, {
              requireVerified: true,
            }),
            cached: {
              responseJson,
              remaining: row.remaining,
              status: "ok",
            },
          };
        }
        if (row && row.status === "reserved") {
          // In-flight same key — do not double-charge
          await client.query("COMMIT");
          return {
            ok: false,
            code: "in_flight",
            account: await getAccount(a0.email),
          };
        }
        if (row && row.status === "refunded") {
          // Prior attempt failed and refunded — reclaim key for a new attempt
          await client.query(
            `UPDATE usage_events SET status = 'reserved', response_json = NULL,
              remaining = NULL, email = $2, created_at = NOW()
             WHERE idempotency_key = $1`,
            [idempotencyKey, a0.email],
          );
        } else if (!row) {
          await client.query(
            `INSERT INTO usage_events (idempotency_key, email, status, created_at)
             VALUES ($1, $2, 'reserved', NOW())`,
            [idempotencyKey, a0.email],
          );
        }
      }

      const upd = await client.query(
        `UPDATE accounts SET remaining = remaining - 1,
          status = CASE WHEN remaining - 1 <= 0 THEN 'exhausted' ELSE status END
         WHERE email = $1 AND remaining > 0 AND status IN ('active','trialing','unknown')
         RETURNING *`,
        [a0.email],
      );

      if (!upd.rows[0]) {
        if (idempotencyKey) {
          await client.query(
            "DELETE FROM usage_events WHERE idempotency_key = $1 AND status = 'reserved'",
            [idempotencyKey],
          );
        }
        await client.query(
          `UPDATE accounts SET status = 'exhausted', remaining = 0
           WHERE email = $1 AND remaining <= 0`,
          [a0.email],
        );
        await client.query("COMMIT");
        return {
          ok: false,
          code: "exhausted",
          account: await getAccount(a0.email),
        };
      }

      await client.query("COMMIT");
      return { ok: true, account: rowToAccount(upd.rows[0]), replay: false };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      // Unique violation on idempotency insert → retry as replay path
      if (e && e.code === "23505" && idempotencyKey) {
        return tryConsumeFiling(sessionToken, idempotencyKey);
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async function completeUsage(idempotencyKey, payload) {
    if (!idempotencyKey) return;
    await pool.query(
      `INSERT INTO usage_events (idempotency_key, email, status, response_json, remaining, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
       ON CONFLICT (idempotency_key) DO UPDATE SET
         status = EXCLUDED.status,
         response_json = EXCLUDED.response_json,
         remaining = EXCLUDED.remaining`,
      [
        idempotencyKey,
        payload.email ?? null,
        payload.status ?? "ok",
        JSON.stringify(payload.responseJson ?? null),
        payload.remaining ?? null,
      ],
    );
  }

  /**
   * Refund a failed classify. Clears reserved idempotency row so the same
   * Idempotency-Key can retry (otherwise stuck in_flight forever).
   * @param {string} sessionToken
   * @param {string} [idempotencyKey]
   */
  async function refundFiling(sessionToken, idempotencyKey) {
    const a = await accountFromSession(sessionToken, { requireVerified: true });
    if (!a) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE accounts SET remaining = remaining + 1,
          status = CASE
            WHEN plan = 'trial' THEN 'trialing'
            ELSE 'active'
          END
         WHERE email = $1`,
        [a.email],
      );
      if (idempotencyKey) {
        await client.query(
          `UPDATE usage_events SET status = 'refunded', response_json = NULL
           WHERE idempotency_key = $1 AND status = 'reserved'`,
          [idempotencyKey],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function redeemPromo(email, code) {
    const upper = code.trim().toUpperCase();
    const months = config.promoCodes.get(upper);
    if (!months) return { ok: false, message: "Invalid promo code" };
    const em = email.trim().toLowerCase();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT 1 FROM promo_email WHERE email = $1 AND code = $2",
        [em, upper],
      );
      if (existing.rows[0]) {
        await client.query("ROLLBACK");
        return { ok: false, message: "Promo already redeemed on this account" };
      }
      await client.query(
        `INSERT INTO promo_global (code, uses) VALUES ($1, 0)
         ON CONFLICT (code) DO NOTHING`,
        [upper],
      );
      const g = await client.query(
        "SELECT uses FROM promo_global WHERE code = $1 FOR UPDATE",
        [upper],
      );
      if ((g.rows[0]?.uses ?? 0) >= config.promoMaxRedemptions) {
        await client.query("ROLLBACK");
        return { ok: false, message: "Promo code fully redeemed" };
      }
      await client.query(
        "UPDATE promo_global SET uses = uses + 1 WHERE code = $1",
        [upper],
      );
      await client.query(
        "INSERT INTO promo_email (email, code) VALUES ($1, $2)",
        [em, upper],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    const a = await grantPeriod(email, {
      status: "active",
      plan: "promo",
      days: months * 30,
      remaining: config.includedFilings,
    });
    a.promoRedemptions += 1;
    await saveAccount(a);
    return { ok: true, account: a, months };
  }

  return {
    kind: "postgres",
    createMagicToken,
    createSession,
    startWithEmail,
    exchangeMagic,
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
    async hasProcessedEvent(eventId) {
      const { rows } = await pool.query(
        "SELECT 1 FROM stripe_events WHERE event_id = $1",
        [eventId],
      );
      return Boolean(rows[0]);
    },
    /**
     * Claim event id before granting. Returns true if this caller owns the event
     * (insert succeeded). False = already claimed (duplicate).
     */
    async claimEvent(eventId) {
      if (!eventId) return false;
      const r = await pool.query(
        `INSERT INTO stripe_events (event_id, processed_at) VALUES ($1, NOW())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId],
      );
      return Boolean(r.rows[0]);
    },
    async markEventProcessed(eventId) {
      if (!eventId) return;
      await pool.query(
        `INSERT INTO stripe_events (event_id, processed_at) VALUES ($1, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId],
      );
    },
    async setStripeCustomer(email, customerId) {
      const a = await ensureAccount(email);
      a.stripeCustomerId = customerId;
      await saveAccount(a);
      await pool.query(
        `INSERT INTO stripe_customers (customer_id, email) VALUES ($1, $2)
         ON CONFLICT (customer_id) DO UPDATE SET email = EXCLUDED.email`,
        [customerId, a.email],
      );
      return a;
    },
    async setStripeSubscription(email, subId) {
      const a = await ensureAccount(email);
      a.stripeSubscriptionId = subId;
      return saveAccount(a);
    },
    async emailFromStripeCustomer(customerId) {
      const { rows } = await pool.query(
        "SELECT email FROM stripe_customers WHERE customer_id = $1",
        [customerId],
      );
      return rows[0]?.email ?? null;
    },
    async revokeSubscription(email) {
      const a = await ensureAccount(email);
      a.stripeSubscriptionId = undefined;
      await ask.mcpRevokeForEmail(a.email);
      if (a.remaining > 0) a.status = "active";
      else {
        a.status = "inactive";
        a.remaining = 0;
      }
      return saveAccount(a);
    },
    async close() {
      await pool.end();
    },
    ...ask,
  };
}
