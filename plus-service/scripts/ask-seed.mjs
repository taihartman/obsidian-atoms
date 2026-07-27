/**
 * Seed Ask mirror fixtures for a Plus session.
 *
 *   PLUS_SESSION=sess_… node scripts/ask-seed.mjs
 *   # or magic-link dogfood:
 *   PLUS_EMAIL=you@example.com node scripts/ask-seed.mjs
 *
 * Env: PLUS_BASE_URL (default http://127.0.0.1:8787)
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.PLUS_BASE_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const fixturesDir = join(root, "fixtures/ask-atoms");

function loadFixtures() {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".md"));
  return files.map((f) => {
    const raw = readFileSync(join(fixturesDir, f), "utf8");
    const title = f.replace(/\.md$/i, "");
    let body = raw;
    let tags = [];
    if (raw.startsWith("---")) {
      const end = raw.indexOf("\n---", 3);
      if (end >= 0) {
        const fm = raw.slice(3, end);
        body = raw.slice(end + 4).replace(/^\n/, "");
        const tm = fm.match(/^tags:\s*\[([^\]]*)\]/m);
        if (tm) {
          tags = tm[1]
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        }
      }
    }
    return {
      path: `Atoms/${f}`,
      title,
      body,
      tags,
      links: [],
    };
  });
}

async function resolveSession() {
  if (process.env.PLUS_SESSION) return process.env.PLUS_SESSION.trim();
  const email = process.env.PLUS_EMAIL?.trim();
  if (!email) {
    console.error("Set PLUS_SESSION or PLUS_EMAIL");
    process.exit(1);
  }
  const ml = await fetch(`${base}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!ml.ok) {
    console.error("magic-link failed", ml.status, await ml.text());
    process.exit(1);
  }
  console.error(
    "Magic link requested — copy mt_ token from server log, then:\n  PLUS_SESSION=… after exchange, or set token:",
  );
  const token = process.env.PLUS_MAGIC_TOKEN?.trim();
  if (!token) {
    console.error("Set PLUS_MAGIC_TOKEN=mt_… from server log and re-run");
    process.exit(2);
  }
  const ex = await fetch(`${base}/v1/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const j = await ex.json();
  if (!ex.ok || !j.session) {
    console.error("exchange failed", j);
    process.exit(1);
  }
  return j.session;
}

const dry = process.argv.includes("--dry-run");
const atoms = loadFixtures();
if (dry) {
  console.log(JSON.stringify({ dryRun: true, count: atoms.length, atoms }, null, 2));
  process.exit(0);
}

const session = await resolveSession();
const res = await fetch(`${base}/v1/ask/mirror/upsert`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${session}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ atoms }),
});
const body = await res.json();
if (!res.ok) {
  console.error(res.status, body);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
