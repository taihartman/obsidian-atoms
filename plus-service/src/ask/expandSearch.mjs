/**
 * Index-time search expansion (Ask mirror) — questions/phrases for lexical recall.
 * Never log body, prompt, or expand text.
 */
import { config } from "../config.mjs";

const GENERIC_PHRASE_RE =
  /^(how to improve|what is success|key takeaways|summary of this|main points|important notes|overview of the note|general thoughts)\b/i;

/** @param {string} email */
function normEmail(email) {
  return String(email || "").toLowerCase();
}

/** @type {{ ok: number, fail: Record<string, number> }} */
const expandStats = { ok: 0, fail: {} };

/**
 * @param {string} reason
 */
function bumpFail(reason) {
  const k = String(reason || "unknown").slice(0, 40);
  expandStats.fail[k] = (expandStats.fail[k] || 0) + 1;
  // Counters only — never body/prompt/phrases
  console.info(
    `[plus] expand fail reason=${k} ok=${expandStats.ok} fails=${JSON.stringify(expandStats.fail)}`,
  );
}

/**
 * @param {string} title
 * @param {string[]} tags
 * @param {string} bodySlice
 */
export function buildExpandPrompt(title, tags, bodySlice) {
  const tagLine = (tags || []).filter(Boolean).slice(0, 12).join(", ");
  return `You help index a personal note for search. Given the note title, tags, and body excerpt, output 3 to 5 short search phrases or questions a user might ask that this note answers.

Critical: use everyday paraphrase wording the user might type later — not the note's own jargon. It is good if phrases share few words with the title.

Rules:
- Reply with a JSON array of strings only (no markdown fences)
- Each phrase at most 120 characters
- Do not invent facts unsupported by the note
- Do not output the exact title alone
- Prefer concrete how/what/why questions and plain synonyms

Title: ${String(title || "").slice(0, 300)}
Tags: ${tagLine || "(none)"}
Body excerpt:
${String(bodySlice || "").slice(0, 4000)}`;
}

/**
 * @param {unknown} raw
 * @param {{ title?: string, tags?: string[], bodySlice?: string }} [ctx]
 * @returns {string[]}
 */
export function parseExpandResponse(raw, ctx = {}) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw.map((x) => String(x ?? "").trim());
  } else {
    let s = String(raw ?? "").trim();
    if (!s) return [];
    // Strip common markdown fences
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) list = j.map((x) => String(x ?? "").trim());
      else list = s.split(/\n+/).map((l) => l.replace(/^[-*\d.)\s]+/, "").trim());
    } catch {
      // Try to extract a JSON array substring
      const m = s.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const j = JSON.parse(m[0]);
          if (Array.isArray(j)) list = j.map((x) => String(x ?? "").trim());
        } catch {
          list = s.split(/\n+/).map((l) => l.replace(/^[-*\d.)\s]+/, "").trim());
        }
      } else {
        list = s.split(/\n+/).map((l) => l.replace(/^[-*\d.)\s]+/, "").trim());
      }
    }
  }

  const title = String(ctx.title || "").trim().toLowerCase();
  // Deliberately NO source-token-overlap check here. KTD6 once asked for one
  // (keep a phrase only if it shares a >=4-char token with title ∪ tags ∪
  // bodySlice); it shipped, killed recall, and was removed in 8c367b7 —
  // overlap with the note's own text is definitionally what a paraphrase
  // lacks, so requiring it drops exactly the phrases this feature exists to
  // produce (buildExpandPrompt above asks the model for them). The
  // anti-generic goal is carried by GENERIC_PHRASE_RE and the max-5 cap.
  // Re-implemented by mistake in 0526ff3 and reverted again; do not add a third.
  const out = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || p.length < 8 || p.length > 120) continue;
    if (GENERIC_PHRASE_RE.test(p)) continue;
    const low = p.toLowerCase();
    if (title && low === title) continue;
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(p);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * @param {{ title: string, tags?: string[], body: string }} atom
 * @returns {Promise<{ ok: true, phrases: string[] } | { ok: false, reason: string }>}
 */
export async function generateExpandPhrases(atom) {
  if (!config.anthropicApiKey) {
    return { ok: false, reason: "no_key" };
  }
  const title = String(atom.title || "");
  const tags = Array.isArray(atom.tags) ? atom.tags.map(String) : [];
  const bodySlice = String(atom.body || "").slice(0, 4000);
  const prompt = buildExpandPrompt(title, tags, bodySlice);
  const model = config.askExpandModel;

  try {
    const res = await fetch(config.anthropicUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": config.anthropicVersion,
      },
      body: JSON.stringify({
        model,
        // Backstop, not a target: adaptive thinking counts against this cap
        // on current models, so leave headroom above the short phrase list.
        max_tokens: 1024,
        // No sampling params: Sonnet 5+ rejects `temperature` with a 400,
        // which silently zeroed this pool in prod (see guardrails test).
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(config.askExpandTimeoutMs),
    });
    if (!res.ok) {
      return { ok: false, reason: `upstream_${res.status}` };
    }
    const json = await res.json().catch(() => ({}));
    const text =
      json?.content?.find?.((b) => b?.type === "text")?.text ??
      json?.content?.[0]?.text ??
      "";
    const phrases = parseExpandResponse(text, { title, tags, bodySlice });
    if (!phrases.length) return { ok: false, reason: "empty_parse" };
    return { ok: true, phrases };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network_or_timeout" };
  }
}

/** @type {Map<string, number>} */
const emailHourBuckets = new Map();

/**
 * @param {string} email
 * @returns {boolean} true if allowed
 */
export function checkExpandRateLimit(email) {
  const key = normEmail(email);
  const limit = config.askExpandPerEmailPerHour;
  if (!limit || limit <= 0) return true;
  const hour = Math.floor(Date.now() / 3600000);
  const bucketKey = `${key}:${hour}`;
  const n = emailHourBuckets.get(bucketKey) || 0;
  if (n >= limit) return false;
  emailHourBuckets.set(bucketKey, n + 1);
  if (emailHourBuckets.size > 5000) {
    for (const k of emailHourBuckets.keys()) {
      if (!k.endsWith(`:${hour}`) && !k.endsWith(`:${hour - 1}`)) {
        emailHourBuckets.delete(k);
      }
    }
  }
  return true;
}

/** @type {{ active: number, queue: Function[] }} */
const pool = { active: 0, queue: [] };

function pumpExpandPool() {
  const max = config.askExpandConcurrency;
  while (pool.active < max && pool.queue.length) {
    const job = pool.queue.shift();
    pool.active += 1;
    Promise.resolve()
      .then(job)
      .finally(() => {
        pool.active -= 1;
        pumpExpandPool();
      });
  }
}

/**
 * Rows queued or running, keyed by account+path+hash. Upsert enqueues a row and
 * the backfill lists the same row as "missing" until the pool actually writes
 * expand back — without this key the two paths pay Anthropic twice for one row.
 * @type {Set<string>}
 */
const inFlight = new Set();

/**
 * Wipe times, keyed by normalised email.
 *
 * A queued expand job closes over the atom body — it never re-reads the row —
 * so `mirrorWipe` deleting the row does not stop the plaintext leaving. The
 * shipped disclosure says Wipe removes search expansions, so the queue has to
 * be drained too, and draining it means the job itself checking, right before
 * it calls Anthropic, whether its account was wiped while it sat in the pool.
 *
 * **Scoped by time, not by a permanent flag.** A job carries the moment it was
 * enqueued and aborts when a wipe landed at or after that moment. Anything
 * enqueued later — a legitimate re-sync after the user mirrors again — has a
 * newer stamp than the wipe and runs normally, so one Wipe cannot brick an
 * account's expansion forever. The comparison is `>=` rather than `>` so that
 * a same-millisecond race resolves toward *not* sending: the cost is one
 * skipped expansion that the backfill picks up again, against the cost of a
 * body the user just asked us to forget going out anyway.
 *
 * @type {Map<string, number>}
 */
const expandCancelledAt = new Map();
const CANCEL_TTL_MS = 60 * 60 * 1000;

/**
 * Abort expand work already queued or running for this account.
 * @param {string} email
 * @returns {number} the cancellation timestamp
 */
export function cancelExpandForEmail(email) {
  const now = Date.now();
  expandCancelledAt.set(normEmail(email), now);
  // Jobs are bounded by the expand timeout, so an entry this old can only be
  // holding memory. Prune on write; there is no other traffic to this map.
  for (const [k, t] of expandCancelledAt) {
    if (now - t > CANCEL_TTL_MS) expandCancelledAt.delete(k);
  }
  return now;
}

/**
 * @param {string} email
 * @param {number} enqueuedAt
 * @returns {boolean}
 */
function expandCancelled(email, enqueuedAt) {
  const at = expandCancelledAt.get(normEmail(email));
  return at !== undefined && at >= enqueuedAt;
}

/** @param {{ email: string, path: string, contentHash: string }} job */
function expandKey(job) {
  return `${job.email}\u0000${job.path}\u0000${job.contentHash}`;
}

/**
 * Fire-and-forget expand after mirror write.
 * @param {{ mirrorSetExpand: Function }} store
 * @param {{ email: string, path: string, title: string, tags: string[], body: string, contentHash: string }} job
 * @returns {boolean} true when this call queued work (false = disabled, rate-limited, or already queued)
 */
export function enqueueMirrorExpand(store, job) {
  if (!config.askExpandEnabled) return false;
  // A keyless deployment can never send: `generateExpandPhrases` returns
  // `no_key` before it builds a request. Checking here as well keeps it from
  // spending rate-limit budget and logging a failure per row on the way to
  // that answer. The guard inside the generator stays as defence in depth.
  if (!config.anthropicApiKey) return false;
  const key = expandKey(job);
  if (inFlight.has(key)) return false;
  if (!checkExpandRateLimit(job.email)) {
    bumpFail("rate_limit");
    return false;
  }
  const enqueuedAt = Date.now();
  inFlight.add(key);
  pool.queue.push(async () => {
    try {
      // Checked here, not at enqueue: this job may have sat in the pool while
      // the account was wiped, and the body it would send is in its closure.
      if (expandCancelled(job.email, enqueuedAt)) {
        bumpFail("wiped");
        return;
      }
      const result = await generateExpandPhrases({
        title: job.title,
        tags: job.tags,
        body: job.body,
      });
      if (!result.ok) {
        bumpFail(result.reason);
        return;
      }
      const text = result.phrases.join("\n");
      const set = await store.mirrorSetExpand(
        job.email,
        job.path,
        job.contentHash,
        text,
      );
      if (set?.updated) {
        expandStats.ok += 1;
      } else {
        bumpFail("set_noop");
      }
    } catch {
      bumpFail("exception");
    } finally {
      inFlight.delete(key);
    }
  });
  pumpExpandPool();
  return true;
}

/**
 * Queue expand for one account's rows that still lack it, and return at once.
 *
 * This used to loop the rows sequentially, awaiting a model call each (12s
 * timeout), while the caller's HTTP request stayed open — a 200-atom first sync
 * held one request for minutes and Fly's proxy 502'd it, taking the half-done
 * pass with it. The work now goes through the same bounded pool the upsert path
 * uses, so the response is immediate and the rows survive a dropped request.
 * Counts are queue counts, not results; poll `expand_coverage` for progress.
 *
 * @param {{ mirrorListMissingExpand?: Function, mirrorSetExpand: Function }} store
 * @param {string} email
 * @param {{ limit?: number }} [opts]
 */
export async function backfillExpandForEmail(store, email, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  if (!config.askExpandEnabled) {
    return { ok: false, reason: "disabled", queued: 0, expanded: 0 };
  }
  if (typeof store.mirrorListMissingExpand !== "function") {
    return { ok: false, reason: "no_list", queued: 0, expanded: 0 };
  }
  const missing = await store.mirrorListMissingExpand(email, limit);
  let queued = 0;
  for (const row of missing || []) {
    const accepted = enqueueMirrorExpand(store, {
      email,
      path: row.path,
      title: row.title,
      tags: row.tags,
      body: row.body,
      contentHash: row.contentHash,
    });
    if (accepted) queued += 1;
  }
  // `expanded` stays for the response shape: nothing has finished yet, by design.
  return { ok: true, queued, expanded: 0, remaining_cap: limit };
}

/**
 * @param {{ expand?: string|null }[]} pubs
 * @returns {number} 0..1
 */
export function expandCoverageOf(pubs) {
  const list = pubs || [];
  if (!list.length) return 0;
  let n = 0;
  for (const p of list) {
    if (p?.expand && String(p.expand).trim()) n += 1;
  }
  return n / list.length;
}

/**
 * @param {number} coverage
 * @returns {'lexical'|'lexical_expanded'}
 */
export function retrievalModeForCoverage(coverage) {
  if (!config.askExpandEnabled) return "lexical";
  const floor = config.askExpandCoverageFloor;
  // KTD1: only claim paraphrase mode once enough rows actually carry expand.
  // A partly-backfilled index stays `lexical`, so the empty hint stays true.
  if (coverage > 0 && coverage >= floor) return "lexical_expanded";
  return "lexical";
}

export function getExpandStats() {
  return {
    ok: expandStats.ok,
    fail: { ...expandStats.fail },
  };
}
