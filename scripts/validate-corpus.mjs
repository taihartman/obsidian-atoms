#!/usr/bin/env node
// Acceptance gate for a life-story corpus, per scripts/fixtures/README-chrono-corpus-schema.md.
//
// Run this BEFORE spending anything on a corpus. It checks the schema, the register (§2), the
// reach-back distribution (§3) and the failure-mode quotas (§4) — including the zero-shared-term
// rate, which is the headline number. A corpus that passes the schema but reads like tidy prose is
// rejected and re-briefed, not patched.
//
//   node scripts/validate-corpus.mjs scripts/fixtures/chrono-corpus-*.json
//
// Exits non-zero if any FAIL fires. WARNs are advisory: they flag things a script can only
// approximate (deixis, near-duplicates), and a human should spot-read a sample regardless.

import fs from 'node:fs';
import path from 'node:path';
import { tokens } from './lib/shortlist.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/validate-corpus.mjs <corpus.json> [...]');
  process.exit(2);
}

const results = [];
const record = (level, label, detail) => results.push({ level, label, detail });
const check = (ok, label, detail) => record(ok ? 'PASS' : 'FAIL', label, detail);
const advise = (ok, label, detail) => record(ok ? 'PASS' : 'WARN', label, detail);

const pct = (n, d) => (d === 0 ? 0 : (n / d) * 100);
const fmt = (n) => `${n.toFixed(1)}%`;
const median = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---------------------------------------------------------------- load + schema

const VERDICTS = new Set(['atom', 'noise']);
const BANNED_PREFIX = /^\s*(remember|note|thought|til)\s*:/i;

/** Captures across all files, plus per-file id maps (links never cross files — see brief §6). */
const all = [];
const perFile = [];

for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    check(false, `parse ${path.basename(file)}`, err.message);
    continue;
  }
  const caps = Array.isArray(raw) ? raw : raw.captures;
  if (!Array.isArray(caps)) {
    check(false, `shape ${path.basename(file)}`, 'expected an array of captures');
    continue;
  }

  const problems = [];
  const byId = new Map();
  let lastDate = '';
  let lastId = '';

  caps.forEach((c, i) => {
    const at = `${path.basename(file)}[${i}] ${c?.id ?? '?'}`;
    if (!c || typeof c !== 'object') return problems.push(`${at}: not an object`);
    if (!/^[A-Z]\d{4}$/.test(c.id ?? '')) problems.push(`${at}: bad id`);
    if (byId.has(c.id)) problems.push(`${at}: duplicate id`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '')) problems.push(`${at}: bad date`);
    if (c.date < '2023-01-01' || c.date > '2025-12-31') problems.push(`${at}: date out of range`);
    if (c.date < lastDate) problems.push(`${at}: date out of order (after ${lastDate})`);
    if (c.id <= lastId) problems.push(`${at}: id not ascending (after ${lastId})`);
    if (typeof c.thread !== 'string' || !c.thread) problems.push(`${at}: missing thread`);
    if (typeof c.capture !== 'string' || !c.capture.trim()) problems.push(`${at}: empty capture`);
    if (BANNED_PREFIX.test(c.capture ?? '')) problems.push(`${at}: banned prefix`);
    if (!VERDICTS.has(c.verdict)) problems.push(`${at}: bad verdict`);
    if (!Array.isArray(c.linksToEarlier)) problems.push(`${at}: linksToEarlier not an array`);
    if (!Array.isArray(c.linksToExisting)) problems.push(`${at}: linksToExisting not an array`);
    if (c.verdict === 'noise' && (c.linksToEarlier?.length || c.linksToExisting?.length)) {
      problems.push(`${at}: noise must link to nothing`);
    }
    byId.set(c.id, c);
    lastDate = c.date;
    lastId = c.id;
    all.push(c);
  });

  // linksToEarlier must resolve, within this file, to a strictly earlier capture.
  for (const c of caps) {
    for (const id of c.linksToEarlier ?? []) {
      const target = byId.get(id);
      if (!target) problems.push(`${c.id}: link to ${id} not in this file`);
      else if (target.date > c.date) problems.push(`${c.id}: link to ${id} is later`);
      else if (target.id === c.id) problems.push(`${c.id}: links to itself`);
    }
  }

  check(problems.length === 0, `schema ${path.basename(file)} (${caps.length} captures)`,
    problems.length ? `${problems.length} problems, first 5:\n    ` + problems.slice(0, 5).join('\n    ') : 'clean');
  perFile.push({ file, caps, byId });
}

if (all.length === 0) {
  console.error('no captures loaded');
  process.exit(2);
}

// ---------------------------------------------------------------- §2 register

const lens = all.map((c) => c.capture.length);
const m = mean(lens);
const med = median(lens);
const over200 = lens.filter((x) => x > 200).length;
const over260 = lens.filter((x) => x > 260).length;
const under50 = lens.filter((x) => x < 50).length;
const noise = all.filter((c) => c.verdict === 'noise').length;

check(m >= 95 && m <= 125, 'mean capture length in 95–125', `${m.toFixed(1)} chars`);
check(med >= 85 && med <= 120, 'median capture length in 85–120', `${med} chars`);
check(pct(over200, all.length) <= 3, 'at most 3% over 200 chars', `${over200}/${all.length} = ${fmt(pct(over200, all.length))}`);
check(over260 === 0, 'nothing over 260 chars', over260 ? `${over260} captures` : 'none');
check(pct(under50, all.length) >= 15, 'at least 15% under 50 chars (§4E)', `${under50}/${all.length} = ${fmt(pct(under50, all.length))}`);
check(pct(noise, all.length) >= 18 && pct(noise, all.length) <= 22, 'noise share 18–22%', fmt(pct(noise, all.length)));

// Exact duplicates are always a generation artefact, never a life.
const seenText = new Map();
for (const c of all) seenText.set(c.capture, (seenText.get(c.capture) ?? 0) + 1);
const dupText = [...seenText.entries()].filter(([, n]) => n > 1);
check(dupText.length === 0, 'no exact duplicate captures',
  dupText.length ? `${dupText.length} repeated, e.g. "${dupText[0][0].slice(0, 50)}" ×${dupText[0][1]}` : 'none');

// Filler tails. A model told to hit a mean length pads short captures with a stock closing phrase
// ("...and that is the whole mess i guess"). That is not just ugly: it puts the same tokens in
// every capture, which inflates BM25 similarity between unrelated notes and skews the pool's
// average document length — the exact artefact that already invalidated one round of measurements.
// Padding does not use ONE stock phrase, it uses a dozen — so checking the single worst offender
// misses it. Two metrics separate a padded corpus from an honest one cleanly (measured: 32.7% vs
// 0.0%, and 28.7% vs 0.6%).
const tails = new Map();
for (const c of all) {
  const t = tokens(c.capture);
  if (t.length < 8) continue;
  const key = t.slice(-4).join(' ');
  tails.set(key, (tails.get(key) ?? 0) + 1);
}
const recurring = [...tails.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
const recurCount = recurring.reduce((s, [, n]) => s + n, 0);
check(pct(recurCount, all.length) <= 5, 'captures sharing a recurring closing phrase at most 5%',
  `${recurCount}/${all.length} = ${fmt(pct(recurCount, all.length))}` +
  (recurring.length ? ` — worst: ${recurring.slice(0, 3).map(([k, n]) => `"${k}" ×${n}`).join(', ')}` : ''));

// A capture whose last six tokens are all corpus-common words ends in filler, not content. This is
// what padding a short thought up to a target length actually looks like.
const df = new Map();
for (const c of all) for (const t of new Set(tokens(c.capture))) df.set(t, (df.get(t) ?? 0) + 1);
const isGeneric = (t) => (df.get(t) ?? 0) / all.length > 0.02;
let deadTail = 0, longEnough = 0;
for (const c of all) {
  const t = tokens(c.capture);
  if (t.length < 10) continue;
  longEnough++;
  if (t.slice(-6).every(isGeneric)) deadTail++;
}
check(pct(deadTail, Math.max(longEnough, 1)) <= 5, 'captures ending in six generic tokens at most 5%',
  `${deadTail}/${longEnough} = ${fmt(pct(deadTail, Math.max(longEnough, 1)))} — padding to hit a length target`);

// Register tells: the shapes a model produces when it writes *about* messiness (§2).
const tells = [
  [/—/, 'em dash'],
  [/;/, 'semicolon'],
  [/\b(just wanted to|i realized that|realized that|it occurred to me|interesting thought)\b/i, 'self-narration'],
];
for (const [re, name] of tells) {
  const hits = all.filter((c) => re.test(c.capture));
  check(pct(hits.length, all.length) < 2, `register tell: ${name} under 2%`,
    `${hits.length} hits` + (hits.length ? ` e.g. "${hits[0].capture.slice(0, 60)}"` : ''));
}
// A capture that starts capitalised AND ends in a full stop is a tidy sentence, not a thumbed note.
const tidy = all.filter((c) => /^[A-Z]/.test(c.capture) && /[.!?]$/.test(c.capture.trim()));
check(pct(tidy.length, all.length) < 10, 'tidy capitalised sentences under 10%',
  `${tidy.length}/${all.length} = ${fmt(pct(tidy.length, all.length))}`);

// ---------------------------------------------------------------- pairs

/** Every declared (capture, earlier partner) pair, resolved within its own file. */
const pairs = [];
for (const { caps, byId } of perFile) {
  for (const c of caps) {
    for (const id of c.linksToEarlier ?? []) {
      const e = byId.get(id);
      if (e) pairs.push([c, e]);
    }
  }
}
check(pairs.length > 0, 'corpus declares links', `${pairs.length} pairs`);

// §3 reach-back distribution
const days = pairs.map(([c, e]) => (new Date(c.date) - new Date(e.date)) / 86400000);
const bucket = (lo, hi) => pct(days.filter((d) => d >= lo && d < hi).length, days.length);
const spanMed = median(days);
check(spanMed >= 60 && spanMed <= 160, 'median link span 60–160 days', `${spanMed} days`);
check(bucket(180, 550) >= 20, 'at least 20% of links span 6–18 months', fmt(bucket(180, 550)));
check(bucket(550, Infinity) >= 5, 'at least 5% of links span over 18 months', fmt(bucket(550, Infinity)));
check(bucket(0, 30) <= 35, 'at most 35% of links are under 30 days', fmt(bucket(0, 30)));

// §4A zero-shared-term rate — the headline number.
const termSet = (c) => new Set(tokens(c.capture));
const shares = ([c, e]) => {
  const b = termSet(e);
  return [...termSet(c)].some((t) => b.has(t));
};
// Banded, not floored. Too low and the corpus proves nothing keyword search cannot already do;
// too high and it is adversarially harder than any real vault, so recall measured on it is a
// pessimistic fiction. The real vault's own rate is far lower, but n=30 there settles nothing.
const zeroOverlap = pairs.filter((p) => !shares(p)).length;
const zeroPct = pct(zeroOverlap, pairs.length);
check(zeroPct >= 20 && zeroPct <= 35, 'zero-shared-term pairs 20–35% (§4A)',
  `${zeroOverlap}/${pairs.length} = ${fmt(zeroPct)} — baseline 23.4%`);

// §4F hub-mediated vs orphan split. A pair is hub-mediated when both ends name the same hub.
const hubShared = pairs.filter(([c, e]) => {
  const b = new Set(e.linksToExisting ?? []);
  return (c.linksToExisting ?? []).some((t) => b.has(t));
}).length;
const hubPct = pct(hubShared, pairs.length);
check(hubPct >= 35 && hubPct <= 65, 'hub-mediated pairs 35–65% (§4F)', fmt(hubPct));

// §4D contradiction / revision — approximated by revision vocabulary on the later end.
const REVISION = /\b(wrong|actually|turns out|not (?:the|it)|nope|changed my mind|opposite|disagree|take that back|maybe not|scratch that|no longer)\b/i;
const revisions = pairs.filter(([c]) => REVISION.test(c.capture)).length;
advise(pct(revisions, pairs.length) >= 10, 'revision/contradiction pairs at least 10% (§4D)',
  `${revisions}/${pairs.length} = ${fmt(pct(revisions, pairs.length))} — keyword approximation, spot-read`);

// §4B deixis-only — the capture *opens* on a pronoun/demonstrative, stays short, and names nobody.
// Anything looser matches every capture containing "it", which measures nothing.
const DEIXIS_OPEN = /^\s*(she|he|they|it|this|that|them|him|her|same|again|those|these)\b/i;
const deictic = pairs.filter(([c]) =>
  DEIXIS_OPEN.test(c.capture) && tokens(c.capture).length <= 8 && !/[A-Z][a-z]{2,}/.test(c.capture)).length;
advise(pct(deictic, pairs.length) >= 8, 'deixis-only pairs at least 8% (§4B)',
  `${deictic}/${pairs.length} = ${fmt(pct(deictic, pairs.length))} — approximation, spot-read`);

// §4E short captures must carry links — but not ALL of them. A corpus where every short capture is
// meaningful is as unrealistic as one where none are, and it is what maxing this gate looks like.
const shortLinked = all.filter((c) => c.capture.length < 50 && (c.linksToEarlier ?? []).length > 0).length;
const shortPct = pct(shortLinked, Math.max(under50, 1));
check(shortPct >= 40 && shortPct <= 75, 'short captures carrying a link 40–75% (§4E)',
  `${shortLinked}/${under50} = ${fmt(shortPct)}`);

// §4H near-duplicate unlinked pairs — high Jaccard, no declared link. Precision test material.
const linkedKey = new Set(pairs.map(([c, e]) => `${e.id}>${c.id}`));
const vecs = all.map((c) => ({ c, t: termSet(c) }));
let nearDupes = 0;
let qualityDupes = 0; // cross-thread AND far apart — the only kind that tests precision
for (let i = 0; i < vecs.length; i++) {
  for (let j = i + 1; j < vecs.length; j++) {
    const a = vecs[i], b = vecs[j];
    if (a.t.size < 3 || b.t.size < 3) continue;
    let inter = 0;
    for (const t of a.t) if (b.t.has(t)) inter++;
    const jac = inter / (a.t.size + b.t.size - inter);
    if (jac < 0.6) continue;
    if (linkedKey.has(`${a.c.id}>${b.c.id}`) || linkedKey.has(`${b.c.id}>${a.c.id}`)) continue;
    nearDupes++;
    const apart = Math.abs(new Date(a.c.date) - new Date(b.c.date)) / 86400000;
    if (a.c.thread !== b.c.thread && apart >= 90) qualityDupes++;
  }
}
check(pct(qualityDupes, all.length) >= 4, 'near-duplicate pairs that are cross-thread and 90+ days apart (§4H)',
  `${qualityDupes} of ${nearDupes} near-dupes qualify = ${fmt(pct(qualityDupes, all.length))} of captures` +
  (nearDupes > qualityDupes ? ` — ${nearDupes - qualityDupes} are same-thread or adjacent, which is repetition, not a precision test` : ''));

// §3 threads and interleaving
const threads = new Set(all.map((c) => c.thread));
check(threads.size >= 20, 'at least 20 threads', `${threads.size}`);
let sameThreadRun = 0;
for (let i = 1; i < all.length; i++) if (all[i].thread === all[i - 1].thread) sameThreadRun++;
advise(pct(sameThreadRun, all.length) <= 35, 'consecutive same-thread captures at most 35% (§3)',
  fmt(pct(sameThreadRun, all.length)));

// A run of 3+ consecutive captures from one thread means the day was written thread-by-thread
// rather than lived. Real days jump between strands.
let runs3 = 0, run = 1;
for (let i = 1; i < all.length; i++) {
  if (all[i].thread === all[i - 1].thread) run++;
  else { if (run >= 3) runs3 += run; run = 1; }
}
if (run >= 3) runs3 += run;
check(pct(runs3, all.length) <= 8, 'captures inside a 3+ same-thread run at most 8% (§3)',
  `${runs3}/${all.length} = ${fmt(pct(runs3, all.length))}`);

// ---------------------------------------------------------------- report

const width = Math.max(...results.map((r) => r.label.length));
for (const r of results) {
  console.log(`${r.level.padEnd(4)} ${r.label.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => r.level === 'FAIL').length;
const warned = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${all.length} captures · ${pairs.length} pairs · ${failed} FAIL · ${warned} WARN`);
if (failed) console.log('\nReject and re-brief. Do not patch a corpus that fails the register or quota gates.');
process.exit(failed ? 1 : 0);
