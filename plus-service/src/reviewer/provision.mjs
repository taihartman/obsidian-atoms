import "../loadEnv.mjs";
import { createStore } from "../store.mjs";
import {
  formatPairCodeDisplay,
  isReviewerIdentity,
  MAX_PAIR_CODE_TTL_MS,
  normEmail,
} from "../store/askHelpers.mjs";
import { isProduction } from "../prodGate.mjs";

export const DEFAULT_REVIEW_PAIR_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const OPENAI_REVIEW_FIXTURES = Object.freeze([
  {
    path: "Atoms/Blue notebook ritual.md",
    title: "Blue notebook ritual",
    body: "Writing three lines in a blue notebook before breakfast makes it easier to start the first draft.",
    tags: ["ritual", "writing"],
    links: [],
    created: "2026-09-01T08:00:00",
  },
  {
    path: "Atoms/Library window idea.md",
    title: "Library window idea",
    body: "The quiet table by the east library window is a good place to revise long drafts.",
    tags: ["place", "writing"],
    links: [],
    created: "2026-09-02T09:15:00",
  },
  {
    path: "Atoms/Call Mira about the field guide.md",
    title: "Call Mira about the field guide",
    body: "Ask Mira whether the field guide should include the notebook ritual and the library window.",
    tags: ["project", "follow-up"],
    links: [
      { note: "Blue notebook ritual", reason: "The field guide may include [[Blue notebook ritual]]." },
      { note: "Library window idea", reason: "The field guide may include [[Library window idea]]." },
    ],
    loop: { state: "active", source: "user" },
    created: "2026-09-03T13:30:00",
  },
]);

export function normalizeReviewerEmail(email) {
  const normalized = normEmail(email);
  if (!isReviewerIdentity(normalized)) {
    throw new Error("Reviewer identity must end with @review.tryatoms.app");
  }
  return normalized;
}

export function assertReviewerStore({
  store,
  production,
  allowNonProductionMemory = false,
  allowNonProductionPostgres = false,
}) {
  if (!store?.kind) throw new Error("Reviewer provisioning requires an identified store");
  if (production && store.kind !== "postgres") {
    throw new Error("Production reviewer provisioning requires Postgres");
  }
  if (!production && store.kind === "memory" && !allowNonProductionMemory) {
    throw new Error("Refusing ephemeral memory reviewer persistence without the explicit non-production test flag");
  }
  if (!production && store.kind === "postgres" && !allowNonProductionPostgres) {
    throw new Error(
      "Refusing nonproduction Postgres reviewer provisioning without the explicit operator override",
    );
  }
}

export async function provisionOpenAiReviewer({
  store,
  email,
  ttlMs = DEFAULT_REVIEW_PAIR_TTL_MS,
  production = isProduction(),
  allowNonProductionMemory = false,
  allowNonProductionPostgres = false,
}) {
  const reviewerEmail = normalizeReviewerEmail(email);
  assertReviewerStore({
    store,
    production,
    allowNonProductionMemory,
    allowNonProductionPostgres,
  });

  await store.grantPeriod(reviewerEmail, {
    status: "active",
    plan: "monthly",
    remaining: 150,
    days: 90,
  });
  await store.mirrorWipe(reviewerEmail);
  await store.mirrorUpsert(reviewerEmail, OPENAI_REVIEW_FIXTURES);
  const pair = await store.pairMint(reviewerEmail, {
    reviewerCredential: true,
    ttlMs,
  });

  return {
    email: reviewerEmail,
    code: pair.code,
    expiresAt: pair.expiresAt,
    fixtureCount: OPENAI_REVIEW_FIXTURES.length,
  };
}

function parseTtlMs(rawDays) {
  if (rawDays === undefined || rawDays === "") return DEFAULT_REVIEW_PAIR_TTL_MS;
  const days = Number(rawDays);
  const ttlMs = days * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_PAIR_CODE_TTL_MS) {
    throw new Error("OPENAI_REVIEWER_PAIR_TTL_DAYS must be greater than 0 and at most 90");
  }
  return ttlMs;
}

export function formatProvisioningSummary(result) {
  return [
    `Reviewer identity: ${result.email}`,
    `Pairing code: ${formatPairCodeDisplay(result.code)}`,
    `Expires: ${result.expiresAt}`,
    `Synthetic fixtures: ${result.fixtureCount}`,
    "Reviewer instructions: connect Atoms Plus in ChatGPT and enter the pairing code when prompted.",
    "The pairing code is reusable until it expires; rerun this command to invalidate it and mint a replacement.",
  ].join("\n");
}

export async function runProvisionReviewerCli(
  argv = process.argv.slice(2),
  { createStoreFn = createStore } = {},
) {
  const allowNonProductionMemory = argv.includes("--allow-memory-test");
  const allowNonProductionPostgres = argv.includes(
    "--allow-nonproduction-postgres-reviewer",
  );
  const production = isProduction();
  if (production && (allowNonProductionMemory || allowNonProductionPostgres)) {
    throw new Error("Nonproduction reviewer overrides are forbidden in production");
  }
  const email = process.env.OPENAI_REVIEWER_EMAIL;
  if (!email) throw new Error("OPENAI_REVIEWER_EMAIL is required");
  const ttlMs = parseTtlMs(process.env.OPENAI_REVIEWER_PAIR_TTL_DAYS);
  const store = await createStoreFn();
  try {
    const result = await provisionOpenAiReviewer({
      store,
      email,
      ttlMs,
      production,
      allowNonProductionMemory,
      allowNonProductionPostgres,
    });
    process.stdout.write(`${formatProvisioningSummary(result)}\n`);
  } finally {
    if (store.close) await store.close();
  }
}

export function reportProvisioningFailure() {
  process.stderr.write(
    "Reviewer provisioning failed. Check the operator inputs and service logs; secrets were not printed.\n",
  );
}
