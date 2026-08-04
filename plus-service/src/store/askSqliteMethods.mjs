/**
 * Ask mirror + MCP OAuth methods for SQLite DatabaseSync.
 */
import { hashToken, id } from "./shared.mjs";
import {
  aggregateMirrorTags,
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
  generatePairCode,
  normalizePairCodeInput,
  PAIR_CODE_TTL_MS,
} from "./askHelpers.mjs";

export const ASK_SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS atom_mirror (
  email TEXT NOT NULL,
  atom_id TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  body_enc TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  links_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (email, path)
);
CREATE INDEX IF NOT EXISTS idx_atom_mirror_email ON atom_mirror(email);
CREATE TABLE IF NOT EXISTS mcp_oauth_pending (
  pending_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  exp_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_auth_codes (
  code_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  exp_ms INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mcp_access_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  exp_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  exp_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  redirect_uris_json TEXT NOT NULL,
  client_name TEXT,
  token_endpoint_auth_method TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_browser_sessions (
  session_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  exp_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_pair_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  exp_ms INTEGER NOT NULL,
  consumed_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mcp_pair_codes_hash ON mcp_pair_codes(code_hash);
CREATE TABLE IF NOT EXISTS ask_outbox (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  status TEXT NOT NULL,
  client_request_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  applied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ask_outbox_email_status ON ask_outbox(email, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ask_outbox_email_crid
  ON ask_outbox(email, client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id != '';
`;

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ getAccount: Function, refreshAccountStatus: Function }} deps
 */
export function createAskSqliteMethods(db, deps) {
  function mirrorUpsert(email, atoms) {
    const list = Array.isArray(atoms) ? atoms : [];
    let upserted = 0;
    let skipped = 0;
    const sel = db.prepare(
      "SELECT content_hash FROM atom_mirror WHERE email = ? AND path = ?",
    );
    const ins = db.prepare(`
      INSERT INTO atom_mirror (email, atom_id, title, path, body_enc, tags_json, links_json, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email, path) DO UPDATE SET
        atom_id=excluded.atom_id,
        title=excluded.title,
        body_enc=excluded.body_enc,
        tags_json=excluded.tags_json,
        links_json=excluded.links_json,
        content_hash=excluded.content_hash,
        updated_at=excluded.updated_at
    `);
    for (const atom of list) {
      const row = prepareMirrorRow(email, atom);
      const prev = sel.get(row.email, row.path);
      if (prev && prev.content_hash === row.contentHash) {
        skipped += 1;
        continue;
      }
      ins.run(
        row.email,
        row.atomId,
        row.title,
        row.path,
        row.bodyEnc,
        row.tagsJson,
        row.linksJson,
        row.contentHash,
        row.updatedAt,
      );
      upserted += 1;
    }
    return { upserted, skipped };
  }

  function mirrorFetch(email, idOrTitle) {
    const e = normEmail(email);
    const key = String(idOrTitle || "").trim();
    if (!key) return null;
    const rows = db
      .prepare("SELECT * FROM atom_mirror WHERE email = ?")
      .all(e);
    for (const r of rows) {
      if (
        r.path === key ||
        r.atom_id === key ||
        r.title === key ||
        String(r.title).toLowerCase() === key.toLowerCase()
      ) {
        return rowToPublicAtom(r, { includeBody: true });
      }
    }
    return null;
  }

  function mirrorSearch(email, query, limit = 8, opts = {}) {
    const e = normEmail(email);
    const rows = db.prepare("SELECT * FROM atom_mirror WHERE email = ?").all(e);
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: true }));
    return buildSearchHits(pubs, query, limit, opts);
  }

  function mirrorNeighbors(email, idOrTitle) {
    const e = normEmail(email);
    const center = mirrorFetch(email, idOrTitle);
    const rows = db.prepare("SELECT * FROM atom_mirror WHERE email = ?").all(e);
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: true }));
    return buildNeighborsGraph(center, idOrTitle, pubs);
  }

  function mcpRevokeForEmail(email) {
    const e = normEmail(email);
    db.prepare("DELETE FROM mcp_access_tokens WHERE email = ?").run(e);
    db.prepare("DELETE FROM mcp_refresh_tokens WHERE email = ?").run(e);
  }

  function mirrorWipe(email) {
    const e = normEmail(email);
    db.prepare("DELETE FROM atom_mirror WHERE email = ?").run(e);
    db.prepare("DELETE FROM ask_outbox WHERE email = ?").run(e);
    mcpRevokeForEmail(e);
    return { ok: true };
  }

  function mirrorDelete(email, paths) {
    const e = normEmail(email);
    const list = Array.isArray(paths) ? paths : [];
    let deleted = 0;
    let missing = 0;
    const del = db.prepare(
      "DELETE FROM atom_mirror WHERE email = ? AND path = ?",
    );
    const exists = db.prepare(
      "SELECT 1 AS x FROM atom_mirror WHERE email = ? AND path = ?",
    );
    for (const raw of list) {
      const checked = assertMirrorPath(raw);
      if (!checked.ok) continue;
      const hit = exists.get(e, checked.path);
      if (!hit) {
        missing += 1;
        continue;
      }
      del.run(e, checked.path);
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
    const rows = db
      .prepare("SELECT path FROM atom_mirror WHERE email = ?")
      .all(e);
    let deleted = 0;
    const del = db.prepare(
      "DELETE FROM atom_mirror WHERE email = ? AND path = ?",
    );
    for (const r of rows) {
      if (!keep.has(r.path)) {
        del.run(e, r.path);
        deleted += 1;
      }
    }
    const st = mirrorStatus(e);
    return { deleted, ...st };
  }

  function outboxOpenCount(email) {
    const e = normEmail(email);
    const r = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ask_outbox
         WHERE email = ? AND status IN ('pending','claimed')`,
      )
      .get(e);
    return r?.n ?? 0;
  }

  function outboxRowFromDb(r) {
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

  /**
   * @param {string} email
   * @param {{ kind: string, payload: object, client_request_id?: string }} opts
   */
  function outboxEnqueue(email, opts) {
    const e = normEmail(email);
    const kind = opts.kind === "continue" ? "continue" : "create";
    const crid = opts.client_request_id
      ? String(opts.client_request_id).trim().slice(0, 128)
      : "";
    if (crid) {
      const existing = db
        .prepare(
          `SELECT * FROM ask_outbox WHERE email = ? AND client_request_id = ?`,
        )
        .get(e, crid);
      if (existing) {
        return { ok: true, ...outboxRowFromDb(existing), duplicate: true };
      }
    }
    if (outboxOpenCount(e) >= OUTBOX_MAX_OPEN) {
      return { ok: false, error: "outbox_full" };
    }
    const idRow = id("obx");
    const now = new Date().toISOString();
    const payload_enc = encryptOutboxPayload(opts.payload);
    db.prepare(
      `INSERT INTO ask_outbox
       (id, email, kind, payload_enc, status, client_request_id, error, created_at, claimed_at, applied_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, NULL, NULL)`,
    ).run(idRow, e, kind, payload_enc, crid || null, now);
    const row = db.prepare("SELECT * FROM ask_outbox WHERE id = ?").get(idRow);
    return { ok: true, ...outboxRowFromDb(row), duplicate: false };
  }

  function outboxReclaimStale(email) {
    const e = normEmail(email);
    const cutoff = new Date(Date.now() - OUTBOX_STALE_MS).toISOString();
    db.prepare(
      `UPDATE ask_outbox SET status = 'pending', claimed_at = NULL
       WHERE email = ? AND status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < ?`,
    ).run(e, cutoff);
  }

  /**
   * @param {string} email
   * @param {{ limit?: number }} [opts]
   */
  function outboxPull(email, opts = {}) {
    const e = normEmail(email);
    outboxReclaimStale(e);
    const lim = Math.min(Math.max(Number(opts.limit) || 1, 1), 10);
    const pending = db
      .prepare(
        `SELECT * FROM ask_outbox WHERE email = ? AND status = 'pending'
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(e, lim);
    const now = new Date().toISOString();
    const items = [];
    for (const r of pending) {
      db.prepare(
        `UPDATE ask_outbox SET status = 'claimed', claimed_at = ?
         WHERE id = ? AND email = ? AND status = 'pending'`,
      ).run(now, r.id, e);
      const updated = db
        .prepare(`SELECT * FROM ask_outbox WHERE id = ? AND email = ?`)
        .get(r.id, e);
      if (updated?.status === "claimed") {
        items.push(outboxRowFromDb(updated));
      }
    }
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
           SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count
         FROM ask_outbox WHERE email = ?`,
      )
      .get(e);
    return {
      items,
      pending_count: counts?.pending_count ?? 0,
      claimed_count: counts?.claimed_count ?? 0,
    };
  }

  /**
   * @param {string} email
   * @param {{ id: string, status: "applied"|"rejected", error?: string }} opts
   */
  function outboxAck(email, opts) {
    const e = normEmail(email);
    const oid = String(opts.id || "").trim();
    const st = opts.status === "rejected" ? "rejected" : "applied";
    if (!oid) return { ok: false, error: "id required" };
    const row = db
      .prepare(`SELECT * FROM ask_outbox WHERE id = ? AND email = ?`)
      .get(oid, e);
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "applied" || row.status === "rejected") {
      return { ok: true, ...outboxRowFromDb(row), already: true };
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE ask_outbox SET status = ?, error = ?, applied_at = ?
       WHERE id = ? AND email = ?`,
    ).run(st, opts.error ? String(opts.error).slice(0, 500) : null, now, oid, e);
    const updated = db
      .prepare(`SELECT * FROM ask_outbox WHERE id = ? AND email = ?`)
      .get(oid, e);
    return { ok: true, ...outboxRowFromDb(updated) };
  }

  function outboxGet(email, outboxId) {
    const e = normEmail(email);
    const r = db
      .prepare(`SELECT * FROM ask_outbox WHERE id = ? AND email = ?`)
      .get(String(outboxId || ""), e);
    return outboxRowFromDb(r);
  }

  function outboxPendingCount(email) {
    const e = normEmail(email);
    outboxReclaimStale(e);
    return outboxOpenCount(e);
  }

  /**
   * Cancel pending or claimed outbox row (not applied/rejected).
   */
  function outboxCancel(email, outboxId) {
    const e = normEmail(email);
    const oid = String(outboxId || "").trim();
    if (!oid) return { ok: false, error: "id required" };
    const row = db
      .prepare(`SELECT * FROM ask_outbox WHERE id = ? AND email = ?`)
      .get(oid, e);
    if (!row) return { ok: false, error: "not_found" };
    if (row.status === "applied" || row.status === "rejected") {
      return {
        ok: false,
        error: "already_terminal",
        status: row.status,
      };
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE ask_outbox SET status = 'rejected', error = 'cancelled', applied_at = ?
       WHERE id = ? AND email = ?`,
    ).run(now, oid, e);
    return { ok: true, ...outboxRowFromDb(
      db.prepare(`SELECT * FROM ask_outbox WHERE id = ?`).get(oid),
    ) };
  }

  /**
   * True if a pending/claimed create (or continue) targets this title.
   */
  function outboxHasOpenTitle(email, title) {
    const e = normEmail(email);
    const want = String(title || "").trim().toLowerCase();
    if (!want) return false;
    outboxReclaimStale(e);
    const rows = db
      .prepare(
        `SELECT payload_enc, kind FROM ask_outbox
         WHERE email = ? AND status IN ('pending','claimed')`,
      )
      .all(e);
    for (const r of rows) {
      const p = decryptOutboxPayload(r.payload_enc);
      const t = String(p?.title || "").trim().toLowerCase();
      if (t === want) return true;
    }
    return false;
  }

  /**
   * List mirror atoms (title/path/tags), stable title order, offset pagination.
   */
  function mirrorList(email, opts = {}) {
    const e = normEmail(email);
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 50);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const rows = db
      .prepare(
        `SELECT * FROM atom_mirror WHERE email = ?
         ORDER BY title COLLATE NOCASE ASC, path ASC
         LIMIT ? OFFSET ?`,
      )
      .all(e, limit, offset);
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM atom_mirror WHERE email = ?`)
      .get(e);
    const items = rows.map((r) => {
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
    const count = total?.n ?? 0;
    const next_offset = offset + items.length < count ? offset + items.length : null;
    return {
      items,
      total: count,
      offset,
      limit,
      next_offset,
    };
  }

  /** Test-only: age a claimed row for stale-lease tests. */
  function _forceOutboxClaimedAt(email, outboxId, iso) {
    const e = normEmail(email);
    db.prepare(
      `UPDATE ask_outbox SET claimed_at = ? WHERE id = ? AND email = ?`,
    ).run(iso, outboxId, e);
  }

  function mirrorStatus(email) {
    const e = normEmail(email);
    const c = db
      .prepare("SELECT COUNT(*) AS n FROM atom_mirror WHERE email = ?")
      .get(e);
    const u = db
      .prepare(
        "SELECT MAX(updated_at) AS u FROM atom_mirror WHERE email = ?",
      )
      .get(e);
    return { count: c?.n ?? 0, updatedAt: u?.u ?? null };
  }

  function mirrorListTags(email) {
    const e = normEmail(email);
    const rows = db
      .prepare(
        `SELECT tags_json FROM atom_mirror WHERE email = ?
         ORDER BY path ASC`,
      )
      .all(e);
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
    db.prepare(
      "INSERT INTO mcp_oauth_pending (pending_id, payload_json, exp_ms) VALUES (?, ?, ?)",
    ).run(pendingId, JSON.stringify(fields), Date.now() + 15 * 60 * 1000);
    return pendingId;
  }

  function mcpGetPending(pendingId) {
    const r = db
      .prepare("SELECT * FROM mcp_oauth_pending WHERE pending_id = ?")
      .get(pendingId);
    if (!r) return null;
    if (Date.now() > r.exp_ms) {
      db.prepare("DELETE FROM mcp_oauth_pending WHERE pending_id = ?").run(
        pendingId,
      );
      return null;
    }
    return { pendingId, ...JSON.parse(r.payload_json), exp: r.exp_ms };
  }

  function mcpDeletePending(pendingId) {
    db.prepare("DELETE FROM mcp_oauth_pending WHERE pending_id = ?").run(
      pendingId,
    );
  }

  function mcpUpdatePending(pendingId, patch) {
    const row = mcpGetPending(pendingId);
    if (!row) return null;
    const next = { ...row, ...patch };
    delete next.pendingId;
    delete next.exp;
    db.prepare(
      "UPDATE mcp_oauth_pending SET payload_json = ? WHERE pending_id = ?",
    ).run(JSON.stringify(next), pendingId);
    return mcpGetPending(pendingId);
  }

  function pairMint(email) {
    const e = normEmail(email);
    const code = generatePairCode();
    const expMs = Date.now() + PAIR_CODE_TTL_MS;
    db.prepare(
      `INSERT INTO mcp_pair_codes (email, code_hash, exp_ms, consumed_ms)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(email) DO UPDATE SET
         code_hash = excluded.code_hash,
         exp_ms = excluded.exp_ms,
         consumed_ms = NULL`,
    ).run(e, hashToken(code), expMs);
    return { code, expiresAt: new Date(expMs).toISOString() };
  }

  function pairRedeem(rawCode) {
    const code = normalizePairCodeInput(rawCode);
    if (!code || code.length < 6) return null;
    const h = hashToken(code);
    const r = db.prepare("SELECT * FROM mcp_pair_codes WHERE code_hash = ?").get(h);
    if (!r) return null;
    if (r.consumed_ms != null) return null;
    if (Date.now() > r.exp_ms) return null;
    db.prepare(
      "UPDATE mcp_pair_codes SET consumed_ms = ? WHERE email = ? AND code_hash = ? AND consumed_ms IS NULL",
    ).run(Date.now(), r.email, h);
    const check = db
      .prepare("SELECT consumed_ms FROM mcp_pair_codes WHERE email = ? AND code_hash = ?")
      .get(r.email, h);
    if (!check?.consumed_ms) return null;
    return { email: r.email };
  }

  function mcpCreateBrowserSession(email) {
    const sid = id("obs");
    db.prepare(
      "INSERT INTO mcp_browser_sessions (session_id, email, exp_ms) VALUES (?, ?, ?)",
    ).run(sid, normEmail(email), Date.now() + 15 * 60 * 1000);
    return sid;
  }

  function mcpGetBrowserSession(sid) {
    if (!sid) return null;
    const r = db
      .prepare("SELECT * FROM mcp_browser_sessions WHERE session_id = ?")
      .get(sid);
    if (!r || Date.now() > r.exp_ms) {
      if (r) {
        db.prepare("DELETE FROM mcp_browser_sessions WHERE session_id = ?").run(
          sid,
        );
      }
      return null;
    }
    return { email: r.email, exp: r.exp_ms };
  }

  function mcpCreateAuthCode(fields) {
    const code = id("ac");
    db.prepare(
      `INSERT INTO mcp_auth_codes
       (code_hash, email, client_id, redirect_uri, resource, code_challenge, code_challenge_method, scopes_json, exp_ms, used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      hashToken(code),
      normEmail(fields.email),
      fields.clientId,
      fields.redirectUri,
      fields.resource,
      fields.codeChallenge,
      fields.codeChallengeMethod || "S256",
      JSON.stringify(fields.scopes || ["atoms:read"]),
      Date.now() + 5 * 60 * 1000,
    );
    return code;
  }

  function mintMcpTokens(email, clientId, resource, scopes = ["atoms:read"]) {
    const e = normEmail(email);
    const access = id("mcp");
    const refresh = id("mcpr");
    const scopesJson = JSON.stringify(scopes);
    db.prepare(
      `INSERT INTO mcp_access_tokens (token_hash, email, client_id, resource, scopes_json, exp_ms, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(hashToken(access), e, clientId, resource, scopesJson, Date.now() + 3600_000);
    db.prepare(
      `INSERT INTO mcp_refresh_tokens (token_hash, email, client_id, resource, scopes_json, exp_ms, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      hashToken(refresh),
      e,
      clientId,
      resource,
      scopesJson,
      Date.now() + 30 * 86400_000,
    );
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresIn: 3600,
      tokenType: "Bearer",
      scope: scopes.join(" "),
    };
  }

  function mcpExchangeCode(opts) {
    const r = db
      .prepare("SELECT * FROM mcp_auth_codes WHERE code_hash = ?")
      .get(hashToken(opts.code));
    if (!r || r.used || Date.now() > r.exp_ms) return null;
    if (r.client_id !== opts.clientId) return null;
    if (r.redirect_uri !== opts.redirectUri) return null;
    if (r.resource !== opts.resource) return null;
    if (
      !verifyPkce(
        opts.codeVerifier,
        r.code_challenge,
        r.code_challenge_method,
      )
    ) {
      return null;
    }
    db.prepare("UPDATE mcp_auth_codes SET used = 1 WHERE code_hash = ?").run(
      hashToken(opts.code),
    );
    const scopes = JSON.parse(r.scopes_json || '["atoms:read"]');
    return mintMcpTokens(r.email, r.client_id, r.resource, scopes);
  }

  function mcpRefreshTokens(refreshToken, { clientId, resource } = {}) {
    const h = hashToken(refreshToken);
    const r = db
      .prepare("SELECT * FROM mcp_refresh_tokens WHERE token_hash = ?")
      .get(h);
    if (!r || r.revoked || Date.now() > r.exp_ms) return null;
    if (clientId && r.client_id !== clientId) return null;
    if (resource && r.resource !== resource) return null;
    db.prepare("DELETE FROM mcp_refresh_tokens WHERE token_hash = ?").run(h);
    const scopes = JSON.parse(r.scopes_json || '["atoms:read"]');
    return mintMcpTokens(r.email, r.client_id, r.resource, scopes);
  }

  function accountFromMcpToken(accessToken) {
    if (!accessToken) return null;
    const r = db
      .prepare("SELECT * FROM mcp_access_tokens WHERE token_hash = ?")
      .get(hashToken(accessToken));
    if (!r || r.revoked || Date.now() > r.exp_ms) return null;
    const a = deps.refreshAccountStatus(deps.getAccount(r.email));
    if (!a) return null;
    if (a.status !== "active" && a.status !== "trialing") return null;
    let mcpScopes = ["atoms:read"];
    try {
      const parsed = JSON.parse(r.scopes_json || "[]");
      if (Array.isArray(parsed) && parsed.length) mcpScopes = parsed;
    } catch {
      /* keep default */
    }
    return { ...a, mcpScopes };
  }

  function mcpRegisterClient(meta) {
    const clientId = meta.client_id || id("cli");
    db.prepare(
      `INSERT INTO mcp_oauth_clients (client_id, redirect_uris_json, client_name, token_endpoint_auth_method)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         redirect_uris_json=excluded.redirect_uris_json,
         client_name=excluded.client_name`,
    ).run(
      clientId,
      JSON.stringify(meta.redirect_uris || []),
      meta.client_name || "",
      meta.token_endpoint_auth_method || "none",
    );
    return {
      client_id: clientId,
      redirect_uris: meta.redirect_uris || [],
      token_endpoint_auth_method: "none",
    };
  }

  function mcpGetClient(clientId) {
    const r = db
      .prepare("SELECT * FROM mcp_oauth_clients WHERE client_id = ?")
      .get(clientId);
    if (!r) return null;
    return {
      clientId: r.client_id,
      redirectUris: JSON.parse(r.redirect_uris_json || "[]"),
      clientName: r.client_name,
      tokenEndpointAuthMethod: r.token_endpoint_auth_method,
    };
  }

  return {
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
    mcpExchangeCode,
    mcpRefreshTokens,
    accountFromMcpToken,
    mcpRevokeForEmail,
    mcpRegisterClient,
    mcpGetClient,
    mintMcpTokensForTest: mintMcpTokens,
  };
}
