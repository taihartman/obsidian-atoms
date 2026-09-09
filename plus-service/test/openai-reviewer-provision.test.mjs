/*
 * Matrix coverage:
 * PAIR_PUBLIC_MINT_001
 * REVIEW_PROVISION_001
 * PAIR_REDEEM_001
 * REVIEW_CREDENTIAL_REDEEM_001
 * REVIEW_MIRROR_SEED_001
 * REVIEW_OAUTH_ROTATE_001
 * MCP_TOKEN_TENANT_001
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";
import { withSearchPath } from "./helpers/postgresTestStore.mjs";
import {
  DEFAULT_REVIEW_PAIR_TTL_MS,
  OPENAI_REVIEW_FIXTURES,
  assertReviewerStore,
  normalizeReviewerEmail,
  provisionOpenAiReviewer,
  runProvisionReviewerCli,
} from "../src/reviewer/provision.mjs";
import {
  formatPairCodeDisplay,
  isReviewerIdentity,
  MAX_PAIR_CODE_TTL_MS,
  PAIR_CODE_TTL_MS,
  pkceChallengeS256,
} from "../src/store/askHelpers.mjs";
import { createSqliteStore } from "../src/store/sqlite.mjs";
import { createPostgresStore } from "../src/store/postgres.mjs";
import { hashToken } from "../src/store/shared.mjs";

const execFileAsync = promisify(execFile);
const RESOURCE = "https://plus.tryatoms.app/mcp";

describe("OpenAI reviewer provisioning", () => {
  it("centralizes the reserved reviewer identity boundary", () => {
    assert.equal(isReviewerIdentity("Primary@review.tryatoms.app"), true);
    assert.equal(isReviewerIdentity("person@example.com"), false);
    assert.equal(isReviewerIdentity("@review.tryatoms.app"), false);
    assert.equal(normalizeReviewerEmail(" Primary@review.tryatoms.app "), "primary@review.tryatoms.app");
  });

  for (const mode of askStoreModes()) {
    describe(mode, () => {
      it("keeps public codes at eight characters and exactly the ten-minute policy", async () => {
        await withStore(mode, async (store) => {
          const before = Date.now();
          const normal = await store.pairMint(`default-${mode}@ex.co`);
          assert.match(normal.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
          assert.match(formatPairCodeDisplay(normal.code), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
          const normalTtl = Date.parse(normal.expiresAt) - before;
          assert.ok(normalTtl >= PAIR_CODE_TTL_MS - 100);
          assert.ok(normalTtl <= PAIR_CODE_TTL_MS + 1_000);

          await assert.rejects(
            async () => store.pairMint(`custom-${mode}@ex.co`, { ttlMs: 60_000 }),
            /reviewer credential/i,
          );
        });
      });

      it("preserves one-time public redemption and remint invalidation", async () => {
        await withStore(mode, async (store) => {
          const email = `redeem-${mode}@ex.co`;
          const first = await store.pairMint(email);
          const second = await store.pairMint(email);
          assert.equal(await store.pairRedeem(first.code), null);
          assert.deepEqual(await store.pairRedeem(second.code), { email });
          assert.equal(await store.pairRedeem(second.code), null);
        });
      });

      it("mints only reserved reviewer identities a reusable high-entropy credential", async () => {
        await withStore(mode, async (store) => {
          const email = `reusable-${mode}@review.tryatoms.app`;
          const first = await store.pairMint(email, {
            reviewerCredential: true,
            ttlMs: DEFAULT_REVIEW_PAIR_TTL_MS,
          });
          assert.match(first.code, /^[0-9A-HJKMNP-TV-Z]{26}$/);
          const displayed = formatPairCodeDisplay(first.code);
          assert.match(
            displayed,
            /^(?:[0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/,
          );
          const firstTtl = Date.parse(first.expiresAt) - Date.now();
          assert.ok(firstTtl >= DEFAULT_REVIEW_PAIR_TTL_MS - 1_000);
          assert.ok(firstTtl <= DEFAULT_REVIEW_PAIR_TTL_MS + 1_000);
          assert.deepEqual(await store.pairRedeem(displayed), { email });
          assert.deepEqual(await store.pairRedeem(displayed), { email });

          const second = await store.pairMint(email, {
            reviewerCredential: true,
            ttlMs: MAX_PAIR_CODE_TTL_MS,
          });
          assert.notEqual(second.code, first.code);
          assert.ok(Date.parse(second.expiresAt) - Date.now() >= MAX_PAIR_CODE_TTL_MS - 1_000);
          assert.equal(await store.pairRedeem(first.code), null);
          assert.deepEqual(await store.pairRedeem(second.code), { email });

          await assert.rejects(
            async () => store.pairMint(`not-reviewer-${mode}@example.com`, {
              reviewerCredential: true,
              ttlMs: 60_000,
            }),
            /review\.tryatoms\.app/i,
          );
          for (const ttlMs of [0, -1, Number.NaN, Infinity, "60000", null, MAX_PAIR_CODE_TTL_MS + 1]) {
            await assert.rejects(
              async () => store.pairMint(email, { reviewerCredential: true, ttlMs }),
              /ttlMs/,
            );
          }
        });
      });

      it("rejects an expired reusable reviewer credential", async () => {
        await withStore(mode, async (store) => {
          const minted = await store.pairMint(`expired-${mode}@review.tryatoms.app`, {
            reviewerCredential: true,
            ttlMs: 1,
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
          assert.equal(await store.pairRedeem(minted.code), null);
        });
      });

      it("resets only the reserved synthetic tenant and keeps MCP access tenant-scoped", async () => {
        await withStore(mode, async (store) => {
          const reviewer = `primary-${mode}@review.tryatoms.app`;
          const customer = `customer-${mode}@example.com`;
          await store.grantPeriod(customer, { status: "active", remaining: 12 });
          await store.mirrorUpsert(customer, [
            { path: "Atoms/Private.md", title: "Private", body: "real customer fixture" },
          ]);
          await store.grantPeriod(reviewer, { status: "active", remaining: 12 });
          await store.mirrorUpsert(reviewer, [
            { path: "Atoms/Stale.md", title: "Stale", body: "replace me" },
          ]);
          const browserSession = await store.mcpCreateBrowserSession(reviewer);
          const verifier = `reviewer-reprovision-${mode}`;
          const authCode = await store.mcpCreateAuthCode({
            email: reviewer,
            clientId: "reviewer-reprovision-client",
            redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
            resource: RESOURCE,
            codeChallenge: pkceChallengeS256(verifier),
            codeChallengeMethod: "S256",
            scopes: ["atoms:read", "atoms:write"],
          });

          const result = await provisionOpenAiReviewer({
            store,
            email: reviewer,
            allowNonProductionMemory: mode === "memory",
            allowNonProductionPostgres: mode === "postgres",
            production: false,
          });

          assert.equal(result.email, reviewer);
          assert.equal(result.fixtureCount, OPENAI_REVIEW_FIXTURES.length);
          assert.equal((await store.mirrorStatus(reviewer)).count, 3);
          assert.equal(await store.mirrorFetch(reviewer, "Stale"), null);
          assert.equal((await store.mirrorStatus(customer)).count, 1);
          assert.equal((await store.mirrorFetch(customer, "Private")).text, "real customer fixture");

          assert.deepEqual(await store.mirrorListTags(reviewer), {
            tags: [
              { tag: "writing", count: 2 },
              { tag: "follow-up", count: 1 },
              { tag: "place", count: 1 },
              { tag: "project", count: 1 },
              { tag: "ritual", count: 1 },
            ],
            mirror_count: 3,
            total_distinct: 5,
            truncated: false,
          });
          const search = await store.mirrorSearch(reviewer, "blue notebook", 8);
          assert.equal(search.hits[0]?.title, "Blue notebook ritual");
          assert.equal(
            (await store.mirrorFetch(reviewer, search.hits[0].id)).text,
            "Writing three lines in a blue notebook before breakfast makes it easier to start the first draft.",
          );
          const neighbors = await store.mirrorNeighbors(reviewer, "Call Mira about the field guide");
          assert.deepEqual(
            neighbors.outgoing.map((entry) => entry.title).sort(),
            ["Blue notebook ritual", "Library window idea"],
          );
          assert.equal(neighbors.loop?.state, "active");
          assert.equal(neighbors.loop?.source, "user");
          assert.equal(neighbors.open_now, true);
          const newest = await store.mirrorList(reviewer, {
            sort_by: "created",
            order: "desc",
          });
          assert.deepEqual(
            newest.items.map((entry) => entry.title),
            [
              "Call Mira about the field guide",
              "Library window idea",
              "Blue notebook ritual",
            ],
          );
          assert.deepEqual(
            (await store.mirrorList(reviewer, { open_now: true })).items.map((entry) => entry.title),
            ["Call Mira about the field guide"],
          );
          assert.equal((await store.mirrorSearch(reviewer, "violet submarine checksum", 8)).hits.length, 0);

          assert.match(result.code, /^[0-9A-HJKMNP-TV-Z]{26}$/);
          assert.deepEqual(await store.pairRedeem(result.code), { email: reviewer });
          assert.deepEqual(await store.pairRedeem(result.code), { email: reviewer });
          assert.equal(await store.mcpGetBrowserSession(browserSession), null);
          assert.equal(
            await store.mcpExchangeCode({
              code: authCode,
              clientId: "reviewer-reprovision-client",
              redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
              resource: RESOURCE,
              codeVerifier: verifier,
            }),
            null,
          );

          const reviewerTokens = await store.mintMcpTokensForTest(reviewer, "review", RESOURCE);
          const account = await store.accountFromMcpToken(reviewerTokens.accessToken);
          assert.equal(account?.email, reviewer);
          assert.equal(await store.mirrorFetch(account.email, "Private"), null);
          await store.grantPeriod(reviewer, { status: "inactive", remaining: 0, days: 1 });
          assert.equal(await store.accountFromMcpToken(reviewerTokens.accessToken), null);
        });
      });
    });
  }

  it("refuses non-review identities and unsafe store targets", async () => {
    await withStore("memory", async (store) => {
      await assert.rejects(
        () => provisionOpenAiReviewer({ store, email: "person@example.com", production: false }),
        /review\.tryatoms\.app/,
      );
      await assert.rejects(
        () => provisionOpenAiReviewer({ store, email: "primary@review.tryatoms.app", production: false }),
        /memory/,
      );
      await assert.rejects(
        () => provisionOpenAiReviewer({
          store,
          email: "primary@review.tryatoms.app",
          allowNonProductionMemory: true,
          production: true,
        }),
        /Postgres/,
      );
    });
    await withStore("sqlite", async (store) => {
      await assert.rejects(
        () => provisionOpenAiReviewer({
          store,
          email: "primary@review.tryatoms.app",
          production: true,
        }),
        /Postgres/,
      );
    });
    assert.throws(
      () => assertReviewerStore({ store: { kind: "postgres" }, production: false }),
      /nonproduction Postgres reviewer provisioning/i,
    );
    assert.doesNotThrow(() =>
      assertReviewerStore({
        store: { kind: "postgres" },
        production: false,
        allowNonProductionPostgres: true,
      }),
    );
  });

  it("migrates an existing SQLite pair-code table to persisted reusable credentials", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-reviewer-pair-"));
    const dbPath = path.join(dir, "legacy.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE mcp_pair_codes (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        exp_ms INTEGER NOT NULL,
        consumed_ms INTEGER
      );
    `);
    legacy.close();

    try {
      const store = createSqliteStore(dbPath);
      const email = "migration@review.tryatoms.app";
      const minted = await store.pairMint(email, {
        reviewerCredential: true,
        ttlMs: 60_000,
      });
      assert.deepEqual(await store.pairRedeem(minted.code), { email });
      assert.deepEqual(await store.pairRedeem(minted.code), { email });
      await store.close?.();

      const migrated = new DatabaseSync(dbPath);
      const reusableColumn = migrated
        .prepare("PRAGMA table_info(mcp_pair_codes)")
        .all()
        .find((column) => column.name === "reusable");
      assert.ok(reusableColumn);
      assert.equal(reusableColumn.notnull, 1);
      assert.equal(reusableColumn.dflt_value, "0");
      migrated.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it(
    "migrates an existing Postgres pair-code table without making legacy codes reusable",
    { skip: !process.env.TEST_DATABASE_URL },
    async () => {
      const schema = `t_reviewer_legacy_${randomBytes(6).toString("hex")}`;
      const databaseUrl = process.env.TEST_DATABASE_URL;
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.end();

      const scopedUrl = withSearchPath(databaseUrl, schema);
      const legacyCode = "ABCD1234";
      const legacy = new pg.Client({ connectionString: scopedUrl });
      await legacy.connect();
      await legacy.query(`
        CREATE TABLE mcp_pair_codes (
          email TEXT PRIMARY KEY,
          code_hash TEXT NOT NULL,
          exp_ms BIGINT NOT NULL,
          consumed_ms BIGINT
        )
      `);
      await legacy.query(
        "INSERT INTO mcp_pair_codes (email, code_hash, exp_ms, consumed_ms) VALUES ($1, $2, $3, NULL)",
        ["legacy@example.com", hashToken(legacyCode), Date.now() + 60_000],
      );
      await legacy.end();

      let store;
      try {
        store = await createPostgresStore(scopedUrl);
        assert.deepEqual(await store.pairRedeem(legacyCode), {
          email: "legacy@example.com",
        });
        assert.equal(await store.pairRedeem(legacyCode), null);

        const reviewerEmail = "migration@review.tryatoms.app";
        const reviewer = await store.pairMint(reviewerEmail, {
          reviewerCredential: true,
          ttlMs: 60_000,
        });
        assert.deepEqual(await store.pairRedeem(reviewer.code), {
          email: reviewerEmail,
        });
        assert.deepEqual(await store.pairRedeem(reviewer.code), {
          email: reviewerEmail,
        });
      } finally {
        if (store?.close) await store.close();
        const cleanup = new pg.Client({ connectionString: databaseUrl });
        await cleanup.connect();
        try {
          await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await cleanup.end();
        }
      }
    },
  );

  it("CLI fails closed for nonproduction Postgres without the named override", async () => {
    const previousEnv = process.env.ATOMS_PLUS_ENV;
    const previousEmail = process.env.OPENAI_REVIEWER_EMAIL;
    let closed = false;
    process.env.ATOMS_PLUS_ENV = "development";
    process.env.OPENAI_REVIEWER_EMAIL = "cli-postgres@review.tryatoms.app";
    try {
      await assert.rejects(
        () =>
          runProvisionReviewerCli([], {
            createStoreFn: async () => ({
              kind: "postgres",
              close: async () => {
                closed = true;
              },
            }),
          }),
        /nonproduction Postgres reviewer provisioning/i,
      );
      assert.equal(closed, true);
    } finally {
      if (previousEnv === undefined) delete process.env.ATOMS_PLUS_ENV;
      else process.env.ATOMS_PLUS_ENV = previousEnv;
      if (previousEmail === undefined) delete process.env.OPENAI_REVIEWER_EMAIL;
      else process.env.OPENAI_REVIEWER_EMAIL = previousEmail;
    }
  });

  it("CLI prints the plaintext code once and never echoes environment secrets", async () => {
    const script = fileURLToPath(
      new URL("../scripts/provision-openai-reviewer.mjs", import.meta.url),
    );
    const secret = "operator-secret-sentinel-must-not-print";
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, "--allow-memory-test"], {
      env: {
        ...process.env,
        ATOMS_PLUS_ENV: "development",
        NODE_ENV: "test",
        NODE_NO_WARNINGS: "1",
        ATOMS_PLUS_STORE: "memory",
        ATOMS_ASK_MIRROR_KEY: "b".repeat(64),
        DATABASE_URL: secret,
        OPENAI_REVIEWER_EMAIL: "cli@review.tryatoms.app",
      },
    });
    assert.equal(stderr, "");
    assert.ok(!stdout.includes(secret));
    assert.ok(!stdout.includes("DATABASE_URL"));
    const match = stdout.match(/Pairing code: ((?:[0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2})/);
    assert.ok(match);
    assert.equal(stdout.split(match[1]).length - 1, 1);
    assert.match(stdout, /Synthetic fixtures:/);
    assert.match(stdout, /Expires:/);
    assert.match(stdout, /reusable until it expires/i);
    assert.doesNotMatch(stdout, /one-time/i);
  });

  it("CLI failure output does not echo operator input or environment secrets", async () => {
    const script = fileURLToPath(
      new URL("../scripts/provision-openai-reviewer.mjs", import.meta.url),
    );
    const secret = "operator-secret-sentinel-must-not-print";
    await assert.rejects(
      execFileAsync(process.execPath, [script, "--allow-memory-test"], {
        env: {
          ...process.env,
          ATOMS_PLUS_ENV: "development",
          NODE_ENV: "test",
          ATOMS_PLUS_STORE: "memory",
          ATOMS_ASK_MIRROR_KEY: "c".repeat(64),
          DATABASE_URL: secret,
          OPENAI_REVIEWER_EMAIL: "not-a-reviewer@example.com",
        },
      }),
      (error) => {
        assert.equal(error.stdout, "");
        assert.ok(!error.stderr.includes(secret));
        assert.ok(!error.stderr.includes("not-a-reviewer@example.com"));
        assert.match(error.stderr, /secrets were not printed/);
        return true;
      },
    );
  });
});
