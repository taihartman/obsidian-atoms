/**
 * Ask mirror + MCP OAuth methods for SQLite DatabaseSync.
 */
import { hashToken, id } from "./shared.mjs";
import {
  makeSnippet,
  normEmail,
  prepareMirrorRow,
  rowToPublicAtom,
  scoreSearch,
  verifyPkce,
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

  function mirrorSearch(email, query, limit = 8) {
    const e = normEmail(email);
    const lim = Math.min(Math.max(Number(limit) || 8, 1), 25);
    const rows = db.prepare("SELECT * FROM atom_mirror WHERE email = ?").all(e);
    const scored = [];
    for (const r of rows) {
      const pub = rowToPublicAtom(r, { includeBody: true });
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

  function mcpRevokeForEmail(email) {
    const e = normEmail(email);
    db.prepare("DELETE FROM mcp_access_tokens WHERE email = ?").run(e);
    db.prepare("DELETE FROM mcp_refresh_tokens WHERE email = ?").run(e);
  }

  function mirrorWipe(email) {
    const e = normEmail(email);
    db.prepare("DELETE FROM atom_mirror WHERE email = ?").run(e);
    mcpRevokeForEmail(e);
    return { ok: true };
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
    return a;
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
    mirrorWipe,
    mirrorStatus,
    mcpCreatePending,
    mcpGetPending,
    mcpDeletePending,
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
