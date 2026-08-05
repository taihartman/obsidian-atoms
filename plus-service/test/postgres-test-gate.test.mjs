/**
 * #239 U1 — the postgres gate itself.
 *
 * This file is the guard on the guard. The postgres store rows are opt-in on
 * `TEST_DATABASE_URL`, which makes "no coverage" and "coverage passing" look
 * identical from the outside — so the gate's own three states are asserted
 * here, and they run on every local `npm test` with no database present.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  createTestPostgresStore,
  postgresStoreRows,
  withSearchPath,
} from "./helpers/postgresTestStore.mjs";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

const DUMMY_URL = "postgres://u:p@localhost:5432/atoms_test";

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Run `fn` with both gate inputs cleared, then restore them.
 *
 * Clearing CI is not optional even though it looks redundant on a laptop: CI is
 * exactly where it is set, and `postgresStoreRows()` throws when CI is set
 * without a database. A version of this that cleared only TEST_DATABASE_URL
 * passed locally and failed the job.
 */
/** Run `fn` with CI cleared, leaving TEST_DATABASE_URL alone. */
function withoutCi(fn) {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    return fn();
  } finally {
    restoreEnv("CI", ci);
  }
}

function withoutPostgresEnv(fn) {
  const url = process.env.TEST_DATABASE_URL;
  const ci = process.env.CI;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.CI;
  try {
    return fn();
  } finally {
    restoreEnv("TEST_DATABASE_URL", url);
    restoreEnv("CI", ci);
  }
}

describe("postgres store gate (#239 KTD3)", () => {
  // Scoped to this block: only these tests need a stripped environment, and a
  // file-level hook would silently strip it from every other test here too.
  const SAVED = {};

  beforeEach(() => {
    SAVED.url = process.env.TEST_DATABASE_URL;
    SAVED.ci = process.env.CI;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.CI;
  });

  afterEach(() => {
    if (SAVED.url === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = SAVED.url;
    if (SAVED.ci === undefined) delete process.env.CI;
    else process.env.CI = SAVED.ci;
  });

  it("no database and not CI — skips quietly so local runs stay hermetic", () => {
    assert.deepEqual(postgresStoreRows(), []);
  });

  it("CI with no TEST_DATABASE_URL — fails loudly instead of skipping", () => {
    process.env.CI = "true";
    assert.throws(() => postgresStoreRows(), /TEST_DATABASE_URL/);
  });

  it("a database — contributes exactly one row named postgres", () => {
    process.env.TEST_DATABASE_URL = DUMMY_URL;
    const rows = postgresStoreRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], "postgres");
    // Identity, not arity. `typeof fn === "function"` is satisfied by
    // `() => createMemoryStore()` — a memory store labelled postgres, which is
    // the precise fake-green this file exists to catch.
    assert.equal(rows[0][1], createTestPostgresStore);
  });

  it("a database wins over CI — CI does not force the throw when set", () => {
    process.env.CI = "true";
    process.env.TEST_DATABASE_URL = DUMMY_URL;
    assert.equal(postgresStoreRows().length, 1);
  });
});

describe("ask suite mode mapping is total (#239 KTD6)", () => {
  it("refuses an unrecognised mode instead of falling back to memory", async () => {
    // The regression this guards: the old ternary resolved anything that was
    // not the literal "sqlite" to memory, so `withStore("postgres", …)` would
    // have run against memory and reported postgres coverage that never ran.
    await assert.rejects(
      () => withStore("postgres-typo", async () => {}),
      /unrecognised mode/,
    );
  });

  it("routes every offered mode to the backend of that name", async () => {
    // Assert the backend's own discriminator, not a proxy like "does it have a
    // close() method". A fallback-to-memory bug is a mismatched name here; a
    // proxy assertion would miss it whenever the shapes happened to agree. This
    // iterates askStoreModes(), so it covers postgres wherever postgres exists.
    // Read the mode list with CI cleared so this test measures routing, not
    // the CI trapdoor — that has its own test above, and letting it fire here
    // would make this assertion depend on ambient environment.
    const modes = withoutCi(() => askStoreModes());

    const seen = [];
    for (const mode of modes) {
      await withStore(mode, async (store) => {
        seen.push(store.kind);
      });
    }
    assert.deepEqual(seen, modes);
  });

  it("offers memory and sqlite with no database present", () => {
    withoutPostgresEnv(() => {
      assert.deepEqual(askStoreModes(), ["memory", "sqlite"]);
    });
  });

  it("adds postgres when a database is present", () => {
    const saved = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = DUMMY_URL;
    try {
      assert.deepEqual(askStoreModes(), ["memory", "sqlite", "postgres"]);
    } finally {
      restoreEnv("TEST_DATABASE_URL", saved);
    }
  });
});

describe("per-schema connection URL (#239 KTD2)", () => {
  it("carries search_path as an options param the pg parser decodes back", () => {
    const url = withSearchPath("postgres://u:p@localhost:5432/db", "t_9_1");
    // URLSearchParams encodes the space as `+` and `=` as `%3D`; the pg
    // connection-string parser reads it back through searchParams, which
    // decodes both. Assert the decoded form, since that is what reaches the
    // server's startup packet.
    assert.equal(
      new URL(url).searchParams.get("options"),
      "-c search_path=t_9_1",
    );
  });

  it("preserves the database, credentials and port", () => {
    const url = new URL(
      withSearchPath("postgres://u:p@localhost:5432/atoms_test", "t_9_2"),
    );
    assert.equal(url.pathname, "/atoms_test");
    assert.equal(url.username, "u");
    assert.equal(url.port, "5432");
  });

  it("does not accumulate options across calls on the same base URL", () => {
    const base = "postgres://u:p@localhost:5432/db?options=-c%20statement_timeout%3D5s";
    const url = new URL(withSearchPath(base, "t_9_3"));
    assert.deepEqual(url.searchParams.getAll("options"), [
      "-c search_path=t_9_3",
    ]);
  });
});

/**
 * KTD2 asserted against a real server, not against a string.
 *
 * Everything else here checks that `withSearchPath` produces a URL containing
 * the right `options` value — which is `URLSearchParams` round-tripping the
 * string the test just wrote. That proves nothing about whether postgres
 * honours it. If `options` ever stops reaching the startup packet (a pg major
 * bump, a pooler in front of the connection, a provider that strips startup
 * options), every store silently migrates into `public`, all five suites share
 * one table set, and the run stays green while per-test isolation is gone.
 *
 * These fail loudly the day that happens. Present only when a database is.
 */
const HAS_DB = Boolean(process.env.TEST_DATABASE_URL);

describe(
  "per-schema isolation against a live postgres (#239 KTD2)",
  { skip: HAS_DB ? false : "no TEST_DATABASE_URL" },
  () => {
    it("connects on the schema it minted, not public", async () => {
      const store = await createTestPostgresStore();
      const client = new pg.Client({
        connectionString: withSearchPath(
          process.env.TEST_DATABASE_URL,
          store.schemaForTest,
        ),
      });
      await client.connect();
      try {
        const { rows } = await client.query("SELECT current_schema() AS s");
        assert.equal(rows[0].s, store.schemaForTest);

        // The migration's tables live in that schema and NOT in public.
        //
        // Do not assert on `to_regclass('accounts')::text` — it renders the
        // name the way postgres would display it, which omits the schema
        // precisely when the schema is on the search path, so it returns a
        // bare "accounts" both when isolation works and when everything
        // landed in public. Ask the catalog for the namespace instead.
        const owned = await client.query(
          `SELECT n.nspname AS schema
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = 'accounts' AND n.nspname = $1`,
          [store.schemaForTest],
        );
        assert.equal(owned.rows.length, 1, "accounts not in the minted schema");

        const inPublic = await client.query(
          "SELECT to_regclass('public.accounts') AS t",
        );
        assert.equal(
          inPublic.rows[0].t,
          null,
          "migration leaked into public — search_path is not being honoured",
        );
      } finally {
        await client.end();
        await store.close();
      }
    });

    it("two stores cannot see each other's rows", async () => {
      const a = await createTestPostgresStore();
      const b = await createTestPostgresStore();
      try {
        assert.notEqual(a.schemaForTest, b.schemaForTest);
        await a.grantPeriod("isolated@ex.co", {
          remaining: 5,
          status: "active",
          days: 1,
        });
        assert.ok(await a.getAccount("isolated@ex.co"));
        // If search_path were ignored, both stores would be reading the same
        // public.accounts and this would find the row.
        assert.equal(await b.getAccount("isolated@ex.co"), null);
      } finally {
        await a.close();
        await b.close();
      }
    });

    it("drops the schema on close", async () => {
      const store = await createTestPostgresStore();
      const schema = store.schemaForTest;
      await store.close();

      const client = new pg.Client({
        connectionString: process.env.TEST_DATABASE_URL,
      });
      await client.connect();
      try {
        const { rows } = await client.query(
          "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
          [schema],
        );
        assert.equal(rows.length, 0);
      } finally {
        await client.end();
      }
    });
  },
);
