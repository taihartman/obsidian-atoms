/**
 * Shared shortlist machinery for the link-quality experiment.
 *
 * Used by both scripts/measure-shortlist-recall.mjs (free — does the target reach the
 * shortlist?) and scripts/measure-link-quality.mjs (paid — does the model then link it?),
 * so the two halves can never drift apart on what a selector actually does.
 *
 * Design: see docs/plans/2026-07-28-004-research-shortlist-quality-experiment.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FIXTURES = path.join(REPO_ROOT, "scripts/fixtures");

export function loadProbes() {
  return fs
    .readdirSync(FIXTURES)
    .filter((f) => /^link-probes-.*\.json$/.test(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8")).probes ?? []);
}

export function loadRealTitles() {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "vault-title-corpus.json"), "utf8"),
  ).allTitles;
}

/** Deterministic pseudo-random in [0,1) from a string — keeps runs reproducible. */
export function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Build one probe's vault: its target, its supporting notes, every other probe's titles as
 * same-style distractors, then the real corpus cycled up to size.
 *
 * Other probes' titles are the good distractors — same shape and register as the target, so a
 * selector cannot win by preferring "note-shaped" strings. Every note gets a capture-style body,
 * not just the target, or a body-scoring selector would win trivially by being the only thing
 * with text to match against.
 */
export function buildVault(probe, size, probes, realTitles) {
  const seen = new Set();
  const notes = [];
  const bodyPool = probes
    .filter((p) => p.id !== probe.id && p.targetBody)
    .map((p) => p.targetBody);
  const filler = (title, i) =>
    bodyPool.length ? bodyPool[Math.floor(hash01(title + i) * bodyPool.length)] : "";

  const add = (title, ageDays, body) => {
    if (!title || seen.has(title)) return;
    seen.add(title);
    notes.push({ title, ageDays, body: body ?? filler(title, notes.length) });
  };

  if (probe.targetTitle) add(probe.targetTitle, probe.targetAgeDays ?? 30, probe.targetBody ?? "");
  for (const t of probe.supportingTitles ?? []) add(t, Math.round(hash01(t) * 900) + 1);
  for (const other of probes) {
    if (other.id === probe.id) continue;
    add(other.targetTitle, Math.round(hash01(other.id + "t") * 900) + 1, other.targetBody);
    for (const t of other.supportingTitles ?? []) add(t, Math.round(hash01(t) * 900) + 1);
  }
  for (let i = 0; notes.length < size; i++) {
    const base = realTitles[i % realTitles.length];
    add(
      `${base}${i >= realTitles.length ? ` ${Math.floor(i / realTitles.length) + 1}` : ""}`,
      Math.round(hash01(base + i) * 1100) + 1,
    );
  }
  return notes.slice(0, Math.max(size, 1));
}

const STOP = new Set(
  ("a an the and or but if then than that this these those is are was were be been being am " +
   "i me my mine you your we our us they them their it its of in on at to for from with without " +
   "about into over under again more most some any no not just so very can could should would " +
   "will shall do does did done get got getting have has had having when while as by up down out " +
   "off after before during too also still even much many").split(" "),
);

export function tokens(s) {
  return (s.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    // Crude stemming: enough to join "runs"/"running"/"run" without a stemmer dependency.
    .map((w) => w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? "" : m)))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** A title that looks like a person hub: one to three capitalised words, no lowercase glue. */
export function isPersonHub(title) {
  const w = title.trim().split(/\s+/);
  return w.length <= 3 && w.every((x) => /^[A-Z][a-zà-ÿA-Z'’-]*$/.test(x));
}

/**
 * BM25 — the shortlist stage `context.ts` already contemplates.
 *
 * `field` picks what each note is scored on. Titles are the model's polished declarative claim;
 * bodies are the user's own verbatim capture. Matching a user's words against their own past
 * words is a different, and much easier, problem than matching them against a paraphrase.
 * Either way only the *title* is ever sent in the prompt, so the cost model is unaffected.
 */
export function bm25Rank(capture, notes, field = "title") {
  const q = tokens(capture);
  const docs = notes.map((n) =>
    tokens(field === "title" ? n.title : field === "body" ? n.body ?? "" : `${n.title} ${n.body ?? ""}`),
  );
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.2, b = 0.75;
  return notes
    .map((n, i) => {
      let score = 0;
      const d = docs[i];
      for (const t of new Set(q)) {
        const f = d.filter((x) => x === t).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl)));
      }
      return { ...n, score };
    })
    .sort((a, b2) => b2.score - a.score || a.title.localeCompare(b2.title));
}

function quotaTake(capture, notes, k, field, hubQ, kwQ, recQ) {
  const out = [];
  const taken = new Set();
  const take = (list, n) => {
    for (const item of list) {
      if (out.length >= k || n <= 0) break;
      if (taken.has(item.title)) continue;
      taken.add(item.title);
      out.push(item);
      n--;
    }
  };
  take(notes.filter((n) => isPersonHub(n.title)), Math.ceil(k * hubQ));
  take(bm25Rank(capture, notes, field), Math.ceil(k * kwQ));
  take([...notes].sort((a, b) => a.ageDays - b.ageDays), Math.ceil(k * recQ));
  take(bm25Rank(capture, notes, field), k); // top up with keyword if a quota underfilled
  return out.slice(0, k);
}

export const SELECTORS = {
  /** The behaviour plus-service ships today: alphabetical, first k. The control to beat. */
  alphabetical: (capture, notes, k) =>
    [...notes].sort((a, b) => a.title.localeCompare(b.title)).slice(0, k),

  /** Cheapest plausible selector, and the one the owner's year-ago case is aimed at. */
  recency: (capture, notes, k) => [...notes].sort((a, b) => a.ageDays - b.ageDays).slice(0, k),

  keyword: (capture, notes, k) => bm25Rank(capture, notes, "title").slice(0, k),

  /** Score the user's words against their own past words; still send only titles. */
  bodyKeyword: (capture, notes, k) => bm25Rank(capture, notes, "body").slice(0, k),

  bodyPlusTitle: (capture, notes, k) => bm25Rank(capture, notes, "both").slice(0, k),

  personFirst: (capture, notes, k) => {
    const hubs = notes.filter((n) => isPersonHub(n.title));
    const rest = bm25Rank(capture, notes.filter((n) => !isPersonHub(n.title)), "title");
    return [...hubs.slice(0, Math.floor(k / 4)), ...rest].slice(0, k);
  },

  hybrid: (capture, notes, k) => quotaTake(capture, notes, k, "title", 0.1, 0.65, 0.25),

  /** Body-scored, with person hubs protected and a recency quota for what is top of mind. */
  hybridBody: (capture, notes, k) => quotaTake(capture, notes, k, "both", 0.1, 0.7, 0.2),

  /** Uncapped — the ceiling, and what BYOK backfill does today. */
  full: (capture, notes) => notes,
};
