/**
 * Index-time search expansion (Ask mirror) — questions/phrases for lexical recall.
 * Never log body, prompt, or expand text.
 */
import { config } from "../config.mjs";

const GENERIC_PHRASE_RE =
  /^(how to improve|what is success|key takeaways|summary of this|main points|important notes)\b/i;

/**
 * @param {string} title
 * @param {string[]} tags
 * @param {string} bodySlice
 */
export function buildExpandPrompt(title, tags, bodySlice) {
  const tagLine = (tags || []).filter(Boolean).slice(0, 12).join(", ");
  return `You help index a personal note for search. Given the note title, tags, and body excerpt, output 3 to 5 short search phrases or questions a user might ask that this note answers. Prefer concrete topical paraphrases, not generic fluff.

Rules:
- JSON array of strings only, no markdown
- Each phrase at most 120 characters
- Do not invent facts not supported by the note
- Do not include the exact title alone as a phrase

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
    const s = String(raw ?? "").trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) list = j.map((x) => String(x ?? "").trim());
      else list = s.split(/\n+/).map((l) => l.replace(/^[-*]\s*/, "").trim());
    } catch {
      list = s.split(/\n+/).map((l) => l.replace(/^[-*]\s*/, "").trim());
    }
  }

  const title = String(ctx.title || "").toLowerCase();
  const tags = (ctx.tags || []).map((t) => String(t).toLowerCase());
  const body = String(ctx.bodySlice || "").toLowerCase();
  const corpus = `${title} ${tags.join(" ")} ${body}`;

  const out = [];
  for (const p of list) {
    if (!p || p.length > 120) continue;
    if (GENERIC_PHRASE_RE.test(p)) continue;
    const words = p
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    if (words.length && !words.some((w) => corpus.includes(w))) continue;
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
        max_tokens: 300,
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
  } catch {
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
  if (!checkExpandRateLimit(job.email)) return;
  pool.queue.push(async () => {
    try {
      const result = await generateExpandPhrases({
        title: job.title,
        tags: job.tags,
        body: job.body,
      });
      if (!result.ok) return;
      const text = result.phrases.join("\n");
      await store.mirrorSetExpand(job.email, job.path, job.contentHash, text);
    } catch {
      /* counters only — no content logs */
    }
  });
  pumpExpandPool();
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
  if (coverage >= floor) return "lexical_expanded";
  return "lexical";
}
