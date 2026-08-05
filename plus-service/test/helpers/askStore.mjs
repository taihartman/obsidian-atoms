/**
 * #239 KTD6 — one `withStore` for the ask suites, with a total mode mapping.
 *
 * This helper was previously copy-pasted byte-identically into
 * `store-ask.test.mjs`, `store-ask-outbox.test.mjs` and
 * `store-ask-mirror-sync.test.mjs`, and every copy resolved the mode with a
 * ternary:
 *
 *     const opts = mode === "sqlite" ? {mode:"sqlite", …} : {mode:"memory"};
 *
 * Any value that was not the literal `"sqlite"` fell through to memory. Adding
 * `"postgres"` to the mode loop — the whole of #239's ask coverage — would have
 * produced a memory store labelled postgres: green, zero postgres SQL executed,
 * coverage reported that did not exist. Exactly the fake-green this issue
 * exists to kill, one layer up.
 *
 * So: a test parameterised by a string needs a **total** mapping. There is no
 * fallback branch here. An unrecognised mode throws, which makes a typo or a
 * future fourth backend a loud failure instead of a silent second run against
 * memory.
 */
import { createStore } from "../../src/store.mjs";
import {
  createTestPostgresStore,
  postgresStoreRows,
} from "./postgresTestStore.mjs";

/**
 * memory + sqlite always; postgres when a database is available.
 * Shares `postgresStoreRows`' gate, so a CI job missing `TEST_DATABASE_URL`
 * fails here too rather than quietly dropping to two modes.
 */
export function askStoreModes() {
  return ["memory", "sqlite", ...postgresStoreRows().map(([name]) => name)];
}

async function openStore(mode) {
  switch (mode) {
    case "memory":
      return createStore({ mode: "memory" });
    case "sqlite":
      return createStore({ mode: "sqlite", path: ":memory:" });
    case "postgres":
      return createTestPostgresStore();
    default:
      throw new Error(
        `withStore: unrecognised mode "${mode}". Refusing to fall back to ` +
          "memory — a mode that silently resolves to another backend reports " +
          "coverage it does not have (#239 KTD6).",
      );
  }
}

export async function withStore(mode, fn) {
  const store = await openStore(mode);
  try {
    await fn(store);
  } finally {
    // Awaited: the postgres store's close() is async (it ends the pool and
    // drops its schema). Un-awaited, the next test's schema mint races an
    // in-flight DROP SCHEMA and the process can exit with pools still open.
    if (store.close) await store.close();
  }
}
