/**
 * In-memory store (tests + explicit ATOMS_PLUS_STORE=memory).
 */
import { config } from "../config.mjs";
import {
  applyStatusRules,
  hashToken,
  id,
  periodEndFromNow,
  publicAccount,
} from "./shared.mjs";
import {
  makeSnippet,
  normEmail,
  prepareMirrorRow,
  rowToPublicAtom,
  scoreSearch,
  verifyPkce,
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
    const session = id("sess");
    sessions.set(hashToken(session), {
      email: row.email,
      exp: Date.now() + sessionTtlMs(),
      revoked: false,
    });
    return { session, account: a };
  }

  function accountFromSession(sessionToken) {
    if (!sessionToken) return null;
    const row = sessions.get(hashToken(sessionToken));
    if (!row || row.revoked || Date.now() > row.exp) return null;
    return refreshAccountStatus(getAccount(row.email));
  }

  function revokeSession(sessionToken) {
    const h = hashToken(sessionToken);
    const row = sessions.get(h);
    if (row) row.revoked = true;
  }

  function tryConsumeFiling(sessionToken, idempotencyKey) {
    if (idempotencyKey && usageByKey.has(idempotencyKey)) {
      const prev = usageByKey.get(idempotencyKey);
      if (prev?.status === "ok" && prev.responseJson) {
        return {
          ok: true,
          replay: true,
          account: accountFromSession(sessionToken),
          cached: prev,
        };
      }
      if (prev?.status === "refunded") {
        usageByKey.delete(idempotencyKey);
      } else if (prev?.status === "reserved") {
        return {
          ok: false,
          code: "in_flight",
          account: accountFromSession(sessionToken),
        };
      }
    }
    const a = accountFromSession(sessionToken);
    if (!a) return { ok: false, code: "auth" };
    if (a.status === "inactive") return { ok: false, code: "auth" };
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
      usageByKey.set(idempotencyKey, { status: "reserved" });
    }
    return { ok: true, account: a, replay: false };
  }

  function completeUsage(idempotencyKey, payload) {
    if (!idempotencyKey) return;
    usageByKey.set(idempotencyKey, payload);
  }

  function refundFiling(sessionToken, idempotencyKey) {
    const a = accountFromSession(sessionToken);
    if (!a) return;
    a.remaining += 1;
    if (a.status === "exhausted" && a.remaining > 0) {
      a.status = a.plan === "trial" ? "trialing" : "active";
    }
    if (idempotencyKey && usageByKey.has(idempotencyKey)) {
      const prev = usageByKey.get(idempotencyKey);
      if (prev?.status !== "ok") {
        usageByKey.set(idempotencyKey, { status: "refunded" });
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

  function mirrorSearch(email, query, limit = 8) {
    const e = normEmail(email);
    const bucket = atomMirror.get(e);
    if (!bucket) return [];
    const lim = Math.min(Math.max(Number(limit) || 8, 1), 25);
    const scored = [];
    for (const row of bucket.values()) {
      const pub = rowToPublicAtom(row, { includeBody: true });
      const s = scoreSearch(
        { title: pub.title, path: pub.path, tags: pub.tags, body: pub.text },
        query,
      );
      if (s > 0) {
        scored.push({
          score: s,
          hit: {
            id: pub.id,
            title: pub.title,
            path: pub.path,
            tags: pub.tags,
            snippet: makeSnippet(pub.text, query),
          },
        });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title));
    return scored.slice(0, lim).map((x) => x.hit);
  }

  function mirrorWipe(email) {
    const e = normEmail(email);
    atomMirror.delete(e);
    mcpRevokeForEmail(e);
    return { ok: true };
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
    return a;
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
    mirrorUpsert,
    mirrorFetch,
    mirrorSearch,
    mirrorWipe,
    mirrorStatus,
    mcpCreatePending,
    mcpGetPending,
    mcpDeletePending,
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
