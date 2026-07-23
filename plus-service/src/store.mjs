/**
 * Store factory — memory | sqlite | postgres.
 *
 * ATOMS_PLUS_STORE=memory|sqlite|postgres
 * DATABASE_URL — required for postgres (and production)
 * ATOMS_PLUS_DATABASE_PATH — sqlite path (:memory: ok)
 *
 * createStore is async (postgres migrates on open). memory/sqlite resolve immediately.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { createMemoryStore } from "./store/memory.mjs";
import { createSqliteStore } from "./store/sqlite.mjs";
import { createPostgresStore } from "./store/postgres.mjs";

/**
 * @param {{ mode?: string, path?: string, databaseUrl?: string }} [opts]
 */
export async function createStore(opts = {}) {
  let mode = (
    opts.mode ||
    process.env.ATOMS_PLUS_STORE ||
    config.storeMode ||
    "memory"
  ).toLowerCase();

  const databaseUrl =
    opts.databaseUrl ||
    process.env.DATABASE_URL ||
    config.databaseUrl ||
    "";

  // Production always uses Postgres when DATABASE_URL is present (KTD-B1).
  // Avoid fail-open memory meter if ops set DATABASE_URL but forget ATOMS_PLUS_STORE.
  const prod =
    (process.env.ATOMS_PLUS_ENV || "").toLowerCase() === "production" ||
    (process.env.ATOMS_PLUS_ENV || "").toLowerCase() === "prod" ||
    (process.env.NODE_ENV || "").toLowerCase() === "production";
  if (prod && databaseUrl && (mode === "memory" || mode === "auto" || !mode)) {
    mode = "postgres";
  }

  if (mode === "postgres" || mode === "auto") {
    mode = "postgres";
  }

  if (mode === "postgres") {
    const url = databaseUrl;
    if (!url) {
      throw new Error(
        "ATOMS_PLUS_STORE=postgres requires DATABASE_URL (managed Postgres)",
      );
    }
    return createPostgresStore(url);
  }

  if (mode === "sqlite") {
    const path =
      opts.path ||
      process.env.ATOMS_PLUS_DATABASE_PATH ||
      config.databasePath ||
      join(dirname(fileURLToPath(import.meta.url)), "../data/plus.sqlite");
    return createSqliteStore(path);
  }

  return createMemoryStore();
}

export { createMemoryStore } from "./store/memory.mjs";
export { createSqliteStore } from "./store/sqlite.mjs";
export { createPostgresStore } from "./store/postgres.mjs";
