/**
 * Trial harness for the classifier-named `people` field (#227).
 *
 * Answers the two questions unit tests and the demo-vault smoke cannot:
 *   1) does the live API accept CLASSIFICATION_SCHEMA with `people` required?
 *   2) does the model assign `subject` / `mentioned` / `recommender` correctly?
 *
 * Uses the plus-service snapshot of the prompt + schema, which a unit test
 * pins to the plugin's copy — so this exercises the shipped contract, not a
 * paraphrase of it.
 *
 * Usage:
 *   node scripts/trial-people.mjs --dry     # no key: request shape + schema only
 *   ANTHROPIC_API_KEY=sk-... node scripts/trial-people.mjs
 *   ... --model claude-sonnet-5 --case 2    # single case
 *
 * Log-safety: never prints the key, headers, or full request bodies.
 * Exits non-zero when any case fails, so it can gate a release.
 */
import {
  CLASSIFICATION_SCHEMA,
  SYSTEM_PROMPT,
} from "../plus-service/src/classifyTemplate.mjs";

const API_URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const DRY = argv.includes("--dry");
const MODEL = flag("model", DEFAULT_MODEL);
const ONLY = flag("case", null);

/**
 * `expect` is asserted against the *guarded* result the plugin would keep.
 * roles: name → role. `absent` names must not appear at all.
 */
const CASES = [
  {
    id: 1,
    why: "the reported bug — subject elided, Annie only owns the snack",
    capture: "likes annie's fruit tape snack",
    expect: { roles: { Annie: "mentioned" }, noSubject: true },
  },
  {
    id: 2,
    why: "plain subject — must still invite",
    capture: "nichita likes long brown boots",
    expect: { roles: { Nichita: "subject" } },
  },
  {
    id: 3,
    why: "a verb 0.6.60's word list never contained",
    capture: "skipped the gym because nichita likes the late class",
    expect: { roles: { Nichita: "subject" }, absent: ["Skipped"] },
  },
  {
    id: 4,
    why: "media recommender is not the subject",
    capture: "christian told me to watch my hero academia",
    expect: { roles: { Christian: "recommender" }, noSubject: true },
  },
  {
    id: 5,
    why: "no person at all — empty people[] must be comfortable",
    capture: "sleep debt doesn't accumulate linearly the way i assumed",
    expect: { empty: true },
  },
  {
    id: 6,
    why: "kinship subject",
    capture: "mom wants to celebrate her birthday with a climb then dinner",
    expect: { roles: { Mom: "subject" } },
  },
];

/** Minimal context block — the trial is about people[], not retrieval. */
function buildRequest(capture) {
  return {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "### Active vocabulary\npreferences, person, relationship, watch, show, movie, media, list\n\n### Person hubs\nNichita\n",
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
          { type: "text", text: "### Note titles\nNichita\nPeople\n" },
        ],
      },
      { role: "user", content: [{ type: "text", text: `Capture:\n${capture}` }] },
    ],
    output_config: {
      format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA },
    },
  };
}

/** Mirrors normalizePeople: verbatim-in-capture, known role, deduped. */
function guard(capture, people) {
  const seen = new Set();
  const out = [];
  for (const p of people ?? []) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name || !["subject", "mentioned", "recommender"].includes(p?.role)) continue;
    const re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['’]s)?(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    if (!re.test(capture)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, role: p.role });
  }
  return out;
}

function check(c, people) {
  const problems = [];
  const byName = new Map(people.map((p) => [p.name.toLowerCase(), p.role]));
  if (c.expect.empty && people.length) {
    problems.push(`expected nobody, got ${JSON.stringify(people)}`);
  }
  for (const [name, role] of Object.entries(c.expect.roles ?? {})) {
    const got = byName.get(name.toLowerCase());
    if (got !== role) problems.push(`${name}: expected ${role}, got ${got ?? "absent"}`);
  }
  for (const name of c.expect.absent ?? []) {
    if (byName.has(name.toLowerCase())) problems.push(`${name} should never be named`);
  }
  if (c.expect.noSubject && people.some((p) => p.role === "subject")) {
    problems.push(`expected no subject, got ${people.filter((p) => p.role === "subject").map((p) => p.name).join(", ")}`);
  }
  return problems;
}

async function callApi(apiKey, capture) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
    },
    body: JSON.stringify(buildRequest(capture)),
  });
  if (!res.ok) {
    const detail = await res.text();
    // Surface the API's own complaint about the schema — that is the point.
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = json?.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in response");
  return JSON.parse(text);
}

const cases = ONLY ? CASES.filter((c) => String(c.id) === String(ONLY)) : CASES;

if (DRY) {
  const req = buildRequest(cases[0].capture);
  const people = CLASSIFICATION_SCHEMA.properties.people;
  console.log("[trial] dry run — no API call, no key needed\n");
  console.log("  schema.required        :", CLASSIFICATION_SCHEMA.required.join(", "));
  console.log("  people.items.required  :", people.items.required.join(", "));
  console.log("  role.enum              :", people.items.properties.role.enum.join(" | "));
  console.log("  additionalProperties   :", people.items.additionalProperties);
  console.log("  output_config.format   :", req.output_config.format.type);
  console.log("  request bytes          :", JSON.stringify(req).length);
  console.log("\n  serialisable JSON schema:", (() => {
    try {
      JSON.parse(JSON.stringify(CLASSIFICATION_SCHEMA));
      return "yes";
    } catch {
      return "NO";
    }
  })());
  console.log(`\n[trial] ${cases.length} case(s) ready. Re-run with ANTHROPIC_API_KEY set to test the model.`);
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("[trial] ANTHROPIC_API_KEY not set. Use --dry for the offline check.");
  process.exit(2);
}

let failed = 0;
for (const c of cases) {
  process.stdout.write(`\n[case ${c.id}] ${c.why}\n  capture: ${c.capture}\n`);
  try {
    const result = await callApi(apiKey, c.capture);
    const raw = result.people ?? [];
    const kept = guard(c.capture, raw);
    const dropped = raw.length - kept.length;
    console.log(`  verdict: ${result.verdict}  title: ${result.title}`);
    console.log(
      `  people : ${kept.map((p) => `${p.name}=${p.role}`).join(", ") || "(none)"}` +
        (dropped ? `   [${dropped} dropped by guard]` : ""),
    );
    const problems = check(c, kept);
    if (problems.length) {
      failed++;
      for (const p of problems) console.log(`  FAIL   : ${p}`);
    } else {
      console.log("  PASS");
    }
  } catch (err) {
    failed++;
    console.log(`  ERROR  : ${err.message}`);
  }
}

console.log(
  `\n[trial] ${cases.length - failed}/${cases.length} passed on ${MODEL}.`,
);
process.exit(failed ? 1 : 0);
