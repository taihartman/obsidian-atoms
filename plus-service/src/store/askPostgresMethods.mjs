/**
 * Ask mirror + MCP OAuth methods for Postgres Pool.
 */
import { hashToken, id } from "./shared.mjs";
import {
  makeSnippet,
  matchesTagFilter,
  mergeLinksFromBody,
  normEmail,
  prepareMirrorRow,
  rowToPublicAtom,
  scoreSearch,
  verifyPkce,
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
    const lim = Math.min(Math.max(Number(limit) || 8, 1), 25);
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email = $1",
      [e],
    );
    const tagFilter = opts.tags;
    const scored = [];
    for (const r of rows) {
      const pub = rowToPublicAtom(r, { includeBody: true });
      if (!matchesTagFilter(pub.tags, tagFilter)) continue;
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
            score: s,
            snippet: makeSnippet(pub.text, query),
          },
        });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title));
    return scored.slice(0, lim).map((x) => x.hit);
  }

  async function mirrorNeighbors(email, idOrTitle) {
    const center = await mirrorFetch(email, idOrTitle);
    const keyTitle = center?.title || String(idOrTitle || "").trim();
    if (!keyTitle) return null;
    const keyLower = keyTitle.toLowerCase();
    const e = normEmail(email);
    const outgoing = center
      ? mergeLinksFromBody(center.links || [], center.text || []).map((l) => ({
          title: l.note,
          reason: l.reason || null,
          direction: "out",
        }))
      : [];
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email = $1",
      [e],
    );
    const backlinks = [];
    for (const r of rows) {
      const pub = rowToPublicAtom(r, { includeBody: true });
      if (pub.title.toLowerCase() === keyLower) continue;
      const links = mergeLinksFromBody(pub.links || [], pub.text || []);
      for (const l of links) {
        if (String(l.note || "").toLowerCase() === keyLower) {
          backlinks.push({
            title: pub.title,
            path: pub.path,
            reason: l.reason || null,
            direction: "in",
            snippet: makeSnippet(pub.text, keyTitle, 160),
          });
          break;
        }
      }
    }
    return {
      title: keyTitle,
      path: center?.path || null,
      found: Boolean(center),
      outgoing,
      backlinks,
    };
  }

  async function mcpRevokeForEmail(email) {
    const e = normEmail(email);
    await pool.query("DELETE FROM mcp_access_tokens WHERE email = $1", [e]);
    await pool.query("DELETE FROM mcp_refresh_tokens WHERE email = $1", [e]);
  }

  async function mirrorWipe(email) {
    const e = normEmail(email);
    await pool.query("DELETE FROM atom_mirror WHERE email = $1", [e]);
    await mcpRevokeForEmail(e);
    return { ok: true };
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
