/**
 * In-memory store (tests + explicit ATOMS_PLUS_STORE=memory).
 */
import { config } from "../config.mjs";
import {
  applyStatusRules,
  hashToken,
  id,
  isEntitledAccount,
  periodEndFromNow,
  publicAccount,
} from "./shared.mjs";
import {
  buildNeighborsGraph,
  buildSearchHits,
  normEmail,
  prepareMirrorRow,
  rowToPublicAtom,
  verifyPkce,
  OUTBOX_STALE_MS,
  OUTBOX_MAX_OPEN,
  encryptOutboxPayload,
  decryptOutboxPayload,
  publicOutboxRow,
  assertMirrorPath,
} from "./askHelpers.mjs";

export function createMemoryStore() {
  const accounts = new Map();
  const magicTokens = new Map();
  /** tokenHash → { email, exp, revoked } */
  const sessions = new Map();
  const promoUses = new Map();
  /** email+code → true */
  const promoByEmail = new Set();
  const processedEvents = new Set();
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

  function createMagicToken(email) {
    const token = id("mt");
    magicTokens.set(token, {
      email: email.trim().toLowerCase(),
      exp: Date.now() + 15 * 60 * 1000,
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
    const row = magicTokens.get(token);
    if (!row) return null;
    if (Date.now() > row.exp) {
      magicTokens.delete(token);
      return null;
    }
    magicTokens.delete(token);
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
    return { session, account: a };
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
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 50);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const bucket = atomMirror.get(e);
    const all = bucket
      ? [...bucket.values()].sort(
          (a, b) =>
            String(a.title).localeCompare(String(b.title), undefined, {
              sensitivity: "base",
            }) || String(a.path).localeCompare(String(b.path)),
        )
      : [];
    const slice = all.slice(offset, offset + limit);
    const items = slice.map((r) => {
      const pub = rowToPublicAtom(r, { includeBody: false });
      return {
        id: pub.id,
        title: pub.title,
        path: pub.path,
        tags: pub.tags,
        kind: pub.kind,
        synced_at: pub.updatedAt ?? null,
      };
    });
    const total = all.length;
    const next_offset =
      offset + items.length < total ? offset + items.length : null;
    return { items, total, offset, limit, next_offset };
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
    createSession,
    startWithEmail,
    exchangeMagic,
    accountFromSession,
    revokeSession,
    revokeAllSessionsForEmail,
    revokeUnverifiedSessionsForEmail,
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
    mirrorDelete,
    mirrorReconcileKeep,
    outboxEnqueue,
    outboxPull,
    outboxAck,
    outboxGet,
    outboxPendingCount,
    outboxCancel,
    outboxHasOpenTitle,
    mirrorList,
    _forceOutboxClaimedAt,
    mcpCreatePending,
    mcpGetPending,
    mcpDeletePending,
    mcpUpdatePending,
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
