/**
 * #239 U1 — run the parameterised store suites against a real postgres.
 *
 * Postgres is the only store that runs in production and, until this, the only
 * store no test executed. A source-inspection parity test catches a *missing*
 * method; it cannot catch a wrong query parameter, a bad predicate, or a
 * transaction bug. Those need a real database.
 *
 * KTD1 — real `postgres:16`, never a JS reimplementation. The bugs in scope are
 * engine-behaviour bugs; a fake that accepts a query real postgres rejects is a
 * green check that means nothing.
 *
 * KTD2 — isolation is a schema per store instance, carried in the connection
 * URL as `?options=-c search_path=<schema>`. `createPostgresStore` runs
 * `CREATE TABLE IF NOT EXISTS` against whatever it connects to, and the suites
 * call `create()` per test, so a shared database would leak state between
 * tests. Expressing it in the URL means **no production code changes**: tests
 * reach the real factory the same way production does.
 *
 * KTD3 — skipping is silent locally and fatal in CI. See `postgresStoreRows`.
 */
import { after } from "node:test";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createPostgresStore } from "../../src/store/postgres.mjs";

let counter = 0;

/**
 * Per-run entropy in the schema name.
 *
 * The pid alone disambiguates only *within* a run (`node --test` gives each
 * file its own process). Pids recycle, so against a persistent developer
 * database a schema stranded by an earlier crashed run collides with the next
 * run that draws the same pid — and `CREATE SCHEMA` without IF NOT EXISTS then
 * fails before the store exists to clean it up. IF NOT EXISTS would be worse:
 * it would silently reuse another run's tables.
 */
const RUN_ID = randomBytes(4).toString("hex");

/** Schemas created but not yet dropped, for the end-of-file sweep below. */
const liveSchemas = new Set();

function baseUrl() {
  return process.env.TEST_DATABASE_URL || "";
}

/**
 * Build the per-schema connection URL.
 *
 * `URLSearchParams` encodes the space as `+` and the `=` as `%3D`;
 * `pg-connection-string` reads params back through `searchParams.entries()`,
 * which decodes both, and the pure-JS client puts `options` in the startup
 * packet for every pooled connection.
 */
export function withSearchPath(url, schema) {
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  return u.toString();
}

async function onAdminConnection(fn) {
  const client = new pg.Client({ connectionString: baseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * A postgres store isolated in its own schema, dropped on close.
 *
 * The schema name carries the pid because `node --test` runs one process per
 * test file — a module-local counter alone would collide across files.
 */
export async function createTestPostgresStore() {
  const schema = `t_${RUN_ID}_${process.pid}_${++counter}`;
  await onAdminConnection((c) => c.query(`CREATE SCHEMA "${schema}"`));
  liveSchemas.add(schema);

  let store;
  try {
    store = await createPostgresStore(withSearchPath(baseUrl(), schema));
  } catch (err) {
    // A migration or connection failure here would otherwise strand the schema
    // we just created, with no store to close. Swallow any drop failure: the
    // usual reason the drop fails is the same reason the store did, and the
    // cleanup error must never outrank the error it is cleaning up after.
    await dropSchema(schema).catch(() => {});
    throw err;
  }

  return {
    ...store,
    schemaForTest: schema,
    async close() {
      // Pool first: `DROP SCHEMA` cannot run from a connection whose
      // `search_path` is the schema being dropped, and dropping from the
      // store's own pool would race its own teardown.
      await store.close();
      await dropSchema(schema);
    },
  };
}

async function dropSchema(schema) {
  await onAdminConnection((c) =>
    c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`),
  );
  liveSchemas.delete(schema);
}

// Safety net. The store suites close their store on the last line of each test,
// so a failing assertion skips that close and strands the schema. CI's postgres
// container is ephemeral and forgives this; a developer pointing
// TEST_DATABASE_URL at a persistent database does not, and the debris
// accumulates silently. This file-level hook sweeps whatever is left.
after(async () => {
  const stranded = [];
  for (const schema of [...liveSchemas]) {
    // Per-schema guard: one undroppable schema must not abandon the rest, nor
    // turn a run whose tests all passed into a teardown failure.
    try {
      await dropSchema(schema);
    } catch {
      stranded.push(schema);
    }
  }
  if (stranded.length) {
    console.error(`[#239] could not drop test schemas: ${stranded.join(", ")}`);
  }
});

/**
 * KTD3 — the postgres rows are present only when a database is.
 *
 * Locally, no `TEST_DATABASE_URL` means the rows are absent and `npm test`
 * stays hermetic and green with no database installed.
 *
 * In CI that same silence would be a trapdoor: rename or drop the env var and
 * the postgres rows vanish while every check stays green and coverage returns
 * to zero. That is #238's lesson verbatim — a signal nobody receives is not a
 * signal — so under `CI` the absence is a hard failure at load, not a skip.
 *
 * @returns {Array<[string, () => Promise<object>]>} rows for `runStoreSuite`
 */
export function postgresStoreRows() {
  if (baseUrl()) return [["postgres", createTestPostgresStore]];
  if (process.env.CI) {
    throw new Error(
      "CI is set but TEST_DATABASE_URL is not. The postgres store suites would " +
        "skip silently and postgres — the only store that runs in production — " +
        "would go untested behind a green check. Set TEST_DATABASE_URL on the job.",
    );
  }
  return [];
}
