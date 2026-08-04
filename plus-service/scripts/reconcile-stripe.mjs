#!/usr/bin/env node
/**
 * #238 U4 — reconcile Stripe checkouts against processed events (class C:
 * the webhook never arrived). Report-only unless --repair; run weekly (KTD4).
 *
 *   node scripts/reconcile-stripe.mjs                 # last 7 days, report only
 *   node scripts/reconcile-stripe.mjs --since=30      # widest window Stripe keeps
 *   node scripts/reconcile-stripe.mjs --repair        # grant what was lost
 *   node scripts/reconcile-stripe.mjs --repair --force # ignore the age refusal
 *   node scripts/reconcile-stripe.mjs --json          # machine-readable report
 *
 * Argv parsing only — the sweep lives in src/reconcile.mjs so `node --test`
 * can reach it. Needs STRIPE_SECRET_KEY plus the usual store env.
 *
 * The store assertion below is load-bearing: `createStore` only forces Postgres
 * when ATOMS_PLUS_ENV *and* DATABASE_URL are both set, so an operator shell with
 * only DATABASE_URL exported silently gets an empty in-memory store — where
 * `hasProcessedEvent` is false for everyone, 100% of the window flags, and
 * `--repair` "repairs" every real customer into a throwaway map while printing
 * success. Refuse it unless the caller asked for memory on purpose.
 */

import "../src/loadEnv.mjs";
import { createStore } from "../src/store.mjs";
import {
  reconcileStripe,
  DAY_MS,
  MAX_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
} from "../src/reconcile.mjs";

function parseArgs(argv) {
  const out = {
    days: DEFAULT_WINDOW_DAYS,
    repair: false,
    force: false,
    json: false,
    allowMemoryStore: false,
  };
  for (const arg of argv) {
    const [flag, inline] = arg.split("=");
    switch (flag) {
      case "--since":
        out.days = Number(inline);
        break;
      case "--repair":
        out.repair = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--allow-memory-store":
        out.allowMemoryStore = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }
  if (!Number.isFinite(out.days) || out.days <= 0 || out.days > MAX_WINDOW_DAYS) {
    console.error(
      `--since must be 1..${MAX_WINDOW_DAYS} days (Stripe's events API retains ${MAX_WINDOW_DAYS}).`,
    );
    process.exit(1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY.");
  process.exit(1);
}

const store = await createStore();
const storeKind = String(store?.kind || "unknown");
if (storeKind !== "postgres" && storeKind !== "sqlite" && !args.allowMemoryStore) {
  console.error(
    `Refusing to sweep against a "${storeKind}" store — it has no record of any processed event,\n` +
      `so every checkout in the window would be flagged (and --repair would grant into a store that\n` +
      `disappears when this process exits). Set ATOMS_PLUS_STORE=postgres with DATABASE_URL, or pass\n` +
      `--allow-memory-store if you really meant to sweep an empty dev store.`,
  );
  process.exit(1);
}

const now = Date.now();
const report = await reconcileStripe({
  store,
  since: now - args.days * DAY_MS,
  repair: args.repair,
  force: args.force,
  now,
});

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`store: ${report.storeKind}`);
  console.log(
    `window: ${new Date(report.since).toISOString()} → now (${args.days}d, ${report.pages} page(s))`,
  );
  console.log(
    `scanned ${report.scanned} · processed ${report.processed} · unpaid skipped ${report.skippedUnpaid} · FLAGGED ${report.flagged.length}`,
  );
  if (report.truncated) {
    console.log(
      `!! TRUNCATED — hit the ${report.pages}-page cap with more events left at Stripe.` +
        ` This is NOT the whole window; narrow --since and re-run.`,
    );
  }
  for (const f of report.flagged) {
    console.log(
      `  ! ${f.eventId} ${f.sessionId} ${f.email || "(no email)"} ${f.ageDays ?? "?"}d old`,
    );
  }
  for (const r of report.refused) {
    console.log(`  - refused ${r.eventId} (${r.email || "no email"}): ${r.reason}`);
  }
  for (const s of report.skipped) {
    console.log(`  = skipped ${s.eventId} (${s.email || "no email"}): ${s.reason}`);
  }
  for (const r of report.repaired) {
    console.log(`  + repaired ${r.eventId} → ${r.action} for ${r.email}`);
    // KTD6 — the checkout binding expired long before this ran.
    console.log(`    ${r.email} must sign in again with a magic link (${r.note}).`);
  }
  for (const f of report.failed) {
    console.log(
      `  x REPAIR GRANTED NOTHING ${f.eventId} → ${f.action} for ${f.email || "(no email)"}`,
    );
    console.log(`    ${f.reason} — investigate this one by hand.`);
  }
  if (!args.repair && report.flagged.length) {
    console.log("Report only. Re-run with --repair to grant these.");
  }
}

process.exit(0);
