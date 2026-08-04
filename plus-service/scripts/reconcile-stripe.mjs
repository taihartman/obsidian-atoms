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
 */

import "../src/loadEnv.mjs";
import { createStore } from "../src/store.mjs";
import {
  reconcileStripe,
  MAX_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
} from "../src/reconcile.mjs";

const DAY_MS = 86400000;

function parseArgs(argv) {
  const out = { days: DEFAULT_WINDOW_DAYS, repair: false, force: false, json: false };
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
  console.log(
    `window: ${new Date(report.since).toISOString()} → now (${args.days}d, ${report.pages} page(s))`,
  );
  console.log(
    `scanned ${report.scanned} · processed ${report.processed} · unpaid skipped ${report.skippedUnpaid} · FLAGGED ${report.flagged.length}`,
  );
  for (const f of report.flagged) {
    console.log(
      `  ! ${f.eventId} ${f.sessionId} ${f.email || "(no email)"} ${f.ageDays ?? "?"}d old`,
    );
  }
  for (const r of report.refused) {
    console.log(`  - refused ${r.eventId} (${r.email || "no email"}): ${r.reason}`);
  }
  for (const r of report.repaired) {
    console.log(`  + repaired ${r.eventId} → ${r.action} for ${r.email}`);
    // KTD6 — the checkout binding expired long before this ran.
    console.log(`    ${r.email} must sign in again with a magic link (${r.note}).`);
  }
  if (!args.repair && report.flagged.length) {
    console.log("Report only. Re-run with --repair to grant these.");
  }
}

process.exit(0);
