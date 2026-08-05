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
import {
  postgresStoreRows,
  withSearchPath,
} from "./helpers/postgresTestStore.mjs";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

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
    process.env.TEST_DATABASE_URL = "postgres://u:p@localhost:5432/atoms_test";
    const rows = postgresStoreRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], "postgres");
    assert.equal(typeof rows[0][1], "function");
  });

  it("a database wins over CI — CI does not force the throw when set", () => {
    process.env.CI = "true";
    process.env.TEST_DATABASE_URL = "postgres://u:p@localhost:5432/atoms_test";
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

  it("routes each known mode to a distinct backend", async () => {
    const seen = [];
    for (const mode of ["memory", "sqlite"]) {
      await withStore(mode, async (store) => {
        seen.push(typeof store.close);
      });
    }
    // sqlite exposes close(), memory does not — proof they are not the same
    // object graph, which a fallback-to-memory bug would make identical.
    assert.deepEqual(seen, ["undefined", "function"]);
  });

  it("offers memory and sqlite with no database present", () => {
    const saved = process.env.TEST_DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    try {
      assert.deepEqual(askStoreModes(), ["memory", "sqlite"]);
    } finally {
      if (saved !== undefined) process.env.TEST_DATABASE_URL = saved;
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
