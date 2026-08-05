/**
 * In-memory store (tests + explicit ATOMS_PLUS_STORE=memory).
 */
import { config } from "../config.mjs";
import {
  applyStatusRules,
  CHECKOUT_BINDING_TTL_MS,
  hashToken,
  id,
  isEntitledAccount,
  MAGIC_PEEK_MISS,
  normalizeStripeIncident,
  periodEndFromNow,
  publicAccount,
  rowToIncident,
  toMs,
} from "./shared.mjs";
import {
  aggregateMirrorTags,
  buildNeighborsGraph,
  buildSearchHits,
  normEmail,
  paginateMirrorList,
  prepareMirrorRow,
  rowToPublicAtom,
  verifyPkce,
  OUTBOX_STALE_MS,
  OUTBOX_MAX_OPEN,
  encryptOutboxPayload,
  decryptOutboxPayload,
  publicOutboxRow,
  assertMirrorPath,
  generatePairCode,
  normalizePairCodeInput,
  PAIR_CODE_TTL_MS,
} from "./askHelpers.mjs";

export function createMemoryStore() {
  const accounts = new Map();
  const magicTokens = new Map();
  /** tokenHash → { email, exp, revoked } */
  const sessions = new Map();
  /** stripe checkout id → { email, sessionHash, exp } */
  const checkoutBindings = new Map();
  const promoUses = new Map();
  /** email+code → true */
  const promoByEmail = new Set();
  const processedEvents = new Set();
  /** `kind|dayBucket|stripeId` → stripe incident row (#238 KTD2) */
  const stripeIncidents = new Map();
  const stripeCustomers = new Map();
  /** idempotency_key → { responseJson, remaining, status } */
  const usageByKey = new Map();
  /** email → Map<path, row> */
  const atomMirror = new Map();
  /** email → Map<id, outbox row> */
  const askOutbox = new Map();
  /** pending_id → pending oauth */
  const mcpPending = new Map();
  /** code_hash → auth code row */
  const mcpAuthCodes = new Map();
  /** token_hash → access */
  const mcpAccess = new Map();
  /** token_hash → refresh */
  const mcpRefresh = new Map();
  /** client_id → client */
  const mcpClients = new Map();
  /** browser session id → { email, exp } */
  const mcpBrowserSessions = new Map();
  /** email → { codeHash, expMs, consumedMs } */
  const mcpPairCodes = new Map();

  const sessionTtlMs = () => config.sessionTtlDays * 24 * 60 * 60 * 1000;

  function getAccount(email) {
    return accounts.get(email.trim().toLowerCase()) ?? null;
  }

  function ensureAccount(email) {
    const key = email.trim().toLowerCase();
    let a = accounts.get(key);
    if (!a) {
      a = {
        email: key,
        status: "inactive",
        remaining: 0,
        periodEnd: new Date().toISOString(),
        plan: "trial",
        promoRedemptions: 0,
      };
      accounts.set(key, a);
    }
    return a;
  }

  function refreshAccountStatus(a) {
    applyStatusRules(a);
    return a;
  }

  function grantPeriod(email, opts = {}) {
    const a = ensureAccount(email);
    a.status = opts.status ?? "active";
    a.plan = opts.plan ?? "monthly";
    a.remaining = opts.remaining ?? config.includedFilings;
    a.periodEnd = periodEndFromNow(opts.days ?? 30);
    // Soft-start sessions must not survive privilege upgrade (C1).
    revokeUnverifiedSessionsForEmail(a.email);
    return a;
  }

  /**
   * @param {string} email
   * @param {{ verifierHash?: string, vault?: string }} [opts] #240 U1 — the
   *   requesting device's verifier hash (R12) and the requesting vault's name
   *   (R3). Both optional: a caller that passes neither still works.
   */
  function createMagicToken(email, opts = {}) {
    const token = id("mt");
    // KTD14 — key on the hash, exactly as sessions are. The plaintext token
    // only ever exists in the email and in the caller's hand.
    magicTokens.set(hashToken(token), {
      email: email.trim().toLowerCase(),
      exp: Date.now() + 15 * 60 * 1000,
      verifierHash: opts.verifierHash || null,
      vault: opts.vault || null,
    });
    return token;
  }

  /**
   * @param {string} email
   * @param {{ verified?: boolean }} [opts] verified=false for soft-start (no email proof)
   */
  function createSession(email, opts = {}) {
    const key = email.trim().toLowerCase();
    const session = id("sess");
    sessions.set(hashToken(session), {
      email: key,
      exp: Date.now() + sessionTtlMs(),
      revoked: false,
      verified: opts.verified !== false,
    });
    return session;
  }

  function revokeAllSessionsForEmail(email) {
    const key = email.trim().toLowerCase();
    for (const row of sessions.values()) {
      if (row.email === key) row.revoked = true;
    }
  }

  function revokeUnverifiedSessionsForEmail(email) {
    const key = email.trim().toLowerCase();
    for (const row of sessions.values()) {
      if (row.email === key && !row.verified) row.revoked = true;
    }
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
    checkoutBindings.set(String(checkoutId), {
      email: email.trim().toLowerCase(),
      sessionHash: hashToken(sessionToken),
      exp: Date.now() + CHECKOUT_BINDING_TTL_MS,
    });
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
    const bound = checkoutBindings.get(String(checkoutId));
    if (!bound || bound.email !== key || Date.now() > bound.exp) return false;
    checkoutBindings.delete(String(checkoutId));
    const row = sessions.get(bound.sessionHash);
    if (!row || Date.now() > row.exp) return false;
    row.verified = true;
    row.revoked = false;
    return true;
  }

  /** Promote soft session after checkout; clears revoke from grantPeriod. */
  function markSessionVerified(sessionToken) {
    if (!sessionToken) return false;
    const row = sessions.get(hashToken(sessionToken));
    if (!row || Date.now() > row.exp) return false;
    row.verified = true;
    row.revoked = false;
    return true;
  }

  /**
   * Soft start: mint unverified sess_ only for non-entitled inactive accounts.
   * @returns {{ ok: true, session: string, account: object } | { ok: false, needsMagicLink: true, account: object }}
   */
  function startWithEmail(email) {
    const a = refreshAccountStatus(ensureAccount(email));
    if (isEntitledAccount(a)) {
      return { ok: false, needsMagicLink: true, account: a };
    }
    const session = createSession(a.email, { verified: false });
    return { ok: true, session, account: a };
  }

  function exchangeMagic(token) {
    const key = hashToken(token);
    const row = magicTokens.get(key);
    if (!row) return null;
    if (Date.now() > row.exp) {
      magicTokens.delete(key);
      return null;
    }
    magicTokens.delete(key);
    const a = ensureAccount(row.email);
    if (
      config.dogfoodAutoGrant &&
      (a.status === "inactive" || a.remaining <= 0)
    ) {
      const st =
        config.dogfoodGrantStatus === "active" ? "active" : "trialing";
      grantPeriod(row.email, {
        status: st,
        plan: st === "trialing" ? "trial" : "monthly",
        days: st === "trialing" ? config.trialDays : 30,
        remaining: config.includedFilings,
      });
    }
    refreshAccountStatus(a);
    revokeAllSessionsForEmail(row.email);
    const session = createSession(row.email, { verified: true });
    return { session, account: a, vault: row.vault ?? null };
  }

  /**
   * #240 U2 — answer whether a magic token is usable without spending it (R6,
   * R9). Read-only by construction: an expired row reports expired and is left
   * where it is, because KTD13 puts the sweep on the mint path precisely so a
   * check can never be weaponised into a delete.
   *
   * @param {string} token
   * @returns {MagicPeek}
   */
  function peekMagic(token) {
    const row = magicTokens.get(hashToken(token));
    if (!row) return MAGIC_PEEK_MISS.invalid;
    if (Date.now() > row.exp) return MAGIC_PEEK_MISS.expired;
    return {
      ok: true,
      status: "usable",
      email: row.email,
      vault: row.vault ?? null,
      verifierBound: !!row.verifierHash,
      verifierHash: row.verifierHash ?? null,
    };
  }

  function magicRowsForTest() {
    return [...magicTokens].map(([key, r]) => ({
      key,
      email: r.email,
      expMs: r.exp,
      verifierHash: r.verifierHash ?? null,
      vault: r.vault ?? null,
    }));
  }

  function writeMagicRowForTest(key, row) {
    magicTokens.set(key, {
      email: String(row.email).trim().toLowerCase(),
      exp: Number(row.expMs),
      verifierHash: row.verifierHash || null,
      vault: row.vault || null,
    });
  }

  /**
   * @param {string} sessionToken
   * @param {{ requireVerified?: boolean }} [opts]
   */
  function accountFromSession(sessionToken, opts = {}) {
    if (!sessionToken) return null;
    const row = sessions.get(hashToken(sessionToken));
    if (!row || row.revoked || Date.now() > row.exp) return null;
    if (opts.requireVerified && !row.verified) return null;
    return refreshAccountStatus(getAccount(row.email));
  }

  function revokeSession(sessionToken) {
    const h = hashToken(sessionToken);
    const row = sessions.get(h);
    if (row) row.revoked = true;
  }

  function tryConsumeFiling(sessionToken, idempotencyKey) {
    const a = accountFromSession(sessionToken, { requireVerified: true });
    if (!a) return { ok: false, code: "auth" };
    if (a.status === "inactive") return { ok: false, code: "auth" };

    if (idempotencyKey && usageByKey.has(idempotencyKey)) {
      const prev = usageByKey.get(idempotencyKey);
      if (prev?.email && prev.email !== a.email) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (prev?.status === "ok" && prev.responseJson) {
        return {
          ok: true,
          replay: true,
          account: a,
          cached: prev,
        };
      }
      if (prev?.status === "refunded") {
        usageByKey.delete(idempotencyKey);
      } else if (prev?.status === "reserved") {
        return {
          ok: false,
          code: "in_flight",
          account: a,
        };
      }
    }
    if (a.status === "exhausted" || a.remaining <= 0) {
      a.status = "exhausted";
      a.remaining = 0;
      return { ok: false, code: "exhausted", account: a };
    }
    a.remaining -= 1;
    if (a.remaining <= 0) {
      a.status = "exhausted";
      a.remaining = 0;
    }
    if (idempotencyKey) {
      usageByKey.set(idempotencyKey, { status: "reserved", email: a.email });
    }
    return { ok: true, account: a, replay: false };
  }

  function completeUsage(idempotencyKey, payload) {
    if (!idempotencyKey) return;
    usageByKey.set(idempotencyKey, {
      ...payload,
      email: payload.email ?? usageByKey.get(idempotencyKey)?.email,
    });
  }

  function refundFiling(sessionToken, idempotencyKey) {
    const a = accountFromSession(sessionToken, { requireVerified: true });
    if (!a) return;
    a.remaining += 1;
    if (a.status === "exhausted" && a.remaining > 0) {
      a.status = a.plan === "trial" ? "trialing" : "active";
    }
    if (idempotencyKey && usageByKey.has(idempotencyKey)) {
      const prev = usageByKey.get(idempotencyKey);
      if (prev?.status !== "ok") {
        usageByKey.set(idempotencyKey, {
          status: "refunded",
          email: prev?.email ?? a.email,
        });
      }
    }
  }

  function addTopUp(email, n = config.topUpFilings) {
    const a = ensureAccount(email);
    a.remaining += n;
    if (a.status === "exhausted" || a.status === "inactive") a.status = "active";
    return a;
  }

  function redeemPromo(email, code) {
    const upper = code.trim().toUpperCase();
    const months = config.promoCodes.get(upper);
    if (!months) return { ok: false, message: "Invalid promo code" };
    const ek = `${email.trim().toLowerCase()}::${upper}`;
    if (promoByEmail.has(ek)) {
      return { ok: false, message: "Promo already redeemed on this account" };
    }
    const used = promoUses.get(upper) ?? 0;
    if (used >= config.promoMaxRedemptions) {
      return { ok: false, message: "Promo code fully redeemed" };
    }
    promoUses.set(upper, used + 1);
    promoByEmail.add(ek);
    const a = grantPeriod(email, {
      status: "active",
      plan: "promo",
      days: months * 30,
      remaining: config.includedFilings,
    });
    a.promoRedemptions += 1;
    return { ok: true, account: a, months };
  }

  function mirrorBucket(email) {
    const e = normEmail(email);
    let m = atomMirror.get(e);
    if (!m) {
      m = new Map();
      atomMirror.set(e, m);
    }
    return m;
  }

  function mirrorUpsert(email, atoms) {
    const list = Array.isArray(atoms) ? atoms : [];
    let upserted = 0;
    let skipped = 0;
    for (const atom of list) {
      const row = prepareMirrorRow(email, atom);
      const bucket = mirrorBucket(row.email);
      const prev = bucket.get(row.path);
      if (prev && prev.contentHash === row.contentHash) {
        skipped += 1;
        continue;
      }
      // Preserve backfilled created when client omits it (older plugin / multi-device).
      if (row.created == null && prev?.created != null) {
        row.created = prev.created;
      }
      bucket.set(row.path, row);
      upserted += 1;
    }
    return { upserted, skipped };
  }

  function mirrorFetch(email, idOrTitle) {
    const e = normEmail(email);
    const key = String(idOrTitle || "").trim();
    if (!key) return null;
    const bucket = atomMirror.get(e);
    if (!bucket) return null;
    for (const row of bucket.values()) {
      if (
        row.path === key ||
        row.atomId === key ||
        row.title === key ||
        row.title.toLowerCase() === key.toLowerCase()
      ) {
        return rowToPublicAtom(row, { includeBody: true });
      }
    }
    return null;
  }

  function mirrorSearch(email, query, limit = 8, opts = {}) {
    const e = normEmail(email);
    const bucket = atomMirror.get(e);
    if (!bucket) return [];
    const pubs = [...bucket.values()].map((row) =>
      rowToPublicAtom(row, { includeBody: true }),
    );
    return buildSearchHits(pubs, query, limit, opts);
  }

  /** Outgoing links + atoms that link to this title (backlinks). */
  function mirrorNeighbors(email, idOrTitle) {
    const e = normEmail(email);
    const bucket = atomMirror.get(e);
    if (!bucket) return null;
    const center = mirrorFetch(email, idOrTitle);
    const pubs = [...bucket.values()].map((row) =>
      rowToPublicAtom(row, { includeBody: true }),
    );
    return buildNeighborsGraph(center, idOrTitle, pubs);
  }

  function mirrorWipe(email) {
    const e = normEmail(email);
    atomMirror.delete(e);
    askOutbox.delete(e);
    mcpRevokeForEmail(e);
    return { ok: true };
  }

  function mirrorDelete(email, paths) {
    const e = normEmail(email);
    const list = Array.isArray(paths) ? paths : [];
    const bucket = atomMirror.get(e);
    let deleted = 0;
    let missing = 0;
    for (const raw of list) {
      const checked = assertMirrorPath(raw);
      if (!checked.ok) continue;
      if (!bucket || !bucket.has(checked.path)) {
        missing += 1;
        continue;
      }
      bucket.delete(checked.path);
      deleted += 1;
    }
    const st = mirrorStatus(e);
    return { deleted, missing, ...st };
  }

  function mirrorReconcileKeep(email, keepPaths) {
    const e = normEmail(email);
    const keep = new Set();
    for (const raw of Array.isArray(keepPaths) ? keepPaths : []) {
      const checked = assertMirrorPath(raw);
      if (checked.ok) keep.add(checked.path);
    }
    const bucket = atomMirror.get(e);
    let deleted = 0;
    if (bucket) {
      for (const path of [...bucket.keys()]) {
        if (!keep.has(path)) {
          bucket.delete(path);
          deleted += 1;
        }
      }
    }
    const st = mirrorStatus(e);
    return { deleted, ...st };
  }

  function outboxBucket(email) {
    const e = normEmail(email);
    let m = askOutbox.get(e);
    if (!m) {
      m = new Map();
      askOutbox.set(e, m);
    }
    return m;
  }

  function outboxOpenCount(email) {
    const bucket = askOutbox.get(normEmail(email));
    if (!bucket) return 0;
    let n = 0;
    for (const r of bucket.values()) {
      if (r.status === "pending" || r.status === "claimed") n++;
    }
    return n;
  }

  function outboxPublic(r) {
    if (!r) return null;
    return publicOutboxRow({
      id: r.id,
      kind: r.kind,
      status: r.status,
      payload: decryptOutboxPayload(r.payload_enc),
      error: r.error,
      client_request_id: r.client_request_id,
      created_at: r.created_at,
      claimed_at: r.claimed_at,
      applied_at: r.applied_at,
    });
  }

  function outboxEnqueue(email, opts) {
    const e = normEmail(email);
    const kind = opts.kind === "continue" ? "continue" : "create";
    const crid = opts.client_request_id
      ? String(opts.client_request_id).trim().slice(0, 128)
      : "";
    const bucket = outboxBucket(e);
    if (crid) {
      for (const r of bucket.values()) {
        if (r.client_request_id === crid) {
          return { ok: true, ...outboxPublic(r), duplicate: true };
        }
      }
    }
    if (outboxOpenCount(e) >= OUTBOX_MAX_OPEN) {
      return { ok: false, error: "outbox_full" };
    }
    const row = {
      id: id("obx"),
      email: e,
      kind,
      payload_enc: encryptOutboxPayload(opts.payload),
      status: "pending",
      client_request_id: crid || null,
      error: null,
      created_at: new Date().toISOString(),
      claimed_at: null,
      applied_at: null,
    };
    bucket.set(row.id, row);
    return { ok: true, ...outboxPublic(row), duplicate: false };
  }

  function outboxReclaimStale(email) {
    const bucket = askOutbox.get(normEmail(email));
    if (!bucket) return;
    const cutoff = Date.now() - OUTBOX_STALE_MS;
    for (const r of bucket.values()) {
      if (
        r.status === "claimed" &&
        r.claimed_at &&
        new Date(r.claimed_at).getTime() < cutoff
      ) {
        r.status = "pending";
        r.claimed_at = null;
      }
    }
  }

  function outboxPull(email, opts = {}) {
    const e = normEmail(email);
    outboxReclaimStale(e);
    const lim = Math.min(Math.max(Number(opts.limit) || 1, 1), 10);
    const bucket = outboxBucket(e);
    const pending = [...bucket.values()]
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, lim);
    const now = new Date().toISOString();
    const items = [];
    for (const r of pending) {
      r.status = "claimed";
      r.claimed_at = now;
      items.push(outboxPublic(r));
    }
    let pending_count = 0;
    let claimed_count = 0;
    for (const r of bucket.values()) {
      if (r.status === "pending") pending_count++;
      if (r.status === "claimed") claimed_count++;
    }
    return { items, pending_count, claimed_count };
  }

  function outboxAck(email, opts) {
    const e = normEmail(email);
    const oid = String(opts.id || "").trim();
    const st = opts.status === "rejected" ? "rejected" : "applied";
    if (!oid) return { ok: false, error: "id required" };
    const bucket = askOutbox.get(e);
    const row = bucket?.get(oid);
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "applied" || row.status === "rejected") {
      return { ok: true, ...outboxPublic(row), already: true };
    }
    row.status = st;
    row.error = opts.error ? String(opts.error).slice(0, 500) : null;
    row.applied_at = new Date().toISOString();
    return { ok: true, ...outboxPublic(row) };
  }

  function outboxGet(email, outboxId) {
    const e = normEmail(email);
    const row = askOutbox.get(e)?.get(String(outboxId || ""));
    return outboxPublic(row);
  }

  function outboxPendingCount(email) {
    outboxReclaimStale(email);
    return outboxOpenCount(email);
  }

  function outboxCancel(email, outboxId) {
    const e = normEmail(email);
    const oid = String(outboxId || "").trim();
    if (!oid) return { ok: false, error: "id required" };
    const row = askOutbox.get(e)?.get(oid);
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "applied" || row.status === "rejected") {
      return { ok: false, error: "already_terminal", status: row.status };
    }
    row.status = "rejected";
    row.error = "cancelled";
    row.applied_at = new Date().toISOString();
    return { ok: true, ...outboxPublic(row) };
  }

  /** Non-terminal outbox rows (pending + claimed), read-only — no claim. */
  function outboxListOpen(email) {
    const e = normEmail(email);
    outboxReclaimStale(e);
    const bucket = askOutbox.get(e);
    if (!bucket) return [];
    return [...bucket.values()]
      .filter((r) => r.status === "pending" || r.status === "claimed")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((r) => outboxPublic(r));
  }

  function outboxHasOpenTitle(email, title) {
    const e = normEmail(email);
    const want = String(title || "").trim().toLowerCase();
    if (!want) return false;
    outboxReclaimStale(e);
    const bucket = askOutbox.get(e);
    if (!bucket) return false;
    for (const r of bucket.values()) {
      if (r.status !== "pending" && r.status !== "claimed") continue;
      const p = decryptOutboxPayload(r.payload_enc);
      if (String(p?.title || "").trim().toLowerCase() === want) return true;
    }
    return false;
  }

  function mirrorList(email, opts = {}) {
    const e = normEmail(email);
    const bucket = atomMirror.get(e);
    const pubs = bucket
      ? [...bucket.values()].map((r) =>
          rowToPublicAtom(r, { includeBody: false }),
        )
      : [];
    return paginateMirrorList(pubs, opts);
  }

  function _forceOutboxClaimedAt(email, outboxId, iso) {
    const row = askOutbox.get(normEmail(email))?.get(outboxId);
    if (row) row.claimed_at = iso;
  }

  function mirrorStatus(email) {
    const e = normEmail(email);
    const bucket = atomMirror.get(e);
    let updatedAt = null;
    if (bucket) {
      for (const row of bucket.values()) {
        if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
      }
    }
    return { count: bucket ? bucket.size : 0, updatedAt };
  }

  function mirrorListTags(email) {
    const e = normEmail(email);
    const bucket = atomMirror.get(e);
    const rows = bucket
      ? [...bucket.values()].sort((a, b) =>
          String(a.path || "").localeCompare(String(b.path || "")),
        )
      : [];
    const agg = aggregateMirrorTags(
      rows.map((r) => rowToPublicAtom(r, { includeBody: false }).tags),
    );
    return {
      tags: agg.tags,
      mirror_count: rows.length,
      total_distinct: agg.total_distinct,
      truncated: agg.truncated,
    };
  }

  function mcpCreatePending(fields) {
    const pendingId = id("pend");
    mcpPending.set(pendingId, {
      ...fields,
      pendingId,
      exp: Date.now() + 15 * 60 * 1000,
    });
    return pendingId;
  }

  function mcpGetPending(pendingId) {
    const row = mcpPending.get(pendingId);
    if (!row) return null;
    if (Date.now() > row.exp) {
      mcpPending.delete(pendingId);
      return null;
    }
    return row;
  }

  function mcpDeletePending(pendingId) {
    mcpPending.delete(pendingId);
  }

  function mcpUpdatePending(pendingId, patch) {
    const row = mcpPending.get(pendingId);
    if (!row) return null;
    if (Date.now() > row.exp) {
      mcpPending.delete(pendingId);
      return null;
    }
    Object.assign(row, patch);
    return row;
  }

  function pairMint(email) {
    const e = normEmail(email);
    const code = generatePairCode();
    const expMs = Date.now() + PAIR_CODE_TTL_MS;
    mcpPairCodes.set(e, {
      codeHash: hashToken(code),
      expMs,
      consumedMs: null,
    });
    return { code, expiresAt: new Date(expMs).toISOString() };
  }

  function pairRedeem(rawCode) {
    const code = normalizePairCodeInput(rawCode);
    if (!code || code.length < 6) return null;
    const h = hashToken(code);
    for (const [email, row] of mcpPairCodes) {
      if (row.codeHash !== h) continue;
      if (row.consumedMs != null) return null;
      if (Date.now() > row.expMs) return null;
      row.consumedMs = Date.now();
      return { email };
    }
    return null;
  }

  function mcpCreateBrowserSession(email) {
    const sid = id("obs");
    mcpBrowserSessions.set(sid, {
      email: normEmail(email),
      exp: Date.now() + 15 * 60 * 1000,
    });
    return sid;
  }

  function mcpGetBrowserSession(sid) {
    if (!sid) return null;
    const row = mcpBrowserSessions.get(sid);
    if (!row || Date.now() > row.exp) {
      if (row) mcpBrowserSessions.delete(sid);
      return null;
    }
    return row;
  }

  function mcpCreateAuthCode(fields) {
    const code = id("ac");
    mcpAuthCodes.set(hashToken(code), {
      ...fields,
      exp: Date.now() + 5 * 60 * 1000,
      used: false,
    });
    return code;
  }

  function mintMcpTokens(email, clientId, resource, scopes = ["atoms:read"]) {
    const e = normEmail(email);
    const access = id("mcp");
    const refresh = id("mcpr");
    const accessExp = Date.now() + 60 * 60 * 1000;
    const refreshExp = Date.now() + 30 * 24 * 60 * 60 * 1000;
    mcpAccess.set(hashToken(access), {
      email: e,
      clientId,
      resource,
      scopes,
      exp: accessExp,
      revoked: false,
    });
    mcpRefresh.set(hashToken(refresh), {
      email: e,
      clientId,
      resource,
      scopes,
      exp: refreshExp,
      revoked: false,
    });
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresIn: 3600,
      tokenType: "Bearer",
      scope: Array.isArray(scopes) ? scopes.join(" ") : String(scopes || ""),
    };
  }

  function mcpExchangeCodeSync(opts) {
    const h = hashToken(opts.code);
    const row = mcpAuthCodes.get(h);
    if (!row || row.used || Date.now() > row.exp) return null;
    if (row.clientId !== opts.clientId) return null;
    if (row.redirectUri !== opts.redirectUri) return null;
    if (row.resource !== opts.resource) return null;
    if (!verifyPkce(opts.codeVerifier, row.codeChallenge, row.codeChallengeMethod)) {
      return null;
    }
    row.used = true;
    return mintMcpTokens(row.email, row.clientId, row.resource, row.scopes);
  }

  function mcpRefreshTokens(refreshToken, { clientId, resource } = {}) {
    const h = hashToken(refreshToken);
    const row = mcpRefresh.get(h);
    if (!row || row.revoked || Date.now() > row.exp) return null;
    if (clientId && row.clientId !== clientId) return null;
    if (resource && row.resource !== resource) return null;
    row.revoked = true;
    mcpRefresh.delete(h);
    return mintMcpTokens(row.email, row.clientId, row.resource, row.scopes);
  }

  function accountFromMcpToken(accessToken) {
    if (!accessToken) return null;
    const row = mcpAccess.get(hashToken(accessToken));
    if (!row || row.revoked || Date.now() > row.exp) return null;
    const a = refreshAccountStatus(getAccount(row.email));
    if (!a) return null;
    if (a.status !== "active" && a.status !== "trialing") return null;
    const mcpScopes = Array.isArray(row.scopes)
      ? row.scopes
      : ["atoms:read"];
    return { ...a, mcpScopes };
  }

  function mcpRevokeForEmail(email) {
    const e = normEmail(email);
    for (const [k, v] of mcpAccess) {
      if (v.email === e) {
        v.revoked = true;
        mcpAccess.delete(k);
      }
    }
    for (const [k, v] of mcpRefresh) {
      if (v.email === e) {
        v.revoked = true;
        mcpRefresh.delete(k);
      }
    }
  }

  function mcpRegisterClient(meta) {
    const clientId = meta.client_id || id("cli");
    mcpClients.set(clientId, {
      clientId,
      redirectUris: meta.redirect_uris || [],
      clientName: meta.client_name || "",
      tokenEndpointAuthMethod: meta.token_endpoint_auth_method || "none",
    });
    return {
      client_id: clientId,
      redirect_uris: meta.redirect_uris || [],
      token_endpoint_auth_method: "none",
    };
  }

  function mcpGetClient(clientId) {
    return mcpClients.get(clientId) || null;
  }

  return {
    kind: "memory",
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
    mirrorUpsert,
    mirrorFetch,
    mirrorSearch,
    mirrorNeighbors,
    mirrorWipe,
    mirrorStatus,
    mirrorListTags,
    mirrorDelete,
    mirrorReconcileKeep,
    outboxEnqueue,
    outboxPull,
    outboxAck,
    outboxGet,
    outboxPendingCount,
    outboxCancel,
    outboxListOpen,
    outboxHasOpenTitle,
    mirrorList,
    _forceOutboxClaimedAt,
    mcpCreatePending,
    mcpGetPending,
    mcpDeletePending,
    mcpUpdatePending,
    pairMint,
    pairRedeem,
    mcpCreateBrowserSession,
    mcpGetBrowserSession,
    mcpCreateAuthCode,
    mcpExchangeCode: mcpExchangeCodeSync,
    mcpRefreshTokens,
    accountFromMcpToken,
    mcpRevokeForEmail,
    mcpRegisterClient,
    mcpGetClient,
    mintMcpTokensForTest: mintMcpTokens,
    hasProcessedEvent: (id) => processedEvents.has(id),
    claimEvent(id) {
      if (!id || processedEvents.has(id)) return false;
      processedEvents.add(id);
      return true;
    },
    markEventProcessed: (id) => id && processedEvents.add(id),
    recordStripeIncident(kind, opts = {}) {
      const n = normalizeStripeIncident(kind, opts);
      const key = `${n.kind}|${n.dayBucket}|${n.stripeId}`;
      const at = new Date(n.now).toISOString();
      let row = stripeIncidents.get(key);
      if (!row) {
        row = {
          id: id("inc"),
          kind: n.kind,
          day_bucket: n.dayBucket,
          stripe_id: n.stripeId,
          email: n.email,
          detail: n.detail,
          occurrences: 1,
          first_seen_at: at,
          last_seen_at: at,
          alerted_at: null,
        };
        stripeIncidents.set(key, row);
      } else {
        row.occurrences += 1;
        row.last_seen_at = at;
        if (n.email) row.email = n.email;
        if (n.detail) row.detail = n.detail;
      }
      return rowToIncident(row);
    },
    /** Newest alert epoch ms for this kind at or after `sinceMs`, else null. */
    lastStripeAlertAt(kind, sinceMs = 0) {
      let best = null;
      for (const r of stripeIncidents.values()) {
        if (r.kind !== kind || !r.alerted_at) continue;
        const ms = Date.parse(r.alerted_at);
        if (ms < sinceMs) continue;
        if (best === null || ms > best) best = ms;
      }
      return best;
    },
    markStripeIncidentAlerted(incidentId, opts = {}) {
      const now = Number.isFinite(opts.now) ? opts.now : Date.now();
      for (const r of stripeIncidents.values()) {
        if (r.id !== incidentId) continue;
        r.alerted_at = new Date(now).toISOString();
        return rowToIncident(r);
      }
      return null;
    },
    listStripeIncidents({ since, kind, limit } = {}) {
      const cutoff = toMs(since, 0);
      const cap = Number.isFinite(limit) ? limit : 100;
      return [...stripeIncidents.values()]
        .filter(
          (r) =>
            (!kind || r.kind === kind) && Date.parse(r.last_seen_at) >= cutoff,
        )
        .sort(
          (a, b) =>
            Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at) ||
            Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at),
        )
        .slice(0, cap)
        .map(rowToIncident);
    },
    setStripeCustomer(email, customerId) {
      const a = ensureAccount(email);
      a.stripeCustomerId = customerId;
      stripeCustomers.set(customerId, a.email);
      return a;
    },
    setStripeSubscription(email, subId) {
      const a = ensureAccount(email);
      a.stripeSubscriptionId = subId;
      return a;
    },
    emailFromStripeCustomer: (id) => stripeCustomers.get(id) ?? null,
    revokeSubscription(email) {
      const a = ensureAccount(email);
      a.stripeSubscriptionId = undefined;
      mcpRevokeForEmail(a.email);
      if (a.remaining > 0) a.status = "active";
      else {
        a.status = "inactive";
        a.remaining = 0;
      }
      return a;
    },
    _sessions: sessions,
    _accounts: accounts,
    _processedEvents: processedEvents,
  };
}
