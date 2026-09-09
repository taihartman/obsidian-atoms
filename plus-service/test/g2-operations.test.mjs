import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import { createMemoryStore } from "../src/store/memory.mjs";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createPostgresStore } from "../src/store/postgres.mjs";
import { postgresStoreRows, withSearchPath } from "./helpers/postgresTestStore.mjs";
import pg from "pg";
import {
  decryptG2Artifact,
  decryptG2ArtifactOrLegacy,
  encryptG2Artifact,
} from "../src/g2/crypto.mjs";
import { createG2QueryAdapter } from "../src/g2/query.mjs";
import { createG2TranscriptionService } from "../src/g2/transcription.mjs";
import { encryptMirrorField } from "../src/mirror/crypto.mjs";
import { createG2Metrics, g2ResultStatusClass } from "../src/g2/telemetry.mjs";

const saved = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("G2_") || key.startsWith("ATOMS_") || key.startsWith("STRIPE_") ||
      ["NODE_ENV", "DATABASE_URL", "PUBLIC_BASE_URL", "ANTHROPIC_API_KEY", "RESEND_API_KEY"].includes(key)) {
      delete process.env[key];
    }
  }
}

after(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

beforeEach(resetEnv);

describe("U8 G2 production boundary", () => {
  it("emits only content-free cost and latency metadata", () => {
    const rows = [];
    const metrics = createG2Metrics((row) => rows.push(row));
    for (const operation of ["transcription", "preparation", "query"]) {
      metrics.record({ operation, count: 1, statusClass: operation === "query" ? "failed" : "ok",
        durationMs: 1234, providerLatencyMs: 87, transcript: "secret transcript", question: "secret question",
        title: "secret title", body: "secret body", email: "owner@atoms.test", familyId: "g2d-secret" });
    }
    assert.deepEqual(rows.map((row) => row.operation), ["transcription", "preparation", "query"]);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ["count", "durationMs", "event", "operation", "providerLatencyMs", "statusClass"].sort());
      assert.equal(JSON.stringify(row).includes("secret"), false);
      assert.equal(row.durationMs, 1234);
      assert.equal(row.providerLatencyMs, 87);
    }
    assert.equal(g2ResultStatusClass("query", { state: "answered", answer: "private" }), "ok");
  });

  it("never falls back to the Ask provider credential for a G2 query", async () => {
    process.env.ANTHROPIC_API_KEY = "ask-only-secret";
    delete process.env.G2_ANTHROPIC_API_KEY;
    let requests = 0;
    const adapter = createG2QueryAdapter({ fetchImpl: async () => { requests += 1; throw new Error("must not run"); } });
    assert.deepEqual(await adapter({ question: "private", chunks: [] }), { ok: false, reason: "unavailable" });
    assert.equal(requests, 0);
  });

  it("keeps existing Ask production readiness independent while G2 is disabled", async () => {
    Object.assign(process.env, {
      ATOMS_PLUS_ENV: "production",
      DOGFOOD_AUTO_GRANT: "0",
      STRIPE_DOGFOOD_CHECKOUT: "0",
      STRIPE_SECRET_KEY: "stripe-placeholder",
      STRIPE_WEBHOOK_SECRET: "webhook-placeholder",
      STRIPE_PRICE_MONTHLY: "price-monthly",
      STRIPE_PRICE_YEARLY: "price-yearly",
      STRIPE_PRICE_TOPUP: "price-topup",
      ANTHROPIC_API_KEY: "ask-provider-placeholder",
      PUBLIC_BASE_URL: "https://plus.tryatoms.app",
      DATABASE_URL: "postgres://example.invalid/atoms",
      ATOMS_PLUS_STORE: "postgres",
      RESEND_API_KEY: "resend-placeholder",
      ATOMS_PLUS_ALERT_EMAIL: "ops@tryatoms.app",
      ATOMS_ASK_MIRROR_KEY: "a".repeat(64),
      G2_ENABLED: "0",
    });
    const { checkProductionReady } = await import(`../src/prodGate.mjs?u8-off=${Math.random()}`);
    assert.deepEqual(checkProductionReady(), { ok: true, errors: [] });
  });

  it("requires the complete G2 production contract only when enabled", async () => {
    Object.assign(process.env, {
      ATOMS_PLUS_ENV: "production",
      DOGFOOD_AUTO_GRANT: "0",
      STRIPE_DOGFOOD_CHECKOUT: "0",
      STRIPE_SECRET_KEY: "stripe-placeholder",
      STRIPE_WEBHOOK_SECRET: "webhook-placeholder",
      STRIPE_PRICE_MONTHLY: "price-monthly",
      STRIPE_PRICE_YEARLY: "price-yearly",
      STRIPE_PRICE_TOPUP: "price-topup",
      ANTHROPIC_API_KEY: "ask-provider-placeholder",
      PUBLIC_BASE_URL: "https://plus.tryatoms.app",
      DATABASE_URL: "postgres://example.invalid/atoms",
      ATOMS_PLUS_STORE: "postgres",
      RESEND_API_KEY: "resend-placeholder",
      ATOMS_PLUS_ALERT_EMAIL: "ops@tryatoms.app",
      ATOMS_ASK_MIRROR_KEY: "a".repeat(64),
      G2_ENABLED: "1",
    });
    const { checkProductionReady } = await import(`../src/prodGate.mjs?u8-on=${Math.random()}`);
    const result = checkProductionReady();
    assert.equal(result.ok, false);
    for (const name of [
      "G2_APP_ORIGIN", "G2_OPENAI_API_KEY", "G2_ANTHROPIC_API_KEY",
      "G2_PROVIDER_CONTROLS_ACCEPTED", "G2_RETENTION_DISCLOSURE_VERSION", "G2_DATA_KEY_CURRENT",
    ]) assert.ok(result.errors.some((error) => error.includes(name)), name);
  });

  it("accepts one exact HTTPS Origin or the explicit iPhone loopback sentinel and rejects every other wildcard or URL shape", async () => {
    Object.assign(process.env, {
      ATOMS_PLUS_ENV: "production", DOGFOOD_AUTO_GRANT: "0", STRIPE_DOGFOOD_CHECKOUT: "0",
      STRIPE_SECRET_KEY: "stripe", STRIPE_WEBHOOK_SECRET: "webhook", STRIPE_PRICE_MONTHLY: "monthly",
      STRIPE_PRICE_YEARLY: "yearly", STRIPE_PRICE_TOPUP: "topup", ANTHROPIC_API_KEY: "ask",
      PUBLIC_BASE_URL: "https://plus.tryatoms.app", DATABASE_URL: "postgres://example.invalid/atoms",
      ATOMS_PLUS_STORE: "postgres", RESEND_API_KEY: "resend", ATOMS_PLUS_ALERT_EMAIL: "ops@example.test",
      ATOMS_ASK_MIRROR_KEY: "a".repeat(64), G2_ENABLED: "1", G2_OPENAI_API_KEY: "g2-openai",
      G2_ANTHROPIC_API_KEY: "g2-anthropic", G2_PROVIDER_CONTROLS_ACCEPTED: "2026-09-09",
      G2_RETENTION_DISCLOSURE_VERSION: "g2-retention-v1", G2_DATA_KEY_CURRENT: "b".repeat(64),
      G2_DATA_KEY_CURRENT_VERSION: "k1",
    });
    const { checkProductionReady } = await import(`../src/prodGate.mjs?u8-origin=${Math.random()}`);
    for (const invalid of [
      "*", "http://g2.example", "https://*.example", "https://one.example,https://two.example",
      "https://user@g2.example", "https://g2.example/", "https://g2.example/path", "https://g2.example?q=1", "https://g2.example#fragment",
    ]) {
      process.env.G2_APP_ORIGIN = invalid;
      assert.ok(checkProductionReady().errors.some((error) => error.includes("G2_APP_ORIGIN")), invalid);
    }
    process.env.G2_APP_ORIGIN = "https://webview-origin.example:8443";
    assert.deepEqual(checkProductionReady(), { ok: true, errors: [] });
    process.env.G2_APP_ORIGIN = "http://127.0.0.1:*";
    assert.deepEqual(checkProductionReady(), { ok: true, errors: [] });
    for (const invalid of [
      "http://127.0.0.1:59134", "http://localhost:*", "http://[::1]:*", "https://127.0.0.1:*",
      "http://127.0.0.1:*/*", "http://127.0.0.1:*?query=1", "http://127.0.0.1:*#fragment",
      "http://user@127.0.0.1:*", "http://127.0.0.1:**", "prefixhttp://127.0.0.1:*",
    ]) {
      process.env.G2_APP_ORIGIN = invalid;
      assert.ok(checkProductionReady().errors.some((error) => error.includes("G2_APP_ORIGIN")), invalid);
    }
  });
});

describe("U8 versioned G2 artifact encryption", () => {
  const current = "1".repeat(64);
  const previous = "2".repeat(64);
  const aad = { account: "owner@atoms.test", artifact: "transcript", row: "rec-1" };

  it("binds ciphertext to account, artifact, and row and rejects tampering", () => {
    const stored = encryptG2Artifact("verbatim\n", aad, { currentKey: current, currentVersion: "k2" });
    assert.match(stored, /^g2e:k2:/);
    assert.equal(decryptG2Artifact(stored, aad, { currentKey: current, currentVersion: "k2" }), "verbatim\n");
    assert.throws(() => decryptG2Artifact(stored, { ...aad, account: "other@atoms.test" }, { currentKey: current, currentVersion: "k2" }));
    const tail = stored.at(-1) === "A" ? "B" : "A";
    assert.throws(() => decryptG2Artifact(stored.slice(0, -1) + tail, aad, { currentKey: current, currentVersion: "k2" }));
  });

  it("reads the previous key during rotation but writes only the current version", () => {
    const old = encryptG2Artifact("old", aad, { currentKey: previous, currentVersion: "k1" });
    assert.equal(decryptG2Artifact(old, aad, {
      currentKey: current, currentVersion: "k2", previousKey: previous, previousVersion: "k1",
    }), "old");
    assert.match(encryptG2Artifact("new", aad, {
      currentKey: current, currentVersion: "k2", previousKey: previous, previousVersion: "k1",
    }), /^g2e:k2:/);
  });

  it("reads an upgraded encrypted legacy row during a mixed-version deployment", () => {
    process.env.ATOMS_ASK_MIRROR_KEY = "3".repeat(64);
    const legacy = encryptMirrorField("legacy encrypted");
    assert.equal(decryptG2ArtifactOrLegacy(legacy, aad, {
      currentKey: current, currentVersion: "k2",
    }), "legacy encrypted");
  });

  it("forbids plaintext fallback and plaintext reads in production", () => {
    process.env.ATOMS_PLUS_ENV = "production";
    assert.throws(() => encryptG2Artifact("private", aad, { currentKey: "", currentVersion: "k2" }), /G2_DATA_KEY_CURRENT/);
    assert.throws(() => decryptG2Artifact("g2p:private", aad, { currentKey: current, currentVersion: "k2" }), /plaintext_forbidden/);
  });
});

for (const [mode, create] of postgresStoreRows()) {
  describe(`U8 supported-store boundary (${mode})`, () => {
    it("shares atomic tickets and workload slots across service instances", async () => {
      const first = await create();
      const second = await createPostgresStore(withSearchPath(process.env.TEST_DATABASE_URL, first.schemaForTest));
      const binding = { email: "pg-ticket@atoms.test", familyId: "g2d-pg", jkt: "jkt-pg", origin: "https://g2.example", generation: 4 };
      try {
        await first.g2TranscriptionTicketPut("pg-hash", binding, { recordingId: "pg-rec", purpose: "stream", expiresAt: 2_000 });
        assert.equal((await second.g2TranscriptionTicketConsume("pg-hash", binding, 1_000)).recordingId, "pg-rec");
        assert.equal(await first.g2TranscriptionTicketConsume("pg-hash", binding, 1_000), null);
        assert.equal(await first.g2TranscriptionSlotAcquire(binding, "pg-a", 1_000, 30_000, 1), true);
        assert.equal(await second.g2TranscriptionSlotAcquire(binding, "pg-b", 1_000, 30_000, 1), false);
        assert.equal(await second.g2TranscriptionSlotRelease(binding, "pg-a"), true);
        assert.equal(await first.g2TranscriptionSlotAcquire(binding, "pg-b", 1_000, 30_000, 1), true);
      } finally { await second.close(); await first.close(); }
    });

    it("encrypts transcript and preparation rows and rejects ciphertext tampering", async () => {
      process.env.G2_DATA_KEY_CURRENT = "4".repeat(64);
      process.env.G2_DATA_KEY_CURRENT_VERSION = "pg-k1";
      const store = await create();
      const binding = { email: "pg-crypto@atoms.test", familyId: "g2d-pg", generation: 1 };
      const client = new pg.Client({ connectionString: withSearchPath(process.env.TEST_DATABASE_URL, store.schemaForTest) });
      try {
        await store.ensureAccount(binding.email);
        await store.grantPeriod(binding.email, { remaining: 50, status: "active", plan: "monthly" });
        const pair = await store.g2PairMint(binding.email, { scopes: ["g2:transcribe"] });
        const redeemed = await store.g2PairRedeem(pair.code, { jkt: "pg-crypto-jkt", name: "Crypto G2" });
        const consent = await store.g2SynchronizeDisclosure(binding.email, {
          baseRevision: 0,
          disclosure: { granted: true, version: "g2-audio-v1" },
          freshGesture: true,
        });
        const authorized = { ...binding, familyId: redeemed.device.id, generation: consent.revision };
        assert.equal((await store.g2TranscriptionClaim(authorized, "pg-tx", "worker", 1_000, 30_000)).acquired, true);
        assert.equal(await store.g2TranscriptionComplete(authorized, "pg-tx", "worker", "private transcript"), true);
        await store.g2PreparationPut(authorized.email, { id: "pg-prep", familyId: authorized.familyId, expiresAt: Date.now() + 10_000, payload: { title: "private title" } });
        assert.equal((await store.g2TranscriptionGet(authorized, "pg-tx")).transcript, "private transcript");
        assert.equal((await store.g2PreparationGet(authorized.email, "pg-prep", authorized.familyId)).payload.title, "private title");
        await client.connect();
        const raw = await client.query("SELECT transcript_enc FROM g2_transcriptions WHERE recording_id='pg-tx'");
        assert.match(raw.rows[0].transcript_enc, /^g2e:pg-k1:/);
        assert.equal(raw.rows[0].transcript_enc.includes("private transcript"), false);
        await client.query("UPDATE g2_transcriptions SET transcript_enc=left(transcript_enc,-1)||CASE right(transcript_enc,1) WHEN 'A' THEN 'B' ELSE 'A' END WHERE recording_id='pg-tx'");
        await assert.rejects(() => store.g2TranscriptionGet(authorized, "pg-tx"));
      } finally { await client.end().catch(() => {}); await store.close(); }
    });

    it("sweeps only old G2 receipts even when normal receipts precede the bounded candidate", async () => {
      const store = await create();
      const email = "pg-receipts@atoms.test"; const body = "receipt body\n";
      try {
        await store.mirrorUpsert(email, [{ path: "Memory Shelf/G2.md", title: "G2", body }]);
        const normal = await store.outboxEnqueue(email, { kind: "create", payload: { title: "Normal", body: "normal" } });
        const g2 = await store.outboxEnqueue(email, { kind: "create", payload: { title: "G2", body, origin: "g2", captured_record_sha256: createHash("sha256").update(body).digest("hex") } });
        await store.outboxPull(email, { limit: 10 });
        await store.outboxAck(email, { id: normal.id, status: "applied" });
        await store.outboxAck(email, { id: g2.id, status: "applied", target_path: "Memory Shelf/G2.md" });
        const client = new pg.Client({ connectionString: withSearchPath(process.env.TEST_DATABASE_URL, store.schemaForTest) });
        await client.connect();
        await client.query("UPDATE ask_outbox SET receipt_json='{}'::jsonb, applied_at=to_timestamp(0) WHERE id=$1", [normal.id]);
        await client.end();
        assert.equal((await store.g2SweepExpired(Date.now() + 8 * 24 * 60 * 60 * 1000, 1)).receipts, 1);
        assert.ok(await store.outboxGet(email, normal.id));
        assert.equal(await store.outboxGet(email, g2.id), null);
      } finally { await store.close(); }
    });
  });
}

describe("U8 additive SQLite migration and rollback", () => {
  it("opens a pre-U8 G2 schema, adds new tables, and preserves Ask with G2 disabled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "atoms-g2-u8-"));
    const file = join(directory, "plus.sqlite");
    try {
      const legacy = new DatabaseSync(file);
      legacy.exec(`CREATE TABLE g2_transcriptions (
        recording_id TEXT PRIMARY KEY, email TEXT NOT NULL, family_id TEXT NOT NULL,
        generation INTEGER NOT NULL, state TEXT NOT NULL, lease_owner TEXT,
        lease_until_ms INTEGER NOT NULL, transcript_enc TEXT
      );`);
      legacy.close();
      const upgraded = createSqliteStore(file);
      upgraded.ensureAccount("rollback@atoms.test");
      await upgraded.grantPeriod("rollback@atoms.test", { status: "active" });
      await upgraded.g2TranscriptionTicketPut("rollback-ticket", {
        email: "rollback@atoms.test", familyId: "g2d-r", jkt: "jkt", origin: "https://plus.tryatoms.app", generation: 1,
      }, { recordingId: "rec-r", purpose: "stream", expiresAt: Date.now() + 10_000 });
      await upgraded.close?.();
      process.env.G2_ENABLED = "0";
      const rolledBack = createSqliteStore(file);
      assert.equal(rolledBack.getAccount("rollback@atoms.test").status, "active");
      assert.equal((await rolledBack.g2TranscriptionTicketConsume("rollback-ticket", {
        email: "rollback@atoms.test", familyId: "g2d-r", jkt: "jkt", origin: "https://plus.tryatoms.app", generation: 1,
      })).recordingId, "rec-r");
      await rolledBack.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a durable G2 receipt expiry index so legacy normal receipts cannot starve a bounded sweep", async () => {
    const directory = mkdtempSync(join(tmpdir(), "atoms-g2-receipts-"));
    const file = join(directory, "plus.sqlite");
    const store = createSqliteStore(file);
    const email = "sqlite-starvation@atoms.test"; const body = "indexed receipt\n";
    try {
      await store.mirrorUpsert(email, [{ path: "Memory Shelf/Indexed.md", title: "Indexed", body }]);
      const normals = [];
      for (let index = 0; index < 5; index += 1) {
        normals.push(await store.outboxEnqueue(email, { kind: "create", payload: { title: `Normal ${index}`, body: "ordinary" } }));
      }
      const g2 = await store.outboxEnqueue(email, { kind: "create", payload: {
        title: "Indexed", body, origin: "g2", captured_record_sha256: createHash("sha256").update(body).digest("hex"),
      } });
      await store.outboxPull(email, { limit: 10 });
      for (const normal of normals) await store.outboxAck(email, { id: normal.id, status: "applied" });
      await store.outboxAck(email, { id: g2.id, status: "applied", target_path: "Memory Shelf/Indexed.md" });
      const raw = new DatabaseSync(file);
      raw.prepare("UPDATE ask_outbox SET receipt_json='{}', applied_at=? WHERE id<>?")
        .run(new Date(0).toISOString(), g2.id);
      raw.close();
      assert.equal((await store.g2SweepExpired(Date.now() + 8 * 24 * 60 * 60 * 1000, 1)).receipts, 1);
      assert.equal(await store.outboxGet(email, g2.id), null);
      for (const normal of normals) assert.ok(await store.outboxGet(email, normal.id));
    } finally { await store.close?.(); rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("U8 durable single-use transcription tickets", () => {
  for (const [mode, create] of [["memory", createMemoryStore], ["sqlite", () => createSqliteStore(":memory:")]]) {
    it(`${mode}: hashes, binds, atomically consumes, invalidates, and sweeps tickets`, async () => {
      const store = create();
      try {
        const binding = { email: "owner@atoms.test", familyId: "g2d-1", jkt: "jkt-1", origin: "https://plus.tryatoms.app", generation: 3 };
        await store.g2TranscriptionTicketPut("hash-a", binding, { recordingId: "rec-1", purpose: "stream", expiresAt: 2_000 });
        assert.equal((await store.g2TranscriptionTicketConsume("hash-a", binding, 1_000)).recordingId, "rec-1");
        assert.equal(await store.g2TranscriptionTicketConsume("hash-a", binding, 1_000), null);

        await store.g2TranscriptionTicketPut("hash-b", binding, { recordingId: "rec-2", purpose: "stream", expiresAt: 2_000 });
        await store.g2TranscriptionTicketsInvalidate(binding.email, binding.familyId, 4);
        assert.equal(await store.g2TranscriptionTicketConsume("hash-b", binding, 1_000), null);

        await store.g2TranscriptionTicketPut("hash-c", { ...binding, generation: 4 }, { recordingId: "rec-3", purpose: "stream", expiresAt: 900 });
        const swept = await store.g2SweepExpired(1_000, 10);
        assert.ok(swept.tickets >= 1);
      } finally {
        await store.close?.();
      }
    });

    it(`${mode}: sweeps only seven-day-old applied G2 receipts`, async () => {
      const store = create();
      try {
        const email = `receipt-${mode}@atoms.test`; const body = "verbatim receipt\n";
        const hash = createHash("sha256").update(body).digest("hex");
        await store.mirrorUpsert(email, [{ path: "Memory Shelf/Receipt.md", title: "Receipt", body }]);
        const g2 = await store.outboxEnqueue(email, { kind: "create", payload: {
          title: "Receipt", body, origin: "g2", captured_record_sha256: hash,
        } });
        const normal = await store.outboxEnqueue(email, { kind: "create", payload: { title: "Normal", body: "ordinary" } });
        await store.outboxPull(email, { limit: 10 });
        assert.equal((await store.outboxAck(email, { id: g2.id, status: "applied", target_path: "Memory Shelf/Receipt.md" })).ok, true);
        assert.equal((await store.outboxAck(email, { id: normal.id, status: "applied" })).ok, true);
        const result = await store.g2SweepExpired(Date.now() + 8 * 24 * 60 * 60 * 1000, 1);
        assert.equal(result.receipts, 1);
        assert.equal(await store.outboxGet(email, g2.id), null);
        assert.ok(await store.outboxGet(email, normal.id));
      } finally { await store.close?.(); }
    });
  }

  it("mints on one service, opens on another, and shares the account workload ceiling", async () => {
    const store = createMemoryStore();
    const calls = [];
    const provider = { transcribe: async (input) => { calls.push(input); return { transcript: "unused" }; } };
    const repository = {
      ticketPut: (...args) => store.g2TranscriptionTicketPut(...args),
      ticketConsume: (...args) => store.g2TranscriptionTicketConsume(...args),
      acquireSlot: (...args) => store.g2TranscriptionSlotAcquire(...args),
      releaseSlot: (...args) => store.g2TranscriptionSlotRelease(...args),
    };
    const first = createG2TranscriptionService({ provider, repository, maxConcurrentPerAccount: 1 });
    const second = createG2TranscriptionService({ provider, repository, maxConcurrentPerAccount: 1 });
    const binding = { email: "multi@atoms.test", familyId: "g2d-multi", jkt: "jkt", origin: "https://plus.tryatoms.app", generation: 2 };
    const ticketA = await first.mintTicket(binding, { recordingId: "rec-a", purpose: "stream" });
    assert.equal((await second.openWebSocket(ticketA.value, binding.origin)).state, "open");
    const ticketB = await first.mintTicket(binding, { recordingId: "rec-b", purpose: "stream" });
    assert.equal((await first.openWebSocket(ticketB.value, binding.origin)).error, "concurrency_limit");
    assert.equal(calls.length, 0, "ticket open and rejected pre-auth audio never contact the provider");
  });
});
