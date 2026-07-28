/*
 * Builds www/dist from www/src.
 *
 * The only reason this script exists is so no price is ever typed by hand into
 * the public page. Every number comes from repo-root plus-pricing.json (SSOT),
 * and an unsubstituted {{token}} is a build failure, not a customer-visible
 * "{{monthlyUsd}}".
 *
 * Run: npm run build:www
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const srcDir = join(here, "src");
const distDir = join(here, "dist");

const pricing = JSON.parse(
  readFileSync(join(repoRoot, "plus-pricing.json"), "utf8"),
);

/**
 * Locked sentences. These must read exactly as the plugin says them, so they
 * are derived here with the same formula as src/shared/plusPricing.ts and
 * cross-checked against that module in test/wwwPricing.test.ts.
 */
function trialFinePrint() {
  return `${pricing.trialDays} days free, then $${pricing.monthlyUsd}/month. Cancel anytime. Card required for trial.`;
}

const tokens = {
  monthlyUsd: pricing.monthlyUsd,
  yearlyUsd: pricing.yearlyUsd,
  yearlyDiscountNote: pricing.yearlyDiscountNote,
  topUpUsd: pricing.topUpUsd,
  topUpFilings: pricing.topUpFilings,
  includedFilingsPerPeriod: pricing.includedFilingsPerPeriod,
  trialDays: pricing.trialDays,
  trialFinePrint: trialFinePrint(),
};

/** Substitute {{token}} and refuse to emit a page with any left over. */
export function render(template, values = tokens) {
  const out = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Unknown template token ${match}`);
    }
    return String(values[key]);
  });
  const leftover = out.match(/\{\{\w+\}\}/g);
  if (leftover) {
    throw new Error(`Unsubstituted tokens: ${leftover.join(", ")}`);
  }
  return out;
}

const PAGES = ["index", "privacy", "terms", "404"];
const ASSETS = ["styles.css", "_headers", "favicon.svg", "og.png", "robots.txt"];

function build() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  for (const page of PAGES) {
    const template = readFileSync(join(srcDir, `${page}.html.tmpl`), "utf8");
    writeFileSync(join(distDir, `${page}.html`), render(template), "utf8");
  }

  for (const asset of ASSETS) {
    copyFileSync(join(srcDir, asset), join(distDir, asset));
  }

  console.log(
    `[www] built ${PAGES.length} pages -> www/dist  ($${pricing.monthlyUsd}/mo, ${pricing.includedFilingsPerPeriod} filings, ${pricing.trialDays}d trial)`,
  );
}

// Only build when run directly, so tests can import render() cleanly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  build();
}

export { tokens, trialFinePrint, PAGES };
