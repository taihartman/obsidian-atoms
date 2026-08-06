/**
 * Index-time search expansion (Ask mirror) — questions/phrases for lexical recall.
 * Never log body, prompt, or expand text.
 */
import { config } from "../config.mjs";

const GENERIC_PHRASE_RE =
  /^(how to improve|what is success|key takeaways|summary of this|main points|important notes|overview of the note|general thoughts)\b/i;

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
        max_tokens: 400,
        temperature: 0,
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
  const key = String(email || "").toLowerCase();
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
 * Fire-and-forget expand after mirror write.
 * @param {{ mirrorSetExpand: Function }} store
 * @param {{ email: string, path: string, title: string, tags: string[], body: string, contentHash: string }} job
 */
export function enqueueMirrorExpand(store, job) {
  if (!config.askExpandEnabled) return;
  if (!checkExpandRateLimit(job.email)) {
    bumpFail("rate_limit");
    return;
  }
  pool.queue.push(async () => {
    try {
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
    }
  });
  pumpExpandPool();
}

/**
 * Expand missing rows for one account (sync backfill). Returns counts only.
 * @param {{ mirrorListMissingExpand?: Function, mirrorSetExpand: Function }} store
 * @param {string} email
 * @param {{ limit?: number }} [opts]
 */
export async function backfillExpandForEmail(store, email, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  if (!config.askExpandEnabled) {
    return { ok: false, reason: "disabled", attempted: 0, expanded: 0 };
  }
  if (typeof store.mirrorListMissingExpand !== "function") {
    return { ok: false, reason: "no_list", attempted: 0, expanded: 0 };
  }
  const missing = await store.mirrorListMissingExpand(email, limit);
  let expanded = 0;
  let attempted = 0;
  for (const row of missing || []) {
    if (!checkExpandRateLimit(email)) break;
    attempted += 1;
    const result = await generateExpandPhrases({
      title: row.title,
      tags: row.tags,
      body: row.body,
    });
    if (!result.ok) {
      bumpFail(result.reason);
      continue;
    }
    const set = await store.mirrorSetExpand(
      email,
      row.path,
      row.contentHash,
      result.phrases.join("\n"),
    );
    if (set?.updated) {
      expanded += 1;
      expandStats.ok += 1;
    } else {
      bumpFail("set_noop");
    }
  }
  return { ok: true, attempted, expanded, remaining_cap: limit };
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
  // Any nonzero coverage means expand is live and scoring; floor defaults low.
  if (coverage > 0 && coverage >= floor) return "lexical_expanded";
  return "lexical";
}

export function getExpandStats() {
  return {
    ok: expandStats.ok,
    fail: { ...expandStats.fail },
  };
}
