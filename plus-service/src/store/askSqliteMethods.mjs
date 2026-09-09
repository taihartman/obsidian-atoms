/**
 * Ask mirror + MCP OAuth methods for SQLite DatabaseSync.
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
CREATE TABLE IF NOT EXISTS g2_pair_codes (
  code_hash TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL,
  exp_ms INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_g2_pair_codes_email ON g2_pair_codes(email);
CREATE TABLE IF NOT EXISTS g2_device_families (
  family_id TEXT PRIMARY KEY, email TEXT NOT NULL, key_thumbprint TEXT NOT NULL,
  name TEXT NOT NULL, scopes_json TEXT NOT NULL, created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_g2_families_email ON g2_device_families(email);
CREATE TABLE IF NOT EXISTS g2_access_tokens (
  token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL, scopes_json TEXT NOT NULL, exp_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS g2_refresh_tokens (
  token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL, scopes_json TEXT NOT NULL, exp_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS g2_proof_replay (jti TEXT PRIMARY KEY, exp_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS g2_attempt_budgets (
  attempt_key TEXT PRIMARY KEY, window_start_ms INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS g2_consent (
  email TEXT PRIMARY KEY, revision INTEGER NOT NULL,
  g2_disclosure_granted INTEGER NOT NULL, g2_disclosure_version TEXT NOT NULL,
  ask_mirror_granted INTEGER NOT NULL, ask_mirror_version TEXT NOT NULL,
  ask_write_granted INTEGER NOT NULL, ask_write_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS g2_transcriptions (
  recording_id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
  generation INTEGER NOT NULL, state TEXT NOT NULL, lease_owner TEXT,
  lease_until_ms INTEGER NOT NULL, transcript_enc TEXT, retained_until_ms INTEGER
);
CREATE TABLE IF NOT EXISTS g2_preparations (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
  payload_enc TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS g2_transcription_tickets (
  ticket_hash TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL, origin TEXT NOT NULL, generation INTEGER NOT NULL,
  recording_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_g2_tickets_binding ON g2_transcription_tickets(email, family_id, generation);
CREATE TABLE IF NOT EXISTS g2_transcription_slots (
  recording_id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL, expires_at INTEGER NOT NULL
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
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  applied_at TEXT
  , receipt_json TEXT,
  g2_receipt_expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ask_outbox_email_status ON ask_outbox(email, status);
CREATE INDEX IF NOT EXISTS idx_ask_outbox_g2_receipt_expiry ON ask_outbox(g2_receipt_expires_at)
  WHERE g2_receipt_expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ask_outbox_email_crid
  ON ask_outbox(email, client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id != '';
`;

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ getAccount: Function, refreshAccountStatus: Function }} deps
 */
export function createAskSqliteMethods(db, deps) {
  const normDevice = (r) => publicG2Device({
    ...r, familyId: r.family_id, scopes: JSON.parse(r.scopes_json || "[]"),
    createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  });

  function g2PairMint(email, opts = {}) {
    const e = normEmail(email); const now = opts.now ?? Date.now();
    const code = generatePairCode();
    db.prepare("DELETE FROM g2_pair_codes WHERE email = ? AND used = 0").run(e);
    db.prepare("INSERT INTO g2_pair_codes VALUES (?, ?, ?, ?, 0)").run(
      hashToken(code), e, JSON.stringify(normalizeG2Scopes(opts.scopes)), now + G2_PAIR_CODE_TTL_MS,
    );
    return { code, expiresAt: new Date(now + G2_PAIR_CODE_TTL_MS).toISOString() };
  }

  function insertG2Tokens(family, now) {
    const accessToken = id("g2a"); const refreshToken = id("g2r");
    const args = [family.family_id, family.email, family.key_thumbprint, family.scopes_json];
    db.prepare("INSERT INTO g2_access_tokens VALUES (?, ?, ?, ?, ?, ?, 0)").run(
      hashToken(accessToken), ...args, now + G2_ACCESS_TTL_MS,
    );
    db.prepare("INSERT INTO g2_refresh_tokens VALUES (?, ?, ?, ?, ?, ?, 0, 0)").run(
      hashToken(refreshToken), ...args, now + G2_REFRESH_TTL_MS,
    );
    return { accessToken, refreshToken, expiresIn: G2_ACCESS_TTL_MS / 1000 };
  }

  function g2PairRedeem(code, opts = {}) {
    const now = opts.now ?? Date.now(); if (!opts.jkt) return null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM g2_pair_codes WHERE code_hash = ?").get(hashToken(normalizePairCodeInput(code)));
      if (!row || row.used || Number(row.exp_ms) < now || !subscriptionLive(deps.getAccount(row.email), now)) {
        db.exec("ROLLBACK"); return null;
      }
      db.prepare("UPDATE g2_pair_codes SET used = 1 WHERE code_hash = ?").run(row.code_hash);
      const family = { family_id: id("g2d"), email: row.email, key_thumbprint: opts.jkt,
        name: String(opts.name || "Even G2").slice(0, 80), scopes_json: row.scopes_json,
        created_at: new Date(now).toISOString(), last_seen_at: new Date(now).toISOString(), revoked: 0 };
      db.prepare("INSERT INTO g2_device_families VALUES (?, ?, ?, ?, ?, ?, ?, 0)").run(
        family.family_id, family.email, family.key_thumbprint, family.name, family.scopes_json,
        family.created_at, family.last_seen_at,
      );
      const tokens = insertG2Tokens(family, now); db.exec("COMMIT");
      return { ...tokens, scopes: JSON.parse(row.scopes_json), device: normDevice(family) };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function revokeFamily(familyId) {
    db.prepare("UPDATE g2_device_families SET revoked = 1 WHERE family_id = ?").run(familyId);
    db.prepare("UPDATE g2_access_tokens SET revoked = 1 WHERE family_id = ?").run(familyId);
    db.prepare("UPDATE g2_refresh_tokens SET revoked = 1 WHERE family_id = ?").run(familyId);
    db.prepare("UPDATE g2_transcriptions SET state='revoked', lease_owner=NULL, lease_until_ms=0, transcript_enc=NULL WHERE family_id=?").run(familyId);
    db.prepare("DELETE FROM g2_preparations WHERE family_id=?").run(familyId);
    db.prepare("DELETE FROM g2_transcription_tickets WHERE family_id=?").run(familyId);
    db.prepare("DELETE FROM g2_transcription_slots WHERE family_id=?").run(familyId);
  }

  function g2Refresh(token, jkt, opts = {}) {
    const now = opts.now ?? Date.now(); db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM g2_refresh_tokens WHERE token_hash = ?").get(hashToken(String(token || "")));
      if (!row) { db.exec("ROLLBACK"); return null; }
      if (row.used) { revokeFamily(row.family_id); db.exec("COMMIT"); return null; }
      const family = db.prepare("SELECT * FROM g2_device_families WHERE family_id = ?").get(row.family_id);
      if (row.revoked || Number(row.exp_ms) < now || !family || family.revoked || row.key_thumbprint !== jkt || !subscriptionLive(deps.getAccount(row.email), now)) {
        db.exec("ROLLBACK"); return null;
      }
      db.prepare("UPDATE g2_refresh_tokens SET used = 1 WHERE token_hash = ?").run(row.token_hash);
      db.prepare("UPDATE g2_device_families SET last_seen_at = ? WHERE family_id = ?").run(new Date(now).toISOString(), family.family_id);
      const tokens = insertG2Tokens(family, now); db.exec("COMMIT");
      return { ...tokens, scopes: JSON.parse(family.scopes_json), device: normDevice(family) };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2AccessLookup(token, opts = {}) {
    const now = opts.now ?? Date.now();
    const row = db.prepare(`SELECT t.*, f.name, f.created_at, f.last_seen_at, f.revoked AS family_revoked
      FROM g2_access_tokens t JOIN g2_device_families f ON f.family_id=t.family_id WHERE t.token_hash=?`).get(hashToken(String(token || "")));
    if (!row || row.revoked || row.family_revoked || Number(row.exp_ms) < now || !subscriptionLive(deps.getAccount(row.email), now)) return null;
    return { familyId: row.family_id, email: row.email, jkt: row.key_thumbprint,
      scopes: JSON.parse(row.scopes_json), exp: Number(row.exp_ms), device: normDevice(row) };
  }

  function g2ListDevices(email) {
    return db.prepare("SELECT * FROM g2_device_families WHERE email = ? ORDER BY created_at DESC").all(normEmail(email)).map(normDevice);
  }

  function g2RevokeDevice(email, familyId) {
    const row = db.prepare("SELECT 1 FROM g2_device_families WHERE family_id=? AND email=?").get(String(familyId), normEmail(email));
    if (!row) return false; db.exec("BEGIN IMMEDIATE");
    try {
      revokeFamily(String(familyId));
      db.prepare("DELETE FROM g2_preparations WHERE family_id=? AND email=?").run(String(familyId), normEmail(email));
      db.exec("COMMIT"); return true;
    }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2ReadConsent(email) {
    return publicG2Consent(db.prepare("SELECT * FROM g2_consent WHERE email=?").get(normEmail(email)));
  }

  function g2Authorize(binding, opts = {}) {
    const email = normEmail(binding.email);
    const consent = g2ReadConsent(email);
    const family = db.prepare("SELECT * FROM g2_device_families WHERE family_id=? AND email=?").get(String(binding.familyId), email);
    return Boolean(subscriptionLive(deps.getAccount(email)) && family && !family.revoked &&
      consent.revision === Number(binding.generation) && consent.g2Disclosure.granted &&
      (!opts.requireMirror || consent.askMirror.granted) &&
      (!opts.requireWrite || (consent.askMirror.granted && consent.askWrite.granted)));
  }

  function g2SynchronizeConsent(email, update) {
    const key = normEmail(email); db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT * FROM g2_consent WHERE email=?").get(key);
      const next = mergeG2Consent(current, update);
      if (next.revision !== publicG2Consent(current).revision) {
        db.prepare(`INSERT INTO g2_consent VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(email) DO UPDATE SET revision=excluded.revision,
          g2_disclosure_granted=excluded.g2_disclosure_granted,
          g2_disclosure_version=excluded.g2_disclosure_version,
          ask_mirror_granted=excluded.ask_mirror_granted,
          ask_mirror_version=excluded.ask_mirror_version,
          ask_write_granted=excluded.ask_write_granted,
          ask_write_version=excluded.ask_write_version`).run(
          key, next.revision, Number(next.g2Disclosure.granted), next.g2Disclosure.version,
          Number(next.askMirror.granted), next.askMirror.version,
          Number(next.askWrite.granted), next.askWrite.version,
        );
        db.prepare("DELETE FROM g2_transcription_tickets WHERE email=? AND generation<?").run(key, next.revision);
      }
      db.exec("COMMIT");
      return next;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2SynchronizeDisclosure(email, update) {
    const key = normEmail(email); db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT * FROM g2_consent WHERE email=?").get(key);
      const next = mergeG2Disclosure(current, update);
      if (next.revision !== publicG2Consent(current).revision) {
        db.prepare(`INSERT INTO g2_consent VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(email) DO UPDATE SET revision=excluded.revision,
          g2_disclosure_granted=excluded.g2_disclosure_granted,
          g2_disclosure_version=excluded.g2_disclosure_version,
          ask_mirror_granted=excluded.ask_mirror_granted,
          ask_mirror_version=excluded.ask_mirror_version,
          ask_write_granted=excluded.ask_write_granted,
          ask_write_version=excluded.ask_write_version`).run(
          key, next.revision, Number(next.g2Disclosure.granted), next.g2Disclosure.version,
          Number(next.askMirror.granted), next.askMirror.version,
          Number(next.askWrite.granted), next.askWrite.version,
        );
        db.prepare("DELETE FROM g2_transcription_tickets WHERE email=? AND generation<?").run(key, next.revision);
      }
      if (!next.g2Disclosure.granted) db.prepare("DELETE FROM g2_preparations WHERE email=?").run(key);
      db.exec("COMMIT"); return next;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
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

  function g2TranscriptionClaim(binding, recordingId, owner, now = Date.now(), leaseMs = 30_000) {
    const idValue = String(recordingId); db.exec("BEGIN IMMEDIATE");
    try {
      const current = transcriptionRow(db.prepare("SELECT * FROM g2_transcriptions WHERE recording_id=?").get(idValue));
      if (current && (current.email !== normEmail(binding.email) || current.familyId !== binding.familyId || current.generation !== binding.generation)) {
        db.exec("ROLLBACK"); return null;
      }
      if (current?.state === "completed" || (current?.state === "transcribing" && current.leaseUntil > now && current.leaseOwner !== owner)) {
        db.exec("ROLLBACK"); return { ...current, acquired: false };
      }
      db.prepare(`INSERT INTO g2_transcriptions
        (recording_id,email,family_id,generation,state,lease_owner,lease_until_ms,transcript_enc)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(recording_id) DO UPDATE SET state='transcribing', lease_owner=excluded.lease_owner,
        lease_until_ms=excluded.lease_until_ms`).run(
        idValue, normEmail(binding.email), binding.familyId, binding.generation,
        "transcribing", owner, now + leaseMs, current?.transcript ? encryptG2Artifact(current.transcript, {
          account: normEmail(binding.email), artifact: "transcript", row: idValue,
        }) : null,
      );
      db.exec("COMMIT");
      return { ...(current ?? { recordingId: idValue, email: normEmail(binding.email), familyId: binding.familyId, generation: binding.generation, transcript: null }), state: "transcribing", leaseOwner: owner, leaseUntil: now + leaseMs, acquired: true };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2TranscriptionComplete(binding, recordingId, owner, transcript) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!g2Authorize(binding)) { db.exec("ROLLBACK"); return false; }
      const changed = db.prepare(`UPDATE g2_transcriptions SET state='completed', lease_owner=NULL,
        lease_until_ms=0, transcript_enc=?, retained_until_ms=? WHERE recording_id=? AND email=? AND family_id=?
        AND generation=? AND lease_owner=? AND state='transcribing'`).run(
        encryptG2Artifact(String(transcript), {
          account: normEmail(binding.email), artifact: "transcript", row: String(recordingId),
        }), Date.now() + config.g2TranscriptRetentionMs, String(recordingId), normEmail(binding.email),
        binding.familyId, binding.generation, owner,
      ).changes > 0;
      db.exec("COMMIT"); return changed;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2TranscriptionFail(binding, recordingId, owner, state) {
    return db.prepare(`UPDATE g2_transcriptions SET state=?, lease_owner=NULL, lease_until_ms=0
      WHERE recording_id=? AND email=? AND family_id=? AND generation=? AND lease_owner=?`).run(
      String(state), String(recordingId), normEmail(binding.email), binding.familyId, binding.generation, owner,
    ).changes > 0;
  }

  function g2TranscriptionGet(binding, recordingId) {
    const row = transcriptionRow(db.prepare(`SELECT * FROM g2_transcriptions WHERE recording_id=?
      AND email=? AND family_id=? AND generation=?`).get(
      String(recordingId), normEmail(binding.email), binding.familyId, binding.generation,
    ));
    return row;
  }

  function g2ConsumeProof(jti, expMs, now = Date.now()) {
    db.prepare("DELETE FROM g2_proof_replay WHERE exp_ms < ?").run(now);
    return db.prepare("INSERT OR IGNORE INTO g2_proof_replay VALUES (?, ?)").run(jti, expMs).changes > 0;
  }

  function g2ConsumeAttempt(key, opts = {}) {
    const now = opts.now ?? Date.now(); const windowMs = opts.windowMs ?? 60_000; const limit = opts.limit ?? 12;
    db.prepare(`INSERT INTO g2_attempt_budgets VALUES (?, ?, 1) ON CONFLICT(attempt_key) DO UPDATE SET
      window_start_ms=CASE WHEN window_start_ms + ? <= ? THEN ? ELSE window_start_ms END,
      attempts=CASE WHEN window_start_ms + ? <= ? THEN 1 ELSE attempts + 1 END`).run(key, now, windowMs, now, now, windowMs, now);
    return db.prepare("SELECT attempts FROM g2_attempt_budgets WHERE attempt_key=?").get(key).attempts <= limit;
  }

  function g2TranscriptionTicketPut(ticketHash, binding, ticket) {
    db.prepare(`INSERT OR REPLACE INTO g2_transcription_tickets
      (ticket_hash,email,family_id,key_thumbprint,origin,generation,recording_id,purpose,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      String(ticketHash), normEmail(binding.email), String(binding.familyId), String(binding.jkt),
      String(binding.origin), Number(binding.generation), String(ticket.recordingId), String(ticket.purpose), Number(ticket.expiresAt),
    );
    return true;
  }

  function g2TranscriptionTicketConsume(ticketHash, binding, now = Date.now()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM g2_transcription_tickets WHERE ticket_hash=?").get(String(ticketHash));
      db.prepare("DELETE FROM g2_transcription_tickets WHERE ticket_hash=?").run(String(ticketHash));
      const valid = row && Number(row.expires_at) >= now && (!binding.email || row.email === normEmail(binding.email)) &&
        (!binding.familyId || row.family_id === String(binding.familyId)) && (!binding.jkt || row.key_thumbprint === String(binding.jkt)) &&
        (!binding.origin || row.origin === String(binding.origin)) &&
        (binding.generation === undefined || Number(row.generation) === Number(binding.generation));
      db.exec("COMMIT");
      return valid ? { recordingId: row.recording_id, purpose: row.purpose, expiresAt: Number(row.expires_at),
        binding: { email: row.email, familyId: row.family_id, jkt: row.key_thumbprint, origin: row.origin, generation: Number(row.generation) } } : null;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2TranscriptionTicketsInvalidate(email, familyId, generation) {
    const result = familyId
      ? db.prepare("DELETE FROM g2_transcription_tickets WHERE email=? AND family_id=? AND generation<?").run(normEmail(email), String(familyId), Number(generation))
      : db.prepare("DELETE FROM g2_transcription_tickets WHERE email=? AND generation<?").run(normEmail(email), Number(generation));
    return result.changes;
  }

  function g2SweepExpired(now = Date.now(), limit = 100) {
    const cap = Math.max(1, Math.min(1000, Number(limit) || 100));
    const remove = (table, column) => db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${column} <= ? LIMIT ?)`);
    const counts = {
      tickets: remove("g2_transcription_tickets", "expires_at").run(now, cap).changes,
      preparations: remove("g2_preparations", "expires_at").run(now, cap).changes,
      transcriptions: db.prepare(`DELETE FROM g2_transcriptions WHERE rowid IN
        (SELECT rowid FROM g2_transcriptions WHERE retained_until_ms IS NOT NULL AND retained_until_ms <= ? LIMIT ?)`)
        .run(now, cap).changes,
      receipts: 0,
    };
    counts.receipts = db.prepare(`DELETE FROM ask_outbox WHERE rowid IN
      (SELECT rowid FROM ask_outbox WHERE status='applied' AND g2_receipt_expires_at IS NOT NULL
       AND g2_receipt_expires_at<=? LIMIT ?)`)
      .run(now, cap).changes;
    return counts;
  }

  function g2TranscriptionSlotAcquire(binding, recordingId, now = Date.now(), leaseMs = 300_000, max = 2) {
    const email = normEmail(binding.email); const idValue = String(recordingId); db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM g2_transcription_slots WHERE expires_at<=?").run(now);
      const existing = db.prepare("SELECT * FROM g2_transcription_slots WHERE recording_id=?").get(idValue);
      if (existing) {
        if (existing.email !== email) { db.exec("ROLLBACK"); return false; }
        db.prepare("UPDATE g2_transcription_slots SET expires_at=? WHERE recording_id=?").run(now + leaseMs, idValue);
        db.exec("COMMIT"); return true;
      }
      const count = db.prepare("SELECT COUNT(*) AS n FROM g2_transcription_slots WHERE email=?").get(email).n;
      if (count >= max) { db.exec("ROLLBACK"); return false; }
      db.prepare("INSERT INTO g2_transcription_slots VALUES (?,?,?,?)").run(idValue, email, String(binding.familyId), now + leaseMs);
      db.exec("COMMIT"); return true;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function g2TranscriptionSlotRelease(binding, recordingId) {
    return db.prepare("DELETE FROM g2_transcription_slots WHERE recording_id=? AND email=?")
      .run(String(recordingId), normEmail(binding.email)).changes > 0;
  }
  function mirrorUpsert(email, atoms) {
    const list = Array.isArray(atoms) ? atoms : [];
    let upserted = 0;
    let skipped = 0;
    /** @type {{ email: string, path: string, title: string, tags: string[], body: string, contentHash: string }[]} */
    const needExpand = [];
    const sel = db.prepare(
      "SELECT content_hash, expand_enc FROM atom_mirror WHERE email = ? AND path = ?",
    );
    const ins = db.prepare(`
      INSERT INTO atom_mirror (email, atom_id, title, path, body_enc, tags_json, links_json, content_hash, updated_at, created, expand_enc, loop_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(email, path) DO UPDATE SET
        atom_id=excluded.atom_id,
        title=excluded.title,
        body_enc=excluded.body_enc,
        tags_json=excluded.tags_json,
        links_json=excluded.links_json,
        content_hash=excluded.content_hash,
        updated_at=excluded.updated_at,
        created=COALESCE(excluded.created, atom_mirror.created),
        expand_enc=NULL,
        loop_json=COALESCE(excluded.loop_json, atom_mirror.loop_json)
    `);
    for (const atom of list) {
      const row = prepareMirrorRow(email, atom);
      const body = String(atom.body ?? atom.text ?? "");
      const tags = Array.isArray(atom.tags) ? atom.tags.map(String) : [];
      const prev = sel.get(row.email, row.path);
      if (prev && prev.content_hash === row.contentHash) {
        skipped += 1;
        if (!prev.expand_enc) {
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
        row.created,
        row.loopJson,
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

  function mirrorSetExpand(email, path, contentHash, expandPlain) {
    const e = normEmail(email);
    const p = String(path || "").trim();
    const hash = String(contentHash || "");
    if (!e || !p || !hash) return { ok: false, updated: 0 };
    const enc = encryptMirrorField(String(expandPlain || ""));
    const info = db
      .prepare(
        `UPDATE atom_mirror SET expand_enc = ?
         WHERE email = ? AND path = ? AND content_hash = ?`,
      )
      .run(enc, e, p, hash);
    return { ok: true, updated: info.changes || 0 };
  }

  function mirrorExpandCoverage(email) {
    const e = normEmail(email);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN expand_enc IS NOT NULL AND expand_enc != '' THEN 1 ELSE 0 END) AS ex
         FROM atom_mirror WHERE email = ?`,
      )
      .get(e);
    const n = Number(row?.n || 0);
    if (!n) return 0;
    return Number(row?.ex || 0) / n;
  }

  function mirrorListMissingExpand(email, limit = 50) {
    const e = normEmail(email);
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = db
      .prepare(
        `SELECT path, title, tags_json, body_enc, content_hash
         FROM atom_mirror
         WHERE email = ? AND (expand_enc IS NULL OR expand_enc = '')
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(e, lim);
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

  function mirrorFetchById(email, atomId) {
    const row = db.prepare("SELECT * FROM atom_mirror WHERE email=? AND atom_id=? LIMIT 1")
      .get(normEmail(email), String(atomId || ""));
    return row ? rowToPublicAtom(row, { includeBody: true }) : null;
  }

  function mirrorSearch(email, query, limit = 8, opts = {}) {
    const e = normEmail(email);
    const rows = db.prepare("SELECT * FROM atom_mirror WHERE email = ?").all(e);
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: true }));
    return rankSearchHits(pubs, query, limit, opts);
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
    db.prepare("DELETE FROM g2_preparations WHERE email = ?").run(e);
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
      receipt: r.receipt_json ? JSON.parse(r.receipt_json) : null,
    });
  }

  /**
   * @param {string} email
   * @param {{ kind: string, payload: object, client_request_id?: string }} opts
   */
  function outboxEnqueue(email, opts) {
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
      const existing = db
        .prepare(
          `SELECT * FROM ask_outbox WHERE email = ? AND client_request_id = ?`,
        )
        .get(e, crid);
      if (existing) {
        if (opts.proposal_fingerprint && decryptOutboxPayload(existing.payload_enc)?.proposal_fingerprint !== opts.proposal_fingerprint) {
          return { ok: false, error: "idempotency_conflict" };
        }
        return { ok: true, ...outboxRowFromDb(existing), duplicate: true };
      }
    }
    if (outboxOpenCount(e) >= OUTBOX_MAX_OPEN) {
      return { ok: false, error: "outbox_full" };
    }
    const idRow = id("obx");
    const now = new Date().toISOString();
    const payload_enc = encryptOutboxPayload(opts.payload);
    const inserted = db.prepare(
      `INSERT OR IGNORE INTO ask_outbox
       (id, email, kind, payload_enc, status, client_request_id, error, created_at, claimed_at, applied_at, receipt_json)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, NULL, NULL, NULL)`,
    ).run(idRow, e, kind, payload_enc, crid || null, now);
    if (inserted.changes === 0 && crid) {
      const existing = db
        .prepare(
          `SELECT * FROM ask_outbox WHERE email = ? AND client_request_id = ?`,
        )
        .get(e, crid);
      if (!existing) return { ok: false, error: "enqueue_conflict" };
      if (
        opts.proposal_fingerprint &&
        decryptOutboxPayload(existing.payload_enc)?.proposal_fingerprint !==
          opts.proposal_fingerprint
      ) {
        return { ok: false, error: "idempotency_conflict" };
      }
      return { ok: true, ...outboxRowFromDb(existing), duplicate: true };
    }
    const row = db.prepare("SELECT * FROM ask_outbox WHERE id = ?").get(idRow);
    return { ok: true, ...outboxRowFromDb(row), duplicate: false };
  }

  function g2OutboxEnqueue(binding, opts) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!g2Authorize(binding, { requireWrite: true })) {
        db.exec("ROLLBACK");
        return { ok: false, error: "setup_required" };
      }
      const result = outboxEnqueue(binding.email, opts);
      db.exec("COMMIT");
      return result;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
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
    let receipt = null;
    if (st === "applied" && row.kind === "create") {
      const payload = decryptOutboxPayload(row.payload_enc);
      if (payload?.origin === "g2") {
        const targetPath = normalizeOutboxReceiptTarget(opts.target_path);
        const mirrorRow = targetPath
          ? db.prepare("SELECT * FROM atom_mirror WHERE email=? AND path=?").get(e, targetPath)
          : null;
        receipt = g2MirrorReceipt(payload, mirrorRow ? rowToPublicAtom(mirrorRow, { includeBody: true }) : null, targetPath);
        if (!receipt) return { ok: false, error: "mirror_receipt_required" };
      }
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE ask_outbox SET status = ?, error = ?, applied_at = ?, receipt_json = ?, g2_receipt_expires_at = ?
       WHERE id = ? AND email = ?`,
    ).run(st, opts.error ? String(opts.error).slice(0, 500) : null, now, receipt ? JSON.stringify(receipt) : null,
      receipt ? Date.now() + G2_RECEIPT_RETENTION_MS : null, oid, e);
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

  function g2PreparationPut(email, row) {
    const e = normEmail(email);
    db.prepare(`INSERT OR REPLACE INTO g2_preparations VALUES (?,?,?,?,?)`).run(
      row.id, e, row.familyId, encryptG2Artifact(JSON.stringify(row.payload), {
        account: e, artifact: "preparation", row: row.id,
      }), row.expiresAt,
    );
    return { ...row, email: e };
  }

  function g2PreparationGet(email, preparationId, familyId) {
    const row = db.prepare(`SELECT * FROM g2_preparations WHERE id=? AND email=? AND family_id=?`).get(
      String(preparationId || ""), normEmail(email), String(familyId || ""),
    );
    return row ? { id: row.id, email: row.email, familyId: row.family_id, expiresAt: row.expires_at,
      payload: JSON.parse(decryptG2ArtifactOrLegacy(row.payload_enc, {
        account: row.email, artifact: "preparation", row: row.id,
      })) } : null;
  }

  function g2PreparationDelete(email, preparationId) {
    return db.prepare(`DELETE FROM g2_preparations WHERE id=? AND email=?`).run(String(preparationId || ""), normEmail(email)).changes > 0;
  }

  function outboxPendingCount(email) {
    const e = normEmail(email);
    outboxReclaimStale(e);
    return outboxOpenCount(e);
  }

  /**
   * Cancel pending or claimed outbox row (not applied/rejected).
   */
  function outboxListOpen(email) {
    const e = normEmail(email);
    outboxReclaimStale(e);
    const rows = db
      .prepare(
        `SELECT * FROM ask_outbox
         WHERE email = ? AND status IN ('pending','claimed')
         ORDER BY created_at ASC`,
      )
      .all(e);
    return rows.map((r) => outboxRowFromDb(r));
  }

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
   * List mirror atoms with sort/filter/pagination (see paginateMirrorList).
   */
  function mirrorList(email, opts = {}) {
    const e = normEmail(email);
    // List columns only — never pull body_enc for pagination scans.
    const rows = db
      .prepare(
        `SELECT email, atom_id, title, path, tags_json, links_json,
                content_hash, updated_at, created, loop_json
         FROM atom_mirror WHERE email = ?`,
      )
      .all(e);
    const pubs = rows.map((r) => rowToPublicAtom(r, { includeBody: false }));
    return paginateMirrorList(pubs, opts);
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
