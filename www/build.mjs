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

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readdirSync,
  existsSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  escapeAttr,
  escapeHtml,
  formatNoteDate,
  loadPublishedNotes,
  renderNoteBodyHtml,
} from "./lib/fieldNotesContent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const srcDir = join(here, "src");
const distDir = join(here, "dist");
const publishedDir = join(repoRoot, "docs/field-notes/published");

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

/* ------------------------------------------------------------------ *
 * Graph constellations, the "little web of your life" band.
 *
 * This emits SVG carrying the node/link DATA, seeded so every build is
 * identical (stable fingerprints). At runtime app.js reads the data straight
 * out of this SVG, hides it, and re-renders the same graph on canvas with a
 * real force simulation, the way Obsidian's graph view actually behaves.
 * Positions here are only a sensible starting layout for that simulation and
 * the no-JS fallback.
 * ------------------------------------------------------------------ */

const W = 360;
const H = 300;

function buildGraph(spec) {
  let s = spec.seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const jitter = (n) => (rnd() - 0.5) * n;

  const nodes = [];
  const links = [];
  const add = (n) => (nodes.push(n), nodes.length - 1);

  // Hubs sit on a loose ring, which the simulation then relaxes.
  const hubs = spec.hubs.map((h, i) => {
    const a = (i / spec.hubs.length) * Math.PI * 2 - Math.PI / 2;
    return add({
      label: h.label,
      g: h.kind === "person" ? "person" : "hub",
      x: W / 2 + Math.cos(a) * 78 + jitter(14),
      y: H / 2 + Math.sin(a) * 66 + jitter(12),
    });
  });

  for (let i = 0; i < hubs.length; i++) {
    links.push([hubs[i], hubs[(i + 1) % hubs.length]]);
  }
  links.push([hubs[0], hubs[2 % hubs.length]]);

  // Story anchor notes: the ones the page actually talks about.
  const atoms = spec.atoms.map((at) => {
    const h = nodes[hubs[at.hub]];
    const a = rnd() * Math.PI * 2;
    const i = add({
      label: at.label,
      g: "atom",
      x: h.x + Math.cos(a) * 32,
      y: h.y + Math.sin(a) * 28,
    });
    links.push([i, hubs[at.hub]]);
    if (at.also != null) links.push([i, hubs[at.also]]);
    return i;
  });

  // The quiet majority. A years-deep vault is mostly notes you do not
  // remember writing, which is the whole point of the section.
  const anchors = [...hubs, ...hubs, ...atoms];
  for (let k = 0; k < spec.soft; k++) {
    const anchor = anchors[Math.floor(rnd() * anchors.length)];
    const p = nodes[anchor];
    const a = rnd() * Math.PI * 2;
    const rr = 20 + rnd() * 34;
    const i = add({
      g: "soft",
      x: p.x + Math.cos(a) * rr,
      y: p.y + Math.sin(a) * rr * 0.85,
    });
    links.push([i, anchor]);
    // A few notes bridge two worlds, which is where the graph gets its shape.
    if (rnd() < 0.18) {
      links.push([i, anchors[Math.floor(rnd() * anchors.length)]]);
    }
  }

  const degree = nodes.map(() => 0);
  for (const [a, b] of links) {
    degree[a]++;
    degree[b]++;
  }

  const radius = (i) => {
    const g = nodes[i].g;
    const base = g === "person" || g === "hub" ? 5.5 : g === "atom" ? 4.2 : 2.6;
    return +(base + Math.min(degree[i], 12) * 0.42).toFixed(2);
  };

  const cls = {
    person: "graph-node--hub",
    hub: "graph-node--hub2",
    atom: "graph-node--atom",
    soft: "graph-node--soft",
  };

  const esc = (t) =>
    String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  const svgLinks = links
    .map(([a, b]) => {
      const A = nodes[a];
      const B = nodes[b];
      return `<line class="graph-edge" data-a="${a}" data-b="${b}" x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}"/>`;
    })
    .join("");

  const svgNodes = nodes
    .map((n, i) => {
      const label = n.label ? ` data-label="${esc(n.label)}"` : "";
      return `<circle class="graph-node ${cls[n.g]}" data-g="${n.g}"${label} cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${radius(i)}"/>`;
    })
    .join("");

  const svgLabels = nodes
    .map((n) =>
      n.label
        ? `<text class="graph-label${n.g === "soft" ? "" : " graph-label--hub"}" x="${n.x.toFixed(1)}" y="${(n.y + 14).toFixed(1)}" text-anchor="middle">${esc(n.label)}</text>`
        : "",
    )
    .join("");

  return `<svg class="graph-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${svgLinks}${svgNodes}${svgLabels}</svg>`;
}

const GRAPHS = {
  graphRel: {
    seed: 7,
    soft: 30,
    hubs: [
      { label: "Sam", kind: "person" },
      { label: "Gift ideas", kind: "hub" },
      { label: "Coast trip", kind: "hub" },
      { label: "Anna", kind: "person" },
      { label: "Books", kind: "hub" },
    ],
    atoms: [
      { label: "Yellow tulips", hub: 0, also: 1 },
      { label: "Poetry section", hub: 0, also: 4 },
      { label: "Anna's wedding", hub: 3 },
      { label: "Coast playlist", hub: 2 },
    ],
  },
  graphWork: {
    seed: 11,
    soft: 30,
    hubs: [
      { label: "Priya", kind: "person" },
      { label: "Acme pitch", kind: "hub" },
      { label: "Q3 pricing", kind: "hub" },
      { label: "Dev team", kind: "hub" },
      { label: "Roadmap", kind: "hub" },
    ],
    atoms: [
      { label: "Budget freeze", hub: 0, also: 1 },
      { label: "Decks on phone", hub: 0 },
      { label: "Pilot scope", hub: 1, also: 4 },
      { label: "Renewal date", hub: 2 },
    ],
  },
  graphSelf: {
    seed: 23,
    soft: 30,
    hubs: [
      { label: "Energy", kind: "hub" },
      { label: "Running", kind: "hub" },
      { label: "Meetings", kind: "hub" },
      { label: "Sleep", kind: "hub" },
      { label: "Writing", kind: "hub" },
    ],
    atoms: [
      { label: "Skipping lunch", hub: 0, also: 2 },
      { label: "Clean drafts", hub: 1, also: 4 },
      { label: "Midnight thinking", hub: 3, also: 4 },
      { label: "Morning brain", hub: 3 },
    ],
  },
};

const PAGES = ["index", "privacy", "terms", "setup", "404"];

/**
 * The setup-* shots are lossless WebP straight from the real walkthrough
 * (390x844 @2x). Lossless beats q88 on flat UI colour, so there is no
 * quality tradeoff being made here — see
 * docs/qa/2026-08-04-setup-walkthrough-findings.md.
 */
const SETUP_SHOTS = [
  "setup-restricted-mode.webp",
  "setup-community-plugins-on.webp",
  "setup-community-browse-atoms.webp",
  "setup-atoms-settings.webp",
  "setup-atoms-home.webp",
];

const ASSETS = [
  "_headers",
  "favicon.svg",
  "og.png",
  "robots.txt",
  ...SETUP_SHOTS,
];

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
    graphRel: buildGraph(GRAPHS.graphRel),
    graphWork: buildGraph(GRAPHS.graphWork),
    graphSelf: buildGraph(GRAPHS.graphSelf),
  };

  for (const page of PAGES) {
    const template = readFileSync(join(srcDir, `${page}.html.tmpl`), "utf8");
    writeFileSync(join(distDir, `${page}.html`), render(template, values), "utf8");
  }

  const notes = loadPublishedNotes(publishedDir);
  buildFieldNotesArchive(values, notes);

  for (const asset of ASSETS) {
    copyFileSync(join(srcDir, asset), join(distDir, asset));
  }

  // Field notes illustration sources (SVG). Email HTML prefers PNG for Gmail;
  // SVGs stay on-site as the editable source. See docs/field-notes-email.md.
  const emailSrc = join(srcDir, "email");
  if (existsSync(emailSrc)) {
    const emailDist = join(distDir, "email");
    mkdirSync(emailDist, { recursive: true });
    for (const name of readdirSync(emailSrc)) {
      if (name.startsWith(".")) continue;
      copyFileSync(join(emailSrc, name), join(emailDist, name));
    }
  }

  console.log(
    `[www] built ${PAGES.length} pages + ${notes.length} field notes -> www/dist  ($${pricing.monthlyUsd}/mo, ${pricing.includedFilingsPerPeriod} filings, ${pricing.trialDays}d trial)`,
  );
}

function archiveTopbar(current) {
  const fn =
    current === "notes"
      ? `<a href="/notes/" aria-current="page" class="is-current">Field notes</a>`
      : `<a href="/notes/">Field notes</a>`;
  return `<nav class="topbar" aria-label="Site">
      <div class="topbar-in">
        <a class="topbar-mark" href="/">
          <span class="sentinel" aria-hidden="true">↳</span> Atoms
        </a>
        <ul class="topbar-links">
          <li><a href="/#how">How it works</a></li>
          <li><a href="/#ask">Ask</a></li>
          <li>${fn}</li>
          <li><a href="/#backfill">Catch up</a></li>
          <li><a href="/#pricing">Pricing</a></li>
        </ul>
        <a class="btn btn--primary btn--bar" href="/#pricing">Get Atoms</a>
      </div>
    </nav>`;
}

function notesSignupForm(idPrefix) {
  return `<form class="notes-form" data-notes-form novalidate>
            <label class="notes-label" for="${idPrefix}-email">Email</label>
            <div class="notes-row">
              <input
                id="${idPrefix}-email"
                class="notes-input"
                name="email"
                type="email"
                autocomplete="email"
                inputmode="email"
                required
                placeholder="you@example.com"
              />
              <input
                class="notes-hp"
                type="text"
                name="website"
                tabindex="-1"
                autocomplete="off"
                aria-hidden="true"
              />
              <button class="btn btn--primary" type="submit">
                Keep me in the loop
              </button>
            </div>
            <p class="notes-hint">
              Rare notes by email. Your stories welcome. Reply anytime after you
              join.
            </p>
            <p
              class="notes-status"
              data-notes-status
              role="status"
              aria-live="polite"
            ></p>
          </form>`;
}

function shellPage({ title, description, canonical, cssPath, jsPath, topbar, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="color-scheme" content="dark light" />
    <link rel="canonical" href="${escapeAttr(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="${escapeAttr(cssPath)}" />
  </head>
  <body class="notes-archive">
    ${topbar}
    ${body}
    <script src="${escapeAttr(jsPath)}" defer></script>
  </body>
</html>
`;
}

function buildFieldNotesArchive(values, notes) {
  const notesRoot = join(distDir, "notes");
  mkdirSync(notesRoot, { recursive: true });

  let listHtml;
  if (!notes.length) {
    listHtml = `<p class="notes-empty">No notes published yet. Join the list and the first one lands in your inbox.</p>`;
  } else {
    listHtml = `<ul class="notes-list">
${notes
  .map(
    (n) => `      <li>
        <a class="notes-card" href="/notes/${escapeAttr(n.slug)}/">
          <span class="notes-card-title">${escapeHtml(n.title)}</span>
          <time class="notes-card-date" datetime="${escapeAttr(n.date)}">${escapeHtml(formatNoteDate(n.date))}</time>
          <span class="notes-card-tease">${escapeHtml(n.tease || "")}</span>
        </a>
      </li>`,
  )
  .join("\n")}
    </ul>`;
  }

  const indexBody = `<main class="notes-main">
      <div class="wrap">
        <p class="eyebrow">Field notes</p>
        <h1>Field notes</h1>
        <p class="lede">
          Occasional maker notes on a second brain in real life. Read any issue
          here. New ones also arrive by email.
        </p>
        ${listHtml}
        <section class="notes-signup" aria-label="Subscribe to Field notes">
          <h2 class="notes-signup-title">Get the next one by email</h2>
          ${notesSignupForm("notes-idx")}
        </section>
      </div>
    </main>`;

  writeFileSync(
    join(notesRoot, "index.html"),
    shellPage({
      title: "Field notes · Atoms",
      description:
        "Occasional maker notes on a second brain in real life. Read past Field notes from Atoms.",
      canonical: "https://tryatoms.app/notes/",
      cssPath: values.cssPath,
      jsPath: values.jsPath,
      topbar: archiveTopbar("notes"),
      body: indexBody,
    }),
    "utf8",
  );

  for (const n of notes) {
    const dir = join(notesRoot, n.slug);
    mkdirSync(dir, { recursive: true });
    const metaDesc = String(n.tease || n.paragraphs[0] || n.title).slice(0, 160);
    const issueBody = `<main class="notes-main notes-main--issue">
      <div class="wrap">
        <p class="notes-crumb"><a href="/notes/">← All Field notes</a></p>
        <h1>${escapeHtml(n.title)}</h1>
        <p class="notes-meta"><time datetime="${escapeAttr(n.date)}">${escapeHtml(formatNoteDate(n.date))}</time></p>
        <article class="notes-body">
${renderNoteBodyHtml(n)}
        </article>
        <section class="notes-signup" aria-label="Subscribe to Field notes">
          <h2 class="notes-signup-title">Get the next one by email</h2>
          <p class="notes-email-primary">New notes also arrive by email when you join the list.</p>
          ${notesSignupForm(`notes-${n.slug}`)}
        </section>
      </div>
    </main>`;
    writeFileSync(
      join(dir, "index.html"),
      shellPage({
        title: `${n.title} · Field notes · Atoms`,
        description: metaDesc,
        canonical: `https://tryatoms.app/notes/${n.slug}/`,
        cssPath: values.cssPath,
        jsPath: values.jsPath,
        topbar: archiveTopbar("issue"),
        body: issueBody,
      }),
      "utf8",
    );
  }
}

// Only build when run directly, so tests can import render() cleanly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  build();
}

export {
  tokens,
  trialFinePrint,
  PAGES,
  buildGraph,
  GRAPHS,
  buildFieldNotesArchive,
  publishedDir,
};
