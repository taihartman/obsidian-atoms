/**
 * Store factory — memory (default tests/dogfood) or SQLite (durable).
 *
 * ATOMS_PLUS_STORE=memory|sqlite
 * ATOMS_PLUS_DATABASE_PATH=./data/plus.sqlite (sqlite only; :memory: ok)
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { createMemoryStore } from "./store/memory.mjs";
import { createSqliteStore } from "./store/sqlite.mjs";

export function createStore(opts = {}) {
  const mode = (
    opts.mode ||
    process.env.ATOMS_PLUS_STORE ||
    config.storeMode ||
    "memory"
  ).toLowerCase();

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
