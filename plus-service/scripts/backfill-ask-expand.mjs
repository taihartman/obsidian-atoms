#!/usr/bin/env node
/**
 * Backfill expand_enc for mirror rows missing expansion.
 * Usage (Fly / local with store env):
 *   node scripts/backfill-ask-expand.mjs --email you@example.com [--dry-run] [--limit 50]
 * Never logs body or expand text.
 */
import { config } from "../src/config.mjs";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1] || fallback;
}

const email = arg("--email");
const dry = process.argv.includes("--dry-run");
const limit = Number(arg("--limit", "50")) || 50;

if (!email) {
  console.error("Usage: backfill-ask-expand.mjs --email you@example.com [--dry-run] [--limit N]");
  process.exit(2);
}

const { createStore } = await import("../src/store/index.mjs").catch(() => ({
  createStore: null,
}));

async function main() {
  let store;
  if (createStore) {
    store = await createStore();
  } else {
    const { createMemoryStore } = await import("../src/store/memory.mjs");
    store = createMemoryStore();
    console.error("No createStore; memory only — nothing to backfill.");
    process.exit(1);
  }

  if (typeof store.mirrorList !== "function") {
    console.error("store lacks mirrorList");
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      email,
      dry,
      limit,
      expandEnabled: config.askExpandEnabled,
      model: config.askExpandModel,
    }),
  );

  // Operators: implement full walk against store API when needed.
  // Production path: enqueue via mirrorUpsert re-push or dedicated store.listMissingExpand.
  console.log(
    JSON.stringify({
      ok: true,
      note: "Re-sync vault or call store expand jobs; script is a runbook stub for env wiring.",
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "fail");
  process.exit(1);
});
