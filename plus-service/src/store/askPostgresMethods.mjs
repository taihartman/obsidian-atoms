/**
 * Ask mirror + MCP OAuth methods for Postgres Pool.
 */
import { hashToken, id } from "./shared.mjs";
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

export const ASK_PG_DDL = `
CREATE TABLE IF NOT EXISTS atom_mirror (
  email TEXT NOT NULL,
  atom_id TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  body_enc TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  links_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (email, path)
);
CREATE INDEX IF NOT EXISTS idx_atom_mirror_email ON atom_mirror(email);
CREATE TABLE IF NOT EXISTS mcp_oauth_pending (
  pending_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  exp_ms BIGINT NOT NULL
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
  exp_ms BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS mcp_access_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  exp_ms BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  exp_ms BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
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
  exp_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ask_outbox (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  status TEXT NOT NULL,
  client_request_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ask_outbox_email_status ON ask_outbox(email, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ask_outbox_email_crid
  ON ask_outbox(email, client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id != '';
`;

/**
 * @param {import("pg").Pool} pool
 * @param {{ getAccount: Function, refreshAccountStatus: Function }} deps
 */
export function createAskPostgresMethods(pool, deps) {
  async function mirrorUpsert(email, atoms) {
    const list = Array.isArray(atoms) ? atoms : [];
    let upserted = 0;
    let skipped = 0;
    for (const atom of list) {
      const row = prepareMirrorRow(email, atom);
      const prev = await pool.query(
        "SELECT content_hash FROM atom_mirror WHERE email = $1 AND path = $2",
        [row.email, row.path],
      );
      if (prev.rows[0]?.content_hash === row.contentHash) {
        skipped += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO atom_mirror (email, atom_id, title, path, body_enc, tags_json, links_json, content_hash, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (email, path) DO UPDATE SET
           atom_id=EXCLUDED.atom_id, title=EXCLUDED.title, body_enc=EXCLUDED.body_enc,
           tags_json=EXCLUDED.tags_json, links_json=EXCLUDED.links_json,
           content_hash=EXCLUDED.content_hash, updated_at=EXCLUDED.updated_at`,
        [
          row.email,
          row.atomId,
          row.title,
          row.path,
          row.bodyEnc,
          row.tagsJson,
          row.linksJson,
          row.contentHash,
          row.updatedAt,
        ],
      );
      upserted += 1;
    }
    return { upserted, skipped };
  }

  async function mirrorFetch(email, idOrTitle) {
    const e = normEmail(email);
    const key = String(idOrTitle || "").trim();
    if (!key) return null;
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email = $1",
      [e],
    );
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

  async function mirrorSearch(email, query, limit = 8, opts = {}) {
    const e = normEmail(email);
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email = $1",
      [e],
    );
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: true }));
    return buildSearchHits(pubs, query, limit, opts);
  }

  async function mirrorNeighbors(email, idOrTitle) {
    const center = await mirrorFetch(email, idOrTitle);
    const e = normEmail(email);
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email = $1",
      [e],
    );
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: true }));
    return buildNeighborsGraph(center, idOrTitle, pubs);
  }

  async function mcpRevokeForEmail(email) {
    const e = normEmail(email);
    await pool.query("DELETE FROM mcp_access_tokens WHERE email = $1", [e]);
    await pool.query("DELETE FROM mcp_refresh_tokens WHERE email = $1", [e]);
  }

  async function mirrorWipe(email) {
    const e = normEmail(email);
    await pool.query("DELETE FROM atom_mirror WHERE email = $1", [e]);
    await pool.query("DELETE FROM ask_outbox WHERE email = $1", [e]);
    await mcpRevokeForEmail(e);
    return { ok: true };
  }

  async function mirrorDelete(email, paths) {
    const e = normEmail(email);
    const list = Array.isArray(paths) ? paths : [];
    let deleted = 0;
    let missing = 0;
    for (const raw of list) {
      const checked = assertMirrorPath(raw);
      if (!checked.ok) continue;
      const hit = await pool.query(
        "SELECT 1 AS x FROM atom_mirror WHERE email = $1 AND path = $2",
        [e, checked.path],
      );
      if (!hit.rows[0]) {
        missing += 1;
        continue;
      }
      await pool.query(
        "DELETE FROM atom_mirror WHERE email = $1 AND path = $2",
        [e, checked.path],
      );
      deleted += 1;
    }
    const st = await mirrorStatus(e);
    return { deleted, missing, ...st };
  }

  async function mirrorReconcileKeep(email, keepPaths) {
    const e = normEmail(email);
    const keep = new Set();
    for (const raw of Array.isArray(keepPaths) ? keepPaths : []) {
      const checked = assertMirrorPath(raw);
      if (checked.ok) keep.add(checked.path);
    }
    const { rows } = await pool.query(
      "SELECT path FROM atom_mirror WHERE email = $1",
      [e],
    );
    let deleted = 0;
    for (const r of rows) {
      if (!keep.has(r.path)) {
        await pool.query(
          "DELETE FROM atom_mirror WHERE email = $1 AND path = $2",
          [e, r.path],
        );
        deleted += 1;
      }
    }
    const st = await mirrorStatus(e);
    return { deleted, ...st };
  }

  async function outboxOpenCount(email) {
    const e = normEmail(email);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ask_outbox
       WHERE email = $1 AND status IN ('pending','claimed')`,
      [e],
    );
    return r.rows[0]?.n ?? 0;
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
      created_at: r.created_at
        ? new Date(r.created_at).toISOString()
        : null,
      claimed_at: r.claimed_at
        ? new Date(r.claimed_at).toISOString()
        : null,
      applied_at: r.applied_at
        ? new Date(r.applied_at).toISOString()
        : null,
    });
  }

  async function outboxEnqueue(email, opts) {
    const e = normEmail(email);
    const kind = opts.kind === "continue" ? "continue" : "create";
    const crid = opts.client_request_id
      ? String(opts.client_request_id).trim().slice(0, 128)
      : "";
    if (crid) {
      const existing = await pool.query(
        `SELECT * FROM ask_outbox WHERE email = $1 AND client_request_id = $2`,
        [e, crid],
      );
      if (existing.rows[0]) {
        return {
          ok: true,
          ...outboxRowFromDb(existing.rows[0]),
          duplicate: true,
        };
      }
    }
    if ((await outboxOpenCount(e)) >= OUTBOX_MAX_OPEN) {
      return { ok: false, error: "outbox_full" };
    }
    const idRow = id("obx");
    const now = new Date().toISOString();
    const payload_enc = encryptOutboxPayload(opts.payload);
    await pool.query(
      `INSERT INTO ask_outbox
       (id, email, kind, payload_enc, status, client_request_id, error, created_at, claimed_at, applied_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NULL, $6, NULL, NULL)`,
      [idRow, e, kind, payload_enc, crid || null, now],
    );
    const row = await pool.query(`SELECT * FROM ask_outbox WHERE id = $1`, [
      idRow,
    ]);
    return { ok: true, ...outboxRowFromDb(row.rows[0]), duplicate: false };
  }

  async function outboxReclaimStale(email) {
    const e = normEmail(email);
    const cutoff = new Date(Date.now() - OUTBOX_STALE_MS).toISOString();
    await pool.query(
      `UPDATE ask_outbox SET status = 'pending', claimed_at = NULL
       WHERE email = $1 AND status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < $2`,
      [e, cutoff],
    );
  }

  async function outboxPull(email, opts = {}) {
    const e = normEmail(email);
    await outboxReclaimStale(e);
    const lim = Math.min(Math.max(Number(opts.limit) || 1, 1), 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pending = await client.query(
        `SELECT * FROM ask_outbox WHERE email = $1 AND status = 'pending'
         ORDER BY created_at ASC LIMIT $2 FOR UPDATE`,
        [e, lim],
      );
      const now = new Date().toISOString();
      const items = [];
      for (const r of pending.rows) {
        await client.query(
          `UPDATE ask_outbox SET status = 'claimed', claimed_at = $1
           WHERE id = $2 AND email = $3 AND status = 'pending'`,
          [now, r.id, e],
        );
        const updated = await client.query(
          `SELECT * FROM ask_outbox WHERE id = $1 AND email = $2`,
          [r.id, e],
        );
        if (updated.rows[0]?.status === "claimed") {
          items.push(outboxRowFromDb(updated.rows[0]));
        }
      }
      await client.query("COMMIT");
      const counts = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),0)::int AS pending_count,
           COALESCE(SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END),0)::int AS claimed_count
         FROM ask_outbox WHERE email = $1`,
        [e],
      );
      return {
        items,
        pending_count: counts.rows[0]?.pending_count ?? 0,
        claimed_count: counts.rows[0]?.claimed_count ?? 0,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function outboxAck(email, opts) {
    const e = normEmail(email);
    const oid = String(opts.id || "").trim();
    const st = opts.status === "rejected" ? "rejected" : "applied";
    if (!oid) return { ok: false, error: "id required" };
    const row = await pool.query(
      `SELECT * FROM ask_outbox WHERE id = $1 AND email = $2`,
      [oid, e],
    );
    if (!row.rows[0]) return { ok: false, error: "not_found" };
    if (
      row.rows[0].status === "applied" ||
      row.rows[0].status === "rejected"
    ) {
      return { ok: true, ...outboxRowFromDb(row.rows[0]), already: true };
    }
    const now = new Date().toISOString();
    await pool.query(
      `UPDATE ask_outbox SET status = $1, error = $2, applied_at = $3
       WHERE id = $4 AND email = $5`,
      [
        st,
        opts.error ? String(opts.error).slice(0, 500) : null,
        now,
        oid,
        e,
      ],
    );
    const updated = await pool.query(
      `SELECT * FROM ask_outbox WHERE id = $1 AND email = $2`,
      [oid, e],
    );
    return { ok: true, ...outboxRowFromDb(updated.rows[0]) };
  }

  async function outboxGet(email, outboxId) {
    const e = normEmail(email);
    const r = await pool.query(
      `SELECT * FROM ask_outbox WHERE id = $1 AND email = $2`,
      [String(outboxId || ""), e],
    );
    return outboxRowFromDb(r.rows[0]);
  }

  async function outboxPendingCount(email) {
    const e = normEmail(email);
    await outboxReclaimStale(e);
    return outboxOpenCount(e);
  }

  async function outboxCancel(email, outboxId) {
    const e = normEmail(email);
    const oid = String(outboxId || "").trim();
    if (!oid) return { ok: false, error: "id required" };
    const row = await pool.query(
      `SELECT * FROM ask_outbox WHERE id = $1 AND email = $2`,
      [oid, e],
    );
    if (!row.rows[0]) return { ok: false, error: "not_found" };
    if (
      row.rows[0].status === "applied" ||
      row.rows[0].status === "rejected"
    ) {
      return {
        ok: false,
        error: "already_terminal",
        status: row.rows[0].status,
      };
    }
    const now = new Date().toISOString();
    await pool.query(
      `UPDATE ask_outbox SET status = 'rejected', error = 'cancelled', applied_at = $1
       WHERE id = $2 AND email = $3`,
      [now, oid, e],
    );
    const updated = await pool.query(
      `SELECT * FROM ask_outbox WHERE id = $1 AND email = $2`,
      [oid, e],
    );
    return { ok: true, ...outboxRowFromDb(updated.rows[0]) };
  }

  async function outboxHasOpenTitle(email, title) {
    const e = normEmail(email);
    const want = String(title || "").trim().toLowerCase();
    if (!want) return false;
    await outboxReclaimStale(e);
    const rows = await pool.query(
      `SELECT payload_enc FROM ask_outbox
       WHERE email = $1 AND status IN ('pending','claimed')`,
      [e],
    );
    for (const r of rows.rows) {
      const p = decryptOutboxPayload(r.payload_enc);
      if (String(p?.title || "").trim().toLowerCase() === want) return true;
    }
    return false;
  }

  async function mirrorList(email, opts = {}) {
    const e = normEmail(email);
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 50);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const rows = await pool.query(
      `SELECT * FROM atom_mirror WHERE email = $1
       ORDER BY lower(title) ASC, path ASC
       LIMIT $2 OFFSET $3`,
      [e, limit, offset],
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS n FROM atom_mirror WHERE email = $1`,
      [e],
    );
    const items = rows.rows.map((r) => {
      const pub = rowToPublicAtom(r, { includeBody: false });
      return {
        id: pub.id,
        title: pub.title,
        path: pub.path,
        tags: pub.tags,
      };
    });
    const count = total.rows[0]?.n ?? 0;
    const next_offset =
      offset + items.length < count ? offset + items.length : null;
    return { items, total: count, offset, limit, next_offset };
  }

  async function _forceOutboxClaimedAt(email, outboxId, iso) {
    const e = normEmail(email);
    await pool.query(
      `UPDATE ask_outbox SET claimed_at = $1 WHERE id = $2 AND email = $3`,
      [iso, outboxId, e],
    );
  }

  async function mirrorStatus(email) {
    const e = normEmail(email);
    const c = await pool.query(
      "SELECT COUNT(*)::int AS n FROM atom_mirror WHERE email = $1",
      [e],
    );
    const u = await pool.query(
      "SELECT MAX(updated_at) AS u FROM atom_mirror WHERE email = $1",
      [e],
    );
    return {
      count: c.rows[0]?.n ?? 0,
      updatedAt: u.rows[0]?.u ? new Date(u.rows[0].u).toISOString() : null,
    };
  }

  async function mcpCreatePending(fields) {
    const pendingId = id("pend");
    await pool.query(
      "INSERT INTO mcp_oauth_pending (pending_id, payload_json, exp_ms) VALUES ($1,$2,$3)",
      [pendingId, JSON.stringify(fields), Date.now() + 15 * 60 * 1000],
    );
    return pendingId;
  }

  async function mcpGetPending(pendingId) {
    const { rows } = await pool.query(
      "SELECT * FROM mcp_oauth_pending WHERE pending_id = $1",
      [pendingId],
    );
    const r = rows[0];
    if (!r) return null;
    if (Date.now() > Number(r.exp_ms)) {
      await pool.query("DELETE FROM mcp_oauth_pending WHERE pending_id = $1", [
        pendingId,
      ]);
      return null;
    }
    return { pendingId, ...JSON.parse(r.payload_json), exp: Number(r.exp_ms) };
  }

  async function mcpDeletePending(pendingId) {
    await pool.query("DELETE FROM mcp_oauth_pending WHERE pending_id = $1", [
      pendingId,
    ]);
  }

  async function mcpUpdatePending(pendingId, patch) {
    const row = await mcpGetPending(pendingId);
    if (!row) return null;
    const next = { ...row, ...patch };
    delete next.pendingId;
    delete next.exp;
    await pool.query(
      "UPDATE mcp_oauth_pending SET payload_json = $1 WHERE pending_id = $2",
      [JSON.stringify(next), pendingId],
    );
    return mcpGetPending(pendingId);
  }

  async function mcpCreateBrowserSession(email) {
    const sid = id("obs");
    await pool.query(
      "INSERT INTO mcp_browser_sessions (session_id, email, exp_ms) VALUES ($1,$2,$3)",
      [sid, normEmail(email), Date.now() + 15 * 60 * 1000],
    );
    return sid;
  }

  async function mcpGetBrowserSession(sid) {
    if (!sid) return null;
    const { rows } = await pool.query(
      "SELECT * FROM mcp_browser_sessions WHERE session_id = $1",
      [sid],
    );
    const r = rows[0];
    if (!r || Date.now() > Number(r.exp_ms)) {
      if (r) {
        await pool.query(
          "DELETE FROM mcp_browser_sessions WHERE session_id = $1",
          [sid],
        );
      }
      return null;
    }
    return { email: r.email, exp: Number(r.exp_ms) };
  }

  async function mcpCreateAuthCode(fields) {
    const code = id("ac");
    await pool.query(
      `INSERT INTO mcp_auth_codes
       (code_hash, email, client_id, redirect_uri, resource, code_challenge, code_challenge_method, scopes_json, exp_ms, used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)`,
      [
        hashToken(code),
        normEmail(fields.email),
        fields.clientId,
        fields.redirectUri,
        fields.resource,
        fields.codeChallenge,
        fields.codeChallengeMethod || "S256",
        JSON.stringify(fields.scopes || ["atoms:read"]),
        Date.now() + 5 * 60 * 1000,
      ],
    );
    return code;
  }

  async function mintMcpTokens(email, clientId, resource, scopes = ["atoms:read"]) {
    const e = normEmail(email);
    const access = id("mcp");
    const refresh = id("mcpr");
    const scopesJson = JSON.stringify(scopes);
    await pool.query(
      `INSERT INTO mcp_access_tokens (token_hash, email, client_id, resource, scopes_json, exp_ms, revoked)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE)`,
      [hashToken(access), e, clientId, resource, scopesJson, Date.now() + 3600_000],
    );
    await pool.query(
      `INSERT INTO mcp_refresh_tokens (token_hash, email, client_id, resource, scopes_json, exp_ms, revoked)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE)`,
      [
        hashToken(refresh),
        e,
        clientId,
        resource,
        scopesJson,
        Date.now() + 30 * 86400_000,
      ],
    );
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresIn: 3600,
      tokenType: "Bearer",
      scope: scopes.join(" "),
    };
  }

  async function mcpExchangeCode(opts) {
    const { rows } = await pool.query(
      "SELECT * FROM mcp_auth_codes WHERE code_hash = $1",
      [hashToken(opts.code)],
    );
    const r = rows[0];
    if (!r || r.used || Date.now() > Number(r.exp_ms)) return null;
    if (r.client_id !== opts.clientId) return null;
    if (r.redirect_uri !== opts.redirectUri) return null;
    if (r.resource !== opts.resource) return null;
    if (
      !verifyPkce(opts.codeVerifier, r.code_challenge, r.code_challenge_method)
    ) {
      return null;
    }
    await pool.query(
      "UPDATE mcp_auth_codes SET used = TRUE WHERE code_hash = $1",
      [hashToken(opts.code)],
    );
    const scopes = JSON.parse(r.scopes_json || '["atoms:read"]');
    return mintMcpTokens(r.email, r.client_id, r.resource, scopes);
  }

  async function mcpRefreshTokens(refreshToken, { clientId, resource } = {}) {
    const h = hashToken(refreshToken);
    const { rows } = await pool.query(
      "SELECT * FROM mcp_refresh_tokens WHERE token_hash = $1",
      [h],
    );
    const r = rows[0];
    if (!r || r.revoked || Date.now() > Number(r.exp_ms)) return null;
    if (clientId && r.client_id !== clientId) return null;
    if (resource && r.resource !== resource) return null;
    await pool.query("DELETE FROM mcp_refresh_tokens WHERE token_hash = $1", [
      h,
    ]);
    const scopes = JSON.parse(r.scopes_json || '["atoms:read"]');
    return mintMcpTokens(r.email, r.client_id, r.resource, scopes);
  }

  async function accountFromMcpToken(accessToken) {
    if (!accessToken) return null;
    const { rows } = await pool.query(
      "SELECT * FROM mcp_access_tokens WHERE token_hash = $1",
      [hashToken(accessToken)],
    );
    const r = rows[0];
    if (!r || r.revoked || Date.now() > Number(r.exp_ms)) return null;
    const a = await deps.refreshAccountStatus(await deps.getAccount(r.email));
    if (!a) return null;
    if (a.status !== "active" && a.status !== "trialing") return null;
    return a;
  }

  async function mcpRegisterClient(meta) {
    const clientId = meta.client_id || id("cli");
    await pool.query(
      `INSERT INTO mcp_oauth_clients (client_id, redirect_uris_json, client_name, token_endpoint_auth_method)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_id) DO UPDATE SET
         redirect_uris_json=EXCLUDED.redirect_uris_json,
         client_name=EXCLUDED.client_name`,
      [
        clientId,
        JSON.stringify(meta.redirect_uris || []),
        meta.client_name || "",
        meta.token_endpoint_auth_method || "none",
      ],
    );
    return {
      client_id: clientId,
      redirect_uris: meta.redirect_uris || [],
      token_endpoint_auth_method: "none",
    };
  }

  async function mcpGetClient(clientId) {
    const { rows } = await pool.query(
      "SELECT * FROM mcp_oauth_clients WHERE client_id = $1",
      [clientId],
    );
    const r = rows[0];
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
    mcpExchangeCode,
    mcpRefreshTokens,
    accountFromMcpToken,
    mcpRevokeForEmail,
    mcpRegisterClient,
    mcpGetClient,
    mintMcpTokensForTest: mintMcpTokens,
  };
}
