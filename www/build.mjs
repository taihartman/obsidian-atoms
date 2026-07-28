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
import { createHash } from "crypto";
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
const ASSETS = ["_headers", "favicon.svg", "og.png", "robots.txt"];

/**
 * CSS and JS ship content-fingerprinted under /a/ with immutable caching, so
 * a deploy can never serve new HTML with a stale stylesheet again (that
 * exact mix is what broke the story switcher on 2026-07-28).
 */
const FINGERPRINTED = ["styles.css", "app.js"];

function fingerprint(name) {
  const content = readFileSync(join(srcDir, name));
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 8);
  const [base, ext] = [name.slice(0, name.lastIndexOf(".")), name.split(".").pop()];
  return { name, hashedName: `${base}.${hash}.${ext}`, content };
}

function build() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(join(distDir, "a"), { recursive: true });

  const hashed = FINGERPRINTED.map(fingerprint);
  for (const f of hashed) {
    writeFileSync(join(distDir, "a", f.hashedName), f.content);
  }
  const paths = Object.fromEntries(
    hashed.map((f) => [f.name.replace(".", "_"), `/a/${f.hashedName}`]),
  );
  const values = { ...tokens, cssPath: paths.styles_css, jsPath: paths.app_js };

  for (const page of PAGES) {
    const template = readFileSync(join(srcDir, `${page}.html.tmpl`), "utf8");
    writeFileSync(join(distDir, `${page}.html`), render(template, values), "utf8");
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
