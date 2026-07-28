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

/**
 * Graph constellations — the "little web of your life" band. Generated here
 * (seeded, deterministic: same build in, same SVG out, stable fingerprints)
 * so a years-deep library is drawable without hand-placing sixty nodes.
 * Only the story's anchor notes get labels; satellites stay anonymous dots.
 * gd-1..gd-6 classes bucket the draw-in animation delays (see styles.css).
 */
function genGraph(story) {
  let s = story.seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const bucket = (i) => `gd-${(i % 6) + 1}`;
  const E = [], N = [], L = [];

  story.clusters.forEach((c, ci) => {
    const pts = [];
    for (let k = 0; k < c.sats; k++) {
      const a = rand() * Math.PI * 2;
      const rr = c.spread * (0.45 + rand() * 0.55);
      pts.push([
        +(c.x + Math.cos(a) * rr).toFixed(1),
        +(c.y + Math.sin(a) * rr * 0.85).toFixed(1),
      ]);
    }
    pts.forEach(([x, y], k) => {
      E.push(`<line class="graph-edge ${bucket(ci + 1 + (k % 3))}" x1="${c.x}" y1="${c.y}" x2="${x}" y2="${y}"/>`);
      if (k % 3 === 2) {
        const [px, py] = pts[k - 1];
        E.push(`<line class="graph-edge ${bucket(ci + 3)}" x1="${px}" y1="${py}" x2="${x}" y2="${y}"/>`);
      }
      N.push(`<circle class="graph-node graph-node--soft ${bucket(ci + k)}" cx="${x}" cy="${y}" r="${(2.2 + rand() * 1.7).toFixed(1)}"/>`);
    });
  });

  story.bridges.forEach(([a, b], i) => {
    const A = story.clusters[a], B = story.clusters[b];
    E.push(`<line class="graph-edge graph-edge--bridge ${bucket(3 + i)}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`);
  });

  story.atoms.forEach((at, i) => {
    const c = story.clusters[0];
    E.push(`<line class="graph-edge ${bucket(1 + i)}" x1="${c.x}" y1="${c.y}" x2="${at.x}" y2="${at.y}"/>`);
    N.push(`<circle class="graph-node graph-node--atom ${bucket(2 + i)}" cx="${at.x}" cy="${at.y}" r="6"/>`);
    L.push(`<text class="graph-label ${bucket(3 + i)}" x="${at.x}" y="${at.y - 11}" text-anchor="middle">${at.label}</text>`);
  });

  story.clusters.forEach((c, ci) => {
    if (!c.label) {
      N.push(`<circle class="graph-node graph-node--soft ${bucket(ci)}" cx="${c.x}" cy="${c.y}" r="4.5"/>`);
      return;
    }
    const cls = c.kind === "person" ? "graph-node--hub" : "graph-node--hub2";
    N.push(`<circle class="graph-node ${cls} ${bucket(ci)}" cx="${c.x}" cy="${c.y}" r="${c.r}"/>`);
    L.push(`<text class="graph-label graph-label--hub ${bucket(ci + 1)}" x="${c.x}" y="${c.y + c.r + 14}" text-anchor="middle">${c.label}</text>`);
  });

  return `<svg viewBox="0 0 360 300" xmlns="http://www.w3.org/2000/svg" role="img">${E.join("")}${N.join("")}${L.join("")}</svg>`;
}

const GRAPHS = {
  graphRel: {
    seed: 7,
    clusters: [
      { x: 150, y: 158, label: "Sam", kind: "person", r: 13, sats: 12, spread: 62 },
      { x: 282, y: 78, label: "Gift ideas", kind: "hub", r: 9, sats: 8, spread: 44 },
      { x: 296, y: 232, label: "Coast trip", kind: "hub", r: 9, sats: 7, spread: 40 },
      { x: 56, y: 58, label: "", sats: 5, spread: 30 },
    ],
    bridges: [[0, 1], [0, 2], [1, 2], [0, 3]],
    atoms: [
      { x: 96, y: 108, label: "Yellow tulips" },
      { x: 200, y: 122, label: "Poetry section" },
    ],
  },
  graphWork: {
    seed: 11,
    clusters: [
      { x: 150, y: 158, label: "Priya", kind: "person", r: 13, sats: 12, spread: 62 },
      { x: 285, y: 80, label: "Acme pitch", kind: "hub", r: 9, sats: 8, spread: 44 },
      { x: 288, y: 235, label: "Q3 pricing", kind: "hub", r: 9, sats: 7, spread: 40 },
      { x: 58, y: 62, label: "", sats: 5, spread: 30 },
    ],
    bridges: [[0, 1], [0, 2], [1, 2], [0, 3]],
    atoms: [
      { x: 95, y: 105, label: "Budget freeze" },
      { x: 202, y: 120, label: "Decks on phone" },
    ],
  },
  graphSelf: {
    seed: 23,
    clusters: [
      { x: 150, y: 158, label: "Energy", kind: "hub", r: 13, sats: 12, spread: 62 },
      { x: 283, y: 82, label: "Running", kind: "hub", r: 9, sats: 8, spread: 44 },
      { x: 290, y: 232, label: "Meetings", kind: "hub", r: 9, sats: 7, spread: 40 },
      { x: 58, y: 60, label: "", sats: 5, spread: 30 },
    ],
    bridges: [[0, 1], [0, 2], [1, 2], [0, 3]],
    atoms: [
      { x: 93, y: 107, label: "Skipping lunch" },
      { x: 201, y: 121, label: "Clean drafts" },
    ],
  },
};

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
  const values = {
    ...tokens,
    cssPath: paths.styles_css,
    jsPath: paths.app_js,
    graphRel: genGraph(GRAPHS.graphRel),
    graphWork: genGraph(GRAPHS.graphWork),
    graphSelf: genGraph(GRAPHS.graphSelf),
  };

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
