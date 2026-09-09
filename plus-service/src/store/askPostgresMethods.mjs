/**
 * Ask mirror + MCP OAuth methods for Postgres Pool.
 */
import {
  G2_ACCESS_TTL_MS, G2_PAIR_CODE_TTL_MS,
  G2_REFRESH_TTL_MS, hashToken, id, mergeG2Consent, mergeG2Disclosure, normalizeG2Scopes,
  G2_RECEIPT_RETENTION_MS,
  publicG2Consent, publicG2Device,
  subscriptionLive,
} from "./shared.mjs";
import { decryptMirrorField, encryptMirrorField } from "../mirror/crypto.mjs";
import { config } from "../config.mjs";
import { decryptG2ArtifactOrLegacy, encryptG2Artifact } from "../g2/crypto.mjs";
import {
  aggregateMirrorTags,
  buildNeighborsGraph,
  rankSearchHits,
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
  g2MirrorReceipt,
  normalizeOutboxReceiptTarget,
  assertMirrorPath,
  generatePairCode,
  normalizePairCodeInput,
  PAIR_CODE_TTL_MS,
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
  created TEXT,
  expand_enc TEXT,
  loop_json TEXT,
  PRIMARY KEY (email, path)
);
CREATE INDEX IF NOT EXISTS idx_atom_mirror_email ON atom_mirror(email);
CREATE INDEX IF NOT EXISTS idx_atom_mirror_email_atom_id ON atom_mirror(email, atom_id);
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
CREATE TABLE IF NOT EXISTS mcp_pair_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  exp_ms BIGINT NOT NULL,
  consumed_ms BIGINT
);
CREATE INDEX IF NOT EXISTS idx_mcp_pair_codes_hash ON mcp_pair_codes(code_hash);
CREATE TABLE IF NOT EXISTS g2_pair_codes (
  code_hash TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL,
  exp_ms BIGINT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_g2_pair_codes_email ON g2_pair_codes(email);
CREATE TABLE IF NOT EXISTS g2_device_families (
  family_id TEXT PRIMARY KEY, email TEXT NOT NULL, key_thumbprint TEXT NOT NULL,
  name TEXT NOT NULL, scopes_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_g2_families_email ON g2_device_families(email);
CREATE TABLE IF NOT EXISTS g2_access_tokens (
  token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL, scopes_json TEXT NOT NULL, exp_ms BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS g2_refresh_tokens (
  token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL, scopes_json TEXT NOT NULL, exp_ms BIGINT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE, used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS g2_proof_replay (jti TEXT PRIMARY KEY, exp_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS g2_attempt_budgets (
  attempt_key TEXT PRIMARY KEY, window_start_ms BIGINT NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS g2_consent (
  email TEXT PRIMARY KEY, revision BIGINT NOT NULL,
  g2_disclosure_granted BOOLEAN NOT NULL, g2_disclosure_version TEXT NOT NULL,
  ask_mirror_granted BOOLEAN NOT NULL, ask_mirror_version TEXT NOT NULL,
  ask_write_granted BOOLEAN NOT NULL, ask_write_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS g2_transcriptions (
  recording_id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
  generation BIGINT NOT NULL, state TEXT NOT NULL, lease_owner TEXT,
  lease_until_ms BIGINT NOT NULL, transcript_enc TEXT, retained_until_ms BIGINT
);
CREATE TABLE IF NOT EXISTS g2_preparations (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
  payload_enc TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS g2_transcription_tickets (
  ticket_hash TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL, origin TEXT NOT NULL, generation BIGINT NOT NULL,
  recording_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_g2_tickets_binding ON g2_transcription_tickets(email, family_id, generation);
CREATE TABLE IF NOT EXISTS g2_transcription_slots (
  recording_id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_g2_slots_email ON g2_transcription_slots(email, expires_at);
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
  , receipt_json JSONB,
  g2_receipt_expires_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_ask_outbox_email_status ON ask_outbox(email, status);
CREATE INDEX IF NOT EXISTS idx_ask_outbox_g2_receipt_expiry ON ask_outbox(g2_receipt_expires_at)
  WHERE g2_receipt_expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ask_outbox_email_crid
  ON ask_outbox(email, client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id != '';
`;

/**
 * @param {import("pg").Pool} pool
 * @param {{ getAccount: Function, refreshAccountStatus: Function }} deps
 */
export function createAskPostgresMethods(pool, deps) {
  const normDevice = (r) => publicG2Device({
    ...r, familyId: r.family_id, scopes: JSON.parse(r.scopes_json || "[]"),
    createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  });

  async function g2PairMint(email, opts = {}) {
    const e = normEmail(email); const now = opts.now ?? Date.now(); const code = generatePairCode();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize replacement codes for one account even when no prior code
      // row exists yet. The account is guaranteed to exist before mint.
      await client.query("SELECT 1 FROM accounts WHERE email=$1 FOR UPDATE", [e]);
      await client.query("DELETE FROM g2_pair_codes WHERE email=$1 AND used=FALSE", [e]);
      await client.query("INSERT INTO g2_pair_codes VALUES ($1,$2,$3,$4,FALSE)",
        [hashToken(code), e, JSON.stringify(normalizeG2Scopes(opts.scopes)), now + G2_PAIR_CODE_TTL_MS]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { code, expiresAt: new Date(now + G2_PAIR_CODE_TTL_MS).toISOString() };
  }

  async function insertG2Tokens(client, family, now) {
    const accessToken = id("g2a"); const refreshToken = id("g2r");
    const args = [family.family_id, family.email, family.key_thumbprint, family.scopes_json];
    await client.query("INSERT INTO g2_access_tokens VALUES ($1,$2,$3,$4,$5,$6,FALSE)",
      [hashToken(accessToken), ...args, now + G2_ACCESS_TTL_MS]);
    await client.query("INSERT INTO g2_refresh_tokens VALUES ($1,$2,$3,$4,$5,$6,FALSE,FALSE)",
      [hashToken(refreshToken), ...args, now + G2_REFRESH_TTL_MS]);
    return { accessToken, refreshToken, expiresIn: G2_ACCESS_TTL_MS / 1000 };
  }

  async function g2PairRedeem(code, opts = {}) {
    const now = opts.now ?? Date.now(); if (!opts.jkt) return null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM g2_pair_codes WHERE code_hash=$1 FOR UPDATE", [hashToken(normalizePairCodeInput(code))]);
      const row = rows[0];
      if (!row || row.used || Number(row.exp_ms) < now || !subscriptionLive(await deps.getAccount(row.email), now)) {
        await client.query("ROLLBACK"); return null;
      }
      await client.query("UPDATE g2_pair_codes SET used=TRUE WHERE code_hash=$1", [row.code_hash]);
      const family = { family_id: id("g2d"), email: row.email, key_thumbprint: opts.jkt,
        name: String(opts.name || "Even G2").slice(0, 80), scopes_json: row.scopes_json,
        created_at: new Date(now), last_seen_at: new Date(now), revoked: false };
      await client.query("INSERT INTO g2_device_families VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)",
        [family.family_id, family.email, family.key_thumbprint, family.name, family.scopes_json, family.created_at, family.last_seen_at]);
      const tokens = await insertG2Tokens(client, family, now); await client.query("COMMIT");
      return { ...tokens, scopes: JSON.parse(row.scopes_json), device: normDevice(family) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function revokeFamily(client, familyId) {
    await client.query("UPDATE g2_device_families SET revoked=TRUE WHERE family_id=$1", [familyId]);
    await client.query("UPDATE g2_access_tokens SET revoked=TRUE WHERE family_id=$1", [familyId]);
    await client.query("UPDATE g2_refresh_tokens SET revoked=TRUE WHERE family_id=$1", [familyId]);
    await client.query("UPDATE g2_transcriptions SET state='revoked', lease_owner=NULL, lease_until_ms=0, transcript_enc=NULL WHERE family_id=$1", [familyId]);
    await client.query("DELETE FROM g2_preparations WHERE family_id=$1", [familyId]);
    await client.query("DELETE FROM g2_transcription_tickets WHERE family_id=$1", [familyId]);
    await client.query("DELETE FROM g2_transcription_slots WHERE family_id=$1", [familyId]);
  }

  async function g2Refresh(token, jkt, opts = {}) {
    const now = opts.now ?? Date.now(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM g2_refresh_tokens WHERE token_hash=$1 FOR UPDATE", [hashToken(String(token || ""))]);
      const row = rows[0]; if (!row) { await client.query("ROLLBACK"); return null; }
      if (row.used) { await revokeFamily(client, row.family_id); await client.query("COMMIT"); return null; }
      const family = (await client.query("SELECT * FROM g2_device_families WHERE family_id=$1 FOR UPDATE", [row.family_id])).rows[0];
      if (row.revoked || Number(row.exp_ms) < now || !family || family.revoked || row.key_thumbprint !== jkt || !subscriptionLive(await deps.getAccount(row.email), now)) {
        await client.query("ROLLBACK"); return null;
      }
      await client.query("UPDATE g2_refresh_tokens SET used=TRUE WHERE token_hash=$1", [row.token_hash]);
      family.last_seen_at = new Date(now);
      await client.query("UPDATE g2_device_families SET last_seen_at=$1 WHERE family_id=$2", [family.last_seen_at, family.family_id]);
      const tokens = await insertG2Tokens(client, family, now); await client.query("COMMIT");
      return { ...tokens, scopes: JSON.parse(family.scopes_json), device: normDevice(family) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2AccessLookup(token, opts = {}) {
    const now = opts.now ?? Date.now();
    const { rows } = await pool.query(`SELECT t.*, f.name, f.created_at, f.last_seen_at, f.revoked AS family_revoked
      FROM g2_access_tokens t JOIN g2_device_families f ON f.family_id=t.family_id WHERE t.token_hash=$1`, [hashToken(String(token || ""))]);
    const row = rows[0];
    if (!row || row.revoked || row.family_revoked || Number(row.exp_ms) < now || !subscriptionLive(await deps.getAccount(row.email), now)) return null;
    return { familyId: row.family_id, email: row.email, jkt: row.key_thumbprint,
      scopes: JSON.parse(row.scopes_json), exp: Number(row.exp_ms), device: normDevice(row) };
  }

  async function g2ListDevices(email) {
    const { rows } = await pool.query("SELECT * FROM g2_device_families WHERE email=$1 ORDER BY created_at DESC", [normEmail(email)]);
    return rows.map(normDevice);
  }

  async function g2RevokeDevice(email, familyId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = (await client.query("SELECT 1 FROM g2_device_families WHERE family_id=$1 AND email=$2 FOR UPDATE", [String(familyId), normEmail(email)])).rows[0];
      if (!row) { await client.query("ROLLBACK"); return false; }
      await revokeFamily(client, String(familyId));
      await client.query("DELETE FROM g2_preparations WHERE family_id=$1 AND email=$2", [String(familyId), normEmail(email)]);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2ReadConsent(email) {
    const { rows } = await pool.query("SELECT * FROM g2_consent WHERE email=$1", [normEmail(email)]);
    return publicG2Consent(rows[0]);
  }

  async function g2AuthorizeWith(queryable, binding, opts = {}, lock = false) {
    const email = normEmail(binding.email);
    const lockClause = lock ? " FOR UPDATE OF a, f, c" : "";
    const row = (await queryable.query(`SELECT a.status, a.period_end, f.revoked,
        c.revision, c.g2_disclosure_granted, c.g2_disclosure_version,
        c.ask_mirror_granted, c.ask_mirror_version, c.ask_write_granted, c.ask_write_version
      FROM accounts a
      JOIN g2_device_families f ON f.email=a.email AND f.family_id=$2
      JOIN g2_consent c ON c.email=a.email
      WHERE a.email=$1${lockClause}`, [email, String(binding.familyId)])).rows[0];
    const consent = publicG2Consent(row);
    return Boolean(subscriptionLive(row ? { ...row, periodEnd: row.period_end } : null) && row && !row.revoked &&
      consent.revision === Number(binding.generation) && consent.g2Disclosure.granted &&
      (!opts.requireMirror || consent.askMirror.granted) &&
      (!opts.requireWrite || (consent.askMirror.granted && consent.askWrite.granted)));
  }

  function g2Authorize(binding, opts = {}) {
    return g2AuthorizeWith(pool, binding, opts);
  }

  async function g2SynchronizeConsent(email, update) {
    const key = normEmail(email); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT 1 FROM accounts WHERE email=$1 FOR UPDATE", [key]);
      const current = (await client.query("SELECT * FROM g2_consent WHERE email=$1 FOR UPDATE", [key])).rows[0];
      const next = mergeG2Consent(current, update);
      if (next.revision !== publicG2Consent(current).revision) {
        await client.query(`INSERT INTO g2_consent VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(email) DO UPDATE SET revision=excluded.revision,
          g2_disclosure_granted=excluded.g2_disclosure_granted,
          g2_disclosure_version=excluded.g2_disclosure_version,
          ask_mirror_granted=excluded.ask_mirror_granted,
          ask_mirror_version=excluded.ask_mirror_version,
          ask_write_granted=excluded.ask_write_granted,
          ask_write_version=excluded.ask_write_version`, [
          key, next.revision, next.g2Disclosure.granted, next.g2Disclosure.version,
          next.askMirror.granted, next.askMirror.version,
          next.askWrite.granted, next.askWrite.version,
        ]);
        await client.query("DELETE FROM g2_transcription_tickets WHERE email=$1 AND generation<$2", [key, next.revision]);
      }
      if (!next.g2Disclosure.granted) await client.query("DELETE FROM g2_preparations WHERE email=$1", [key]);
      await client.query("COMMIT"); return next;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2SynchronizeDisclosure(email, update) {
    const key = normEmail(email); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT 1 FROM accounts WHERE email=$1 FOR UPDATE", [key]);
      const current = (await client.query("SELECT * FROM g2_consent WHERE email=$1 FOR UPDATE", [key])).rows[0];
      const next = mergeG2Disclosure(current, update);
      if (next.revision !== publicG2Consent(current).revision) {
        await client.query(`INSERT INTO g2_consent VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(email) DO UPDATE SET revision=excluded.revision,
          g2_disclosure_granted=excluded.g2_disclosure_granted,
          g2_disclosure_version=excluded.g2_disclosure_version,
          ask_mirror_granted=excluded.ask_mirror_granted,
          ask_mirror_version=excluded.ask_mirror_version,
          ask_write_granted=excluded.ask_write_granted,
          ask_write_version=excluded.ask_write_version`, [
          key, next.revision, next.g2Disclosure.granted, next.g2Disclosure.version,
          next.askMirror.granted, next.askMirror.version,
          next.askWrite.granted, next.askWrite.version,
        ]);
        await client.query("DELETE FROM g2_transcription_tickets WHERE email=$1 AND generation<$2", [key, next.revision]);
      }
      if (!next.g2Disclosure.granted) await client.query("DELETE FROM g2_preparations WHERE email=$1", [key]);
      await client.query("COMMIT"); return next;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  function transcriptionRow(row) {
    return row ? {
      recordingId: row.recording_id, email: row.email, familyId: row.family_id,
      generation: Number(row.generation), state: row.state, leaseOwner: row.lease_owner,
      leaseUntil: Number(row.lease_until_ms), retainedUntil: Number(row.retained_until_ms || 0),
      transcript: row.transcript_enc ? decryptG2ArtifactOrLegacy(row.transcript_enc, {
        account: row.email, artifact: "transcript", row: row.recording_id,
      }) : null,
    } : null;
  }

  async function g2TranscriptionClaim(binding, recordingId, owner, now = Date.now(), leaseMs = 30_000) {
    const idValue = String(recordingId); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = transcriptionRow((await client.query("SELECT * FROM g2_transcriptions WHERE recording_id=$1 FOR UPDATE", [idValue])).rows[0]);
      if (current && (current.email !== normEmail(binding.email) || current.familyId !== binding.familyId || current.generation !== binding.generation)) {
        await client.query("ROLLBACK"); return null;
      }
      if (current?.state === "completed" || (current?.state === "transcribing" && current.leaseUntil > now && current.leaseOwner !== owner)) {
        await client.query("ROLLBACK"); return { ...current, acquired: false };
      }
      await client.query(`INSERT INTO g2_transcriptions
        (recording_id,email,family_id,generation,state,lease_owner,lease_until_ms,transcript_enc)
        VALUES ($1,$2,$3,$4,'transcribing',$5,$6,$7)
        ON CONFLICT(recording_id) DO UPDATE SET state='transcribing', lease_owner=excluded.lease_owner,
        lease_until_ms=excluded.lease_until_ms`, [
        idValue, normEmail(binding.email), binding.familyId, binding.generation, owner,
        now + leaseMs, current?.transcript ? encryptG2Artifact(current.transcript, {
          account: normEmail(binding.email), artifact: "transcript", row: idValue,
        }) : null,
      ]);
      await client.query("COMMIT");
      return { ...(current ?? { recordingId: idValue, email: normEmail(binding.email), familyId: binding.familyId, generation: binding.generation, transcript: null }), state: "transcribing", leaseOwner: owner, leaseUntil: now + leaseMs, acquired: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2TranscriptionComplete(binding, recordingId, owner, transcript) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await g2AuthorizeWith(client, binding, {}, true)) { await client.query("ROLLBACK"); return false; }
      const result = await client.query(`UPDATE g2_transcriptions SET state='completed', lease_owner=NULL,
        lease_until_ms=0, transcript_enc=$1, retained_until_ms=$2 WHERE recording_id=$3 AND email=$4 AND family_id=$5
        AND generation=$6 AND lease_owner=$7 AND state='transcribing'`, [
        encryptG2Artifact(String(transcript), {
          account: normEmail(binding.email), artifact: "transcript", row: String(recordingId),
        }), Date.now() + config.g2TranscriptRetentionMs, String(recordingId), normEmail(binding.email),
        binding.familyId, binding.generation, owner,
      ]);
      await client.query("COMMIT"); return result.rowCount > 0;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2TranscriptionFail(binding, recordingId, owner, state) {
    const result = await pool.query(`UPDATE g2_transcriptions SET state=$1, lease_owner=NULL, lease_until_ms=0
      WHERE recording_id=$2 AND email=$3 AND family_id=$4 AND generation=$5 AND lease_owner=$6`, [
      String(state), String(recordingId), normEmail(binding.email), binding.familyId, binding.generation, owner,
    ]);
    return result.rowCount > 0;
  }

  async function g2TranscriptionGet(binding, recordingId) {
    const { rows } = await pool.query(`SELECT * FROM g2_transcriptions WHERE recording_id=$1
      AND email=$2 AND family_id=$3 AND generation=$4`, [
      String(recordingId), normEmail(binding.email), binding.familyId, binding.generation,
    ]);
    return transcriptionRow(rows[0]);
  }

  async function g2ConsumeProof(jti, expMs, now = Date.now()) {
    await pool.query("DELETE FROM g2_proof_replay WHERE exp_ms < $1", [now]);
    return (await pool.query("INSERT INTO g2_proof_replay VALUES ($1,$2) ON CONFLICT DO NOTHING", [jti, expMs])).rowCount > 0;
  }

  async function g2ConsumeAttempt(key, opts = {}) {
    const now = opts.now ?? Date.now(); const windowMs = opts.windowMs ?? 60_000; const limit = opts.limit ?? 12;
    const { rows } = await pool.query(`INSERT INTO g2_attempt_budgets VALUES ($1,$2,1)
      ON CONFLICT(attempt_key) DO UPDATE SET
      window_start_ms=CASE WHEN g2_attempt_budgets.window_start_ms + $3 <= $2 THEN $2 ELSE g2_attempt_budgets.window_start_ms END,
      attempts=CASE WHEN g2_attempt_budgets.window_start_ms + $3 <= $2 THEN 1 ELSE g2_attempt_budgets.attempts + 1 END
      RETURNING attempts`, [key, now, windowMs]);
    return rows[0].attempts <= limit;
  }

  async function g2TranscriptionTicketPut(ticketHash, binding, ticket) {
    await pool.query(`INSERT INTO g2_transcription_tickets
      (ticket_hash,email,family_id,key_thumbprint,origin,generation,recording_id,purpose,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (ticket_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at`, [
      String(ticketHash), normEmail(binding.email), String(binding.familyId), String(binding.jkt),
      String(binding.origin), Number(binding.generation), String(ticket.recordingId), String(ticket.purpose), Number(ticket.expiresAt),
    ]);
    return true;
  }

  async function g2TranscriptionTicketConsume(ticketHash, binding, now = Date.now()) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM g2_transcription_tickets WHERE ticket_hash=$1", [String(ticketHash)]);
      const row = rows[0];
      const valid = row && Number(row.expires_at) >= now && (!binding.email || row.email === normEmail(binding.email)) &&
        (!binding.familyId || row.family_id === String(binding.familyId)) && (!binding.jkt || row.key_thumbprint === String(binding.jkt)) &&
        (!binding.origin || row.origin === String(binding.origin)) &&
        (binding.generation === undefined || Number(row.generation) === Number(binding.generation));
      const deleted = await client.query("DELETE FROM g2_transcription_tickets WHERE ticket_hash=$1", [String(ticketHash)]);
      const consumed = valid && deleted.rowCount > 0;
      await client.query("COMMIT");
      return valid && consumed ? { recordingId: row.recording_id, purpose: row.purpose, expiresAt: Number(row.expires_at),
        binding: { email: row.email, familyId: row.family_id, jkt: row.key_thumbprint, origin: row.origin, generation: Number(row.generation) } } : null;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2TranscriptionTicketsInvalidate(email, familyId, generation) {
    const result = familyId
      ? await pool.query("DELETE FROM g2_transcription_tickets WHERE email=$1 AND family_id=$2 AND generation<$3", [normEmail(email), String(familyId), Number(generation)])
      : await pool.query("DELETE FROM g2_transcription_tickets WHERE email=$1 AND generation<$2", [normEmail(email), Number(generation)]);
    return result.rowCount;
  }

  async function g2SweepExpired(now = Date.now(), limit = 100) {
    const cap = Math.max(1, Math.min(1000, Number(limit) || 100));
    const remove = async (table, predicate) => (await pool.query(
      `DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${predicate} LIMIT $2)`, [now, cap],
    )).rowCount;
    const counts = {
      tickets: await remove("g2_transcription_tickets", "expires_at <= $1"),
      preparations: await remove("g2_preparations", "expires_at <= $1"),
      transcriptions: await remove("g2_transcriptions", "retained_until_ms IS NOT NULL AND retained_until_ms <= $1"),
      receipts: 0,
    };
    counts.receipts = (await pool.query(`DELETE FROM ask_outbox WHERE ctid IN
      (SELECT ctid FROM ask_outbox WHERE status='applied' AND g2_receipt_expires_at IS NOT NULL
       AND g2_receipt_expires_at<=$1 LIMIT $2)`, [now, cap])).rowCount;
    return counts;
  }

  async function g2TranscriptionSlotAcquire(binding, recordingId, now = Date.now(), leaseMs = 300_000, max = 2) {
    const email = normEmail(binding.email); const idValue = String(recordingId); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      await client.query("DELETE FROM g2_transcription_slots WHERE expires_at<=$1", [now]);
      const existing = (await client.query("SELECT * FROM g2_transcription_slots WHERE recording_id=$1 FOR UPDATE", [idValue])).rows[0];
      if (existing) {
        if (existing.email !== email) { await client.query("ROLLBACK"); return false; }
        await client.query("UPDATE g2_transcription_slots SET expires_at=$1 WHERE recording_id=$2", [now + leaseMs, idValue]);
        await client.query("COMMIT"); return true;
      }
      const count = Number((await client.query("SELECT COUNT(*) AS n FROM g2_transcription_slots WHERE email=$1", [email])).rows[0].n);
      if (count >= max) { await client.query("ROLLBACK"); return false; }
      await client.query("INSERT INTO g2_transcription_slots VALUES ($1,$2,$3,$4)", [idValue, email, String(binding.familyId), now + leaseMs]);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function g2TranscriptionSlotRelease(binding, recordingId) {
    return (await pool.query("DELETE FROM g2_transcription_slots WHERE recording_id=$1 AND email=$2", [String(recordingId), normEmail(binding.email)])).rowCount > 0;
  }
  async function mirrorUpsert(email, atoms) {
    const list = Array.isArray(atoms) ? atoms : [];
    let upserted = 0;
    let skipped = 0;
    /** @type {{ email: string, path: string, title: string, tags: string[], body: string, contentHash: string }[]} */
    const needExpand = [];
    for (const atom of list) {
      const row = prepareMirrorRow(email, atom);
      const body = String(atom.body ?? atom.text ?? "");
      const tags = Array.isArray(atom.tags) ? atom.tags.map(String) : [];
      const prev = await pool.query(
        "SELECT content_hash, expand_enc FROM atom_mirror WHERE email = $1 AND path = $2",
        [row.email, row.path],
      );
      const prevRow = prev.rows[0];
      if (prevRow?.content_hash === row.contentHash) {
        skipped += 1;
        if (!prevRow.expand_enc) {
          needExpand.push({
            email: row.email,
            path: row.path,
            title: row.title,
            tags,
            body,
            contentHash: row.contentHash,
          });
        }
        continue;
      }
      await pool.query(
        `INSERT INTO atom_mirror (email, atom_id, title, path, body_enc, tags_json, links_json, content_hash, updated_at, created, expand_enc, loop_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11)
         ON CONFLICT (email, path) DO UPDATE SET
           atom_id=EXCLUDED.atom_id, title=EXCLUDED.title, body_enc=EXCLUDED.body_enc,
           tags_json=EXCLUDED.tags_json, links_json=EXCLUDED.links_json,
           content_hash=EXCLUDED.content_hash, updated_at=EXCLUDED.updated_at,
           created=COALESCE(EXCLUDED.created, atom_mirror.created),
           expand_enc=NULL,
           loop_json=COALESCE(EXCLUDED.loop_json, atom_mirror.loop_json)`,
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
          row.created,
          row.loopJson,
        ],
      );
      upserted += 1;
      needExpand.push({
        email: row.email,
        path: row.path,
        title: row.title,
        tags,
        body,
        contentHash: row.contentHash,
      });
    }
    return { upserted, skipped, needExpand };
  }

  async function mirrorSetExpand(email, path, contentHash, expandPlain) {
    const e = normEmail(email);
    const p = String(path || "").trim();
    const hash = String(contentHash || "");
    if (!e || !p || !hash) return { ok: false, updated: 0 };
    const enc = encryptMirrorField(String(expandPlain || ""));
    const r = await pool.query(
      `UPDATE atom_mirror SET expand_enc = $1
       WHERE email = $2 AND path = $3 AND content_hash = $4`,
      [enc, e, p, hash],
    );
    return { ok: true, updated: r.rowCount || 0 };
  }

  async function mirrorExpandCoverage(email) {
    const e = normEmail(email);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE expand_enc IS NOT NULL AND btrim(expand_enc) <> '')::int AS e
       FROM atom_mirror WHERE email = $1`,
      [e],
    );
    const n = rows[0]?.n || 0;
    if (!n) return 0;
    return (rows[0]?.e || 0) / n;
  }

  /**
   * Rows missing expand for backfill. Decrypts body server-side only.
   * @param {string} email
   * @param {number} limit
   */
  async function mirrorListMissingExpand(email, limit = 50) {
    const e = normEmail(email);
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const { rows } = await pool.query(
      `SELECT path, title, tags_json, body_enc, content_hash
       FROM atom_mirror
       WHERE email = $1 AND (expand_enc IS NULL OR btrim(expand_enc) = '')
       ORDER BY updated_at DESC
       LIMIT $2`,
      [e, lim],
    );
    return rows.map((r) => {
      const pub = rowToPublicAtom(r, { includeBody: true });
      return {
        path: r.path,
        title: r.title,
        tags: pub?.tags || [],
        body: pub?.text || "",
        contentHash: r.content_hash,
      };
    });
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

  async function mirrorFetchById(email, atomId) {
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email=$1 AND atom_id=$2 LIMIT 1",
      [normEmail(email), String(atomId || "")],
    );
    return rows[0] ? rowToPublicAtom(rows[0], { includeBody: true }) : null;
  }

  async function mirrorSearch(email, query, limit = 8, opts = {}) {
    const e = normEmail(email);
    const { rows } = await pool.query(
      "SELECT * FROM atom_mirror WHERE email = $1",
      [e],
    );
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: true }));
    return rankSearchHits(pubs, query, limit, opts);
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
    await pool.query("DELETE FROM g2_preparations WHERE email = $1", [e]);
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

  async function outboxOpenCountWith(queryable, email) {
    const e = normEmail(email);
    const r = await queryable.query(
      `SELECT COUNT(*)::int AS n FROM ask_outbox
       WHERE email = $1 AND status IN ('pending','claimed')`,
      [e],
    );
    return r.rows[0]?.n ?? 0;
  }

  function outboxOpenCount(email) {
    return outboxOpenCountWith(pool, email);
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
      receipt: r.receipt_json || null,
    });
  }

  async function outboxEnqueueWith(queryable, email, opts) {
    const e = normEmail(email);
    const kind =
      opts.kind === "continue"
        ? "continue"
        : opts.kind === "set_loop"
          ? "set_loop"
          : "create";
    const crid = opts.client_request_id
      ? String(opts.client_request_id).trim().slice(0, 128)
      : "";
    if (crid) {
      const existing = await queryable.query(
        `SELECT * FROM ask_outbox WHERE email = $1 AND client_request_id = $2`,
        [e, crid],
      );
      if (existing.rows[0]) {
        if (opts.proposal_fingerprint && decryptOutboxPayload(existing.rows[0].payload_enc)?.proposal_fingerprint !== opts.proposal_fingerprint) {
          return { ok: false, error: "idempotency_conflict" };
        }
        return {
          ok: true,
          ...outboxRowFromDb(existing.rows[0]),
          duplicate: true,
        };
      }
    }
    if ((await outboxOpenCountWith(queryable, e)) >= OUTBOX_MAX_OPEN) {
      return { ok: false, error: "outbox_full" };
    }
    const idRow = id("obx");
    const now = new Date().toISOString();
    const payload_enc = encryptOutboxPayload(opts.payload);
    const inserted = await queryable.query(
      `INSERT INTO ask_outbox
       (id, email, kind, payload_enc, status, client_request_id, error, created_at, claimed_at, applied_at, receipt_json)
       VALUES ($1, $2, $3, $4, 'pending', $5, NULL, $6, NULL, NULL, NULL)
       ON CONFLICT (email, client_request_id)
       WHERE client_request_id IS NOT NULL AND client_request_id != ''
       DO NOTHING
       RETURNING *`,
      [idRow, e, kind, payload_enc, crid || null, now],
    );
    if (inserted.rows[0]) {
      return {
        ok: true,
        ...outboxRowFromDb(inserted.rows[0]),
        duplicate: false,
      };
    }
    if (crid) {
      const existing = await queryable.query(
        `SELECT * FROM ask_outbox WHERE email = $1 AND client_request_id = $2`,
        [e, crid],
      );
      if (!existing.rows[0]) return { ok: false, error: "enqueue_conflict" };
      if (
        opts.proposal_fingerprint &&
        decryptOutboxPayload(existing.rows[0].payload_enc)
          ?.proposal_fingerprint !== opts.proposal_fingerprint
      ) {
        return { ok: false, error: "idempotency_conflict" };
      }
      return {
        ok: true,
        ...outboxRowFromDb(existing.rows[0]),
        duplicate: true,
      };
    }
    return { ok: false, error: "enqueue_conflict" };
  }

  function outboxEnqueue(email, opts) {
    return outboxEnqueueWith(pool, email, opts);
  }

  async function g2OutboxEnqueue(binding, opts) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await g2AuthorizeWith(client, binding, { requireWrite: true }, true)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "setup_required" };
      }
      const result = await outboxEnqueueWith(client, binding.email, opts);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
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
    let receipt = null;
    if (st === "applied" && row.rows[0].kind === "create") {
      const payload = decryptOutboxPayload(row.rows[0].payload_enc);
      if (payload?.origin === "g2") {
        const targetPath = normalizeOutboxReceiptTarget(opts.target_path);
        const mirrorRows = targetPath
          ? await pool.query("SELECT * FROM atom_mirror WHERE email=$1 AND path=$2", [e, targetPath])
          : { rows: [] };
        receipt = g2MirrorReceipt(payload, mirrorRows.rows[0] ? rowToPublicAtom(mirrorRows.rows[0], { includeBody: true }) : null, targetPath);
        if (!receipt) return { ok: false, error: "mirror_receipt_required" };
      }
    }
    const now = new Date().toISOString();
    await pool.query(
      `UPDATE ask_outbox SET status = $1, error = $2, applied_at = $3, receipt_json = $4, g2_receipt_expires_at = $5
       WHERE id = $6 AND email = $7`,
      [
        st,
        opts.error ? String(opts.error).slice(0, 500) : null,
        now,
        receipt,
        receipt ? Date.now() + G2_RECEIPT_RETENTION_MS : null,
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

  async function g2PreparationPut(email, row) {
    const e = normEmail(email);
    await pool.query(`INSERT INTO g2_preparations (id,email,family_id,payload_enc,expires_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET payload_enc=EXCLUDED.payload_enc, expires_at=EXCLUDED.expires_at`,
      [row.id, e, row.familyId, encryptG2Artifact(JSON.stringify(row.payload), {
        account: e, artifact: "preparation", row: row.id,
      }), row.expiresAt]);
    return { ...row, email: e };
  }

  async function g2PreparationGet(email, preparationId, familyId) {
    const { rows } = await pool.query(`SELECT * FROM g2_preparations WHERE id=$1 AND email=$2 AND family_id=$3`,
      [String(preparationId || ""), normEmail(email), String(familyId || "")]);
    const row = rows[0];
    return row ? { id: row.id, email: row.email, familyId: row.family_id, expiresAt: Number(row.expires_at),
      payload: JSON.parse(decryptG2ArtifactOrLegacy(row.payload_enc, {
        account: row.email, artifact: "preparation", row: row.id,
      })) } : null;
  }

  async function g2PreparationDelete(email, preparationId) {
    const result = await pool.query(`DELETE FROM g2_preparations WHERE id=$1 AND email=$2`, [String(preparationId || ""), normEmail(email)]);
    return result.rowCount > 0;
  }

  async function outboxPendingCount(email) {
    const e = normEmail(email);
    await outboxReclaimStale(e);
    return outboxOpenCount(e);
  }

  async function outboxListOpen(email) {
    const e = normEmail(email);
    await outboxReclaimStale(e);
    const { rows } = await pool.query(
      `SELECT * FROM ask_outbox
       WHERE email = $1 AND status IN ('pending','claimed')
       ORDER BY created_at ASC`,
      [e],
    );
    return rows.map((r) => outboxRowFromDb(r));
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
    // List columns only — never pull body_enc for pagination scans.
    const { rows } = await pool.query(
      `SELECT email, atom_id, title, path, tags_json, links_json,
              content_hash, updated_at, created, loop_json
       FROM atom_mirror WHERE email = $1`,
      [e],
    );
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: false }));
    return paginateMirrorList(pubs, opts);
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

  async function mirrorListTags(email) {
    const e = normEmail(email);
    const { rows } = await pool.query(
      `SELECT tags_json FROM atom_mirror WHERE email = $1
       ORDER BY path ASC`,
      [e],
    );
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

  async function pairMint(email) {
    const e = normEmail(email);
    const code = generatePairCode();
    const expMs = Date.now() + PAIR_CODE_TTL_MS;
    await pool.query(
      `INSERT INTO mcp_pair_codes (email, code_hash, exp_ms, consumed_ms)
       VALUES ($1,$2,$3,NULL)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         exp_ms = EXCLUDED.exp_ms,
         consumed_ms = NULL`,
      [e, hashToken(code), expMs],
    );
    return { code, expiresAt: new Date(expMs).toISOString() };
  }

  async function pairRedeem(rawCode) {
    const code = normalizePairCodeInput(rawCode);
    if (!code || code.length < 6) return null;
    const h = hashToken(code);
    const { rows } = await pool.query(
      "SELECT * FROM mcp_pair_codes WHERE code_hash = $1",
      [h],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.consumed_ms != null) return null;
    if (Date.now() > Number(r.exp_ms)) return null;
    const upd = await pool.query(
      `UPDATE mcp_pair_codes SET consumed_ms = $1
       WHERE email = $2 AND code_hash = $3 AND consumed_ms IS NULL
       RETURNING email`,
      [Date.now(), r.email, h],
    );
    if (!upd.rows[0]) return null;
    return { email: upd.rows[0].email };
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
    if (!subscriptionLive(a)) return null;
    let mcpScopes = ["atoms:read"];
    try {
      const parsed = JSON.parse(r.scopes_json || "[]");
      if (Array.isArray(parsed) && parsed.length) mcpScopes = parsed;
    } catch {
      /* keep default */
    }
    return { ...a, mcpScopes };
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
    mirrorSetExpand,
    mirrorExpandCoverage,
    mirrorListMissingExpand,
    mirrorFetch,
    mirrorFetchById,
    mirrorSearch,
    mirrorNeighbors,
    mirrorWipe,
    mirrorStatus,
    mirrorListTags,
    mirrorDelete,
    mirrorReconcileKeep,
    outboxEnqueue,
    g2OutboxEnqueue,
    outboxPull,
    outboxAck,
    outboxGet,
    outboxPendingCount,
    outboxCancel,
    outboxListOpen,
    outboxHasOpenTitle,
    g2PreparationPut,
    g2PreparationGet,
    g2PreparationDelete,
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
    g2PairMint, g2PairRedeem, g2Refresh, g2AccessLookup, g2ListDevices,
    g2RevokeDevice, g2ReadConsent, g2Authorize, g2SynchronizeConsent, g2SynchronizeDisclosure,
    g2TranscriptionClaim, g2TranscriptionComplete, g2TranscriptionFail, g2TranscriptionGet,
    g2TranscriptionTicketPut, g2TranscriptionTicketConsume, g2TranscriptionTicketsInvalidate, g2SweepExpired,
    g2TranscriptionSlotAcquire, g2TranscriptionSlotRelease,
    g2ConsumeProof, g2ConsumeAttempt,
  };
}
