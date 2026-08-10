#!/usr/bin/env node
/**
 * Embeds docs/marketing/state.json into docs/marketing/desk/index.html
 *
 *   node scripts/marketing-desk-build.mjs
 *   node scripts/marketing-desk-build.mjs --open
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = join(root, "docs/marketing/state.json");
const outDir = join(root, "docs/marketing/desk");
const outPath = join(outDir, "index.html");
const deskJsSrc = join(outDir, "desk.js");

const state = JSON.parse(readFileSync(statePath, "utf8"));
// Prevent </script> breakout inside embedded blobs
const embedded = JSON.stringify(state).replace(/</g, "\\u003c");
const deskJs = readFileSync(deskJsSrc, "utf8").replace(/<\/script/gi, "<\\/script");

const css = `    :root {
      --bg: #000;
      --surface: #1c1c1e;
      --elev: #2c2c2e;
      --sep: rgba(84, 84, 88, 0.55);
      --label: #fff;
      --muted: rgba(235, 235, 245, 0.6);
      --faint: rgba(235, 235, 245, 0.5);
      --tint: #0a84ff;
      --ok: #30d158;
      --warn: #ff9f0a;
      --err: #ff453a;
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      --serif: "New York", ui-serif, Georgia, serif;
      --r: 16px;
      --gutter: 20px;
      --measure: 40rem;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f2f2f7;
        --surface: #fff;
        --elev: #e9e9ee;
        --sep: rgba(60, 60, 67, 0.29);
        --label: #000;
        --muted: rgba(60, 60, 67, 0.78);
        --faint: rgba(60, 60, 67, 0.74);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      background: var(--bg);
      color: var(--label);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: var(--measure); margin: 0 auto; padding: 24px var(--gutter) 72px; }
    .eyebrow {
      font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--muted); margin: 0 0 6px;
    }
    h1 { font-size: 1.55rem; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 6px; }
    .north { font-family: var(--serif); font-size: 1rem; color: var(--muted); margin: 0; }
    .meta { margin-top: 10px; font-size: 0.78rem; color: var(--faint); }
    section { margin-bottom: 26px; }
    h2 {
      font-size: 0.7rem; font-weight: 600; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--muted); margin: 0 0 10px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--sep);
      border-radius: var(--r);
      overflow: hidden;
    }
    .card.hero {
      border-color: color-mix(in srgb, var(--tint) 45%, var(--sep));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--tint) 12%, transparent);
    }
    .row {
      display: flex; gap: 12px; align-items: flex-start;
      padding: 14px 16px; border-bottom: 1px solid var(--sep);
    }
    .row:last-child { border-bottom: 0; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      gap: 8px;
    }
    .metric {
      background: var(--surface); border: 1px solid var(--sep);
      border-radius: 14px; padding: 12px;
    }
    .metric .val { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.03em; margin: 2px 0; }
    .metric .val.unk { color: var(--faint); font-size: 1.05rem; font-weight: 600; }
    .metric .lab { font-size: 0.78rem; color: var(--muted); }
    .metric .note { font-size: 0.7rem; color: var(--faint); margin-top: 4px; }
    .budget-bar {
      height: 6px; border-radius: 3px; background: var(--elev);
      overflow: hidden; margin-top: 10px;
    }
    .budget-bar > i { display: block; height: 100%; background: var(--tint); border-radius: 3px; }
    .badge {
      flex: 0 0 auto; font-size: 0.65rem; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase;
      padding: 4px 8px; border-radius: 980px;
      background: var(--elev); color: var(--muted);
    }
    .badge.todo, .badge.pending { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
    .badge.done, .badge.yes { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
    .badge.no, .badge.blocked { color: var(--err); background: color-mix(in srgb, var(--err) 14%, transparent); }
    .badge.skip { color: var(--faint); }
    .body { flex: 1; min-width: 0; }
    .title { font-weight: 600; font-size: 1rem; margin: 0 0 4px; letter-spacing: -0.015em; }
    .detail { font-size: 0.85rem; color: var(--muted); margin: 0 0 8px; }
    .steps {
      font-size: 0.88rem; margin: 0 0 12px; padding: 10px 12px;
      background: var(--elev); border-radius: 10px;
    }
    .paste-block { margin-top: 12px; }
    .paste-label {
      font-size: 0.68rem; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--muted); margin: 0 0 6px;
    }
    .paste-box {
      width: 100%; min-height: 2.5rem; max-height: 14rem;
      padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--sep); background: var(--bg);
      color: var(--label); font: inherit; font-size: 0.85rem;
      line-height: 1.4; resize: vertical; white-space: pre-wrap;
    }
    .paste-box.body { min-height: 12rem; max-height: 22rem; font-size: 0.82rem; }
    .actions {
      display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;
    }
    button, .btn {
      appearance: none; border: 0; cursor: pointer;
      font: inherit; font-size: 0.85rem; font-weight: 600;
      padding: 11px 14px; border-radius: 12px;
      background: var(--tint); color: #fff;
      min-height: 44px; text-decoration: none;
      display: inline-flex; align-items: center; justify-content: center;
    }
    button.secondary, .btn.secondary {
      background: var(--elev); color: var(--label);
    }
    button:active { transform: scale(0.98); opacity: 0.92; }
    button.copied { background: var(--ok); }
    .effort { font-size: 0.75rem; color: var(--faint); margin-top: 10px; }
    .intro { font-size: 0.88rem; color: var(--muted); margin: 0 0 12px; }
    .empty { padding: 18px 16px; color: var(--muted); font-size: 0.9rem; }
    .done-wrap { opacity: 0.72; }
    .pill-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill-links a {
      display: inline-block; padding: 8px 12px;
      background: var(--surface); border: 1px solid var(--sep);
      border-radius: 980px; color: var(--label); font-size: 0.8rem;
      text-decoration: none;
    }
    a { color: var(--tint); }
    footer {
      margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--sep);
      font-size: 0.72rem; color: var(--faint);
    }
    details.done-section summary {
      cursor: pointer; color: var(--muted); font-size: 0.85rem;
      padding: 8px 0; list-style: none;
    }
    details.done-section summary::-webkit-details-marker { display: none; }
    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: var(--ok); color: #000; font-weight: 600; font-size: 0.85rem;
      padding: 10px 16px; border-radius: 980px; opacity: 0;
      pointer-events: none; transition: opacity 0.2s;
      z-index: 20;
    }
    .toast.show { opacity: 1; }`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Atoms · Marketing desk</title>
  <style>
${css}
  </style>
</head>
<body>
  <div class="wrap" id="app"><p class="eyebrow">Loading…</p></div>
  <div class="toast" id="toast">Copied</div>
  <script type="application/json" id="desk-state">${embedded}</script>
  <script>
${deskJs}
  </script>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, html, "utf8");
console.log("Wrote", outPath);

try {
  // eslint-disable-next-line no-new-func
  new Function(deskJs);
  console.log("desk.js ok");
} catch (e) {
  console.error("desk.js syntax error:", e.message);
  process.exit(1);
}

if (process.argv.includes("--open")) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  execFileSync(opener, [outPath], { stdio: "inherit" });
}
