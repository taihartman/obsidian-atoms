# ce-code-review — PR #340 `feat/339-ask-search-recall-honesty`

Scope: full branch vs `master` (base `aed6e348`), 32 files, local-aligned. Mode: report-only (no fixes applied).
Run artifacts: `/tmp/compound-engineering-502/ce-code-review/20260807-132859-d95248de/`

Reviewers: correctness, security (session model); testing, reliability, data-migration, performance,
agent-native, project-standards, learnings, previous-comments (mid-tier). Adversarial lens: **degraded** —
see Coverage.

---

## Triage Groups

| Group | Findings | Context | Preferred resolution | Type |
|---|---|---|---|---|
| Consent chain has no server half | #1 | The whole premise of flipping the flag on is that the ack bump re-prompts users first. It re-prompts *new* clients only. | Decide the shape (stamp ack version on upsert + pin it server-side, or hold the default off until the release propagates). Nothing below matters if this is unresolved. | **Decision gate** |
| Expand backfill is entirely non-functional | #6, #8 | The route is unreachable AND the ops script is a stub. Together there is no working way to expand rows that missed the upsert window. | Fix #8 first (one allowlist line); then #6 becomes a labelling question, not a capability gap. | Apply queue |
| Egress keeps running after the user says stop | #5 | Wipe deletes the rows but the queued closure still holds the plaintext body and still calls Anthropic. | Cancel by email inside the job, not just at enqueue. | Apply queue |
| Guards that cannot fail | #2, #4, #7 | Three separate places where a protection exists on paper but not in practice: a file grep cannot see, an assertion that is always true, a required grounding check that was never written. | Mechanical; do #2 first since it is what hid the rest from review. | Apply queue |

---

## P0 — Critical

### #1 — Body-plaintext egress is gated only on the client; the server never sees the ack version
`plus-service/src/mirror/http.mjs:408` · confidence 100 · **2 independent reviewers** (security, correctness) · validated · owner: **human — design call**

**What.** The upsert route enqueues expansion for every row it receives. There is no consent, ack-version, or
client-version condition anywhere on that path.

```
if (typeof store.mirrorSetExpand === "function" && needExpand.length) {
  const cap = config.askExpandPerUpsertCap;
  for (let n = 0; n < needExpand.length && n < cap; n += 1) { enqueueMirrorExpand(store, needExpand[n]); }
}
```

**Why it matters.** This is the load-bearing assumption behind turning the flag on. The version bump re-prompts
a device *that has the new constant compiled into it*. A device still on <= 0.6.86 holds `"2026-08-06"`, compares it
against its own build's constant, reads as current, and keeps mirroring — and the server expands its bodies under
wording that never mentioned body egress. The validator also confirmed it is **retroactive**: all three backends push
a body-bearing `needExpand` entry on the hash-unchanged branch when `expand_enc` is null
(`askSqliteMethods.mjs:146-156`, `askPostgresMethods.mjs:133-143`, `memory.mjs:465-476`), so rows already sitting in
the store get expanded on the next sync from a stale client.

With `ASK_EXPAND_ENABLED="0"` this was harmless. Flipping the default is what makes it reachable.

**Response — pick one:**

1. **Stamp and pin.** Plugin sends `askAckVersion` on upsert; `plus-service` pins the minimum version whose
   disclosure names the egress and skips `enqueueMirrorExpand` when the header is absent or older. Stale clients keep
   pure lexical search — exactly what they consented to — and self-heal on upgrade. Apply the same check to the
   backfill route, or persist a per-account `ask_expand_ack` column so a stale session cannot bypass it.
2. **Hold the flag.** Keep `ASK_EXPAND_ENABLED` off in the deployed config until the 0.6.87 plugin release has
   propagated, and land the default flip as its own change. Cheapest, and it is a release decision rather than a code one.

Note the sub-claim about the backfill route being ungated is currently moot — that route is dead (#8).

---

## P1 — High

### #2 — `expandSearch.mjs` contains literal NUL bytes, so git treats the whole file as binary
`plus-service/src/ask/expandSearch.mjs:202` · confidence 100 · correctness · validated

The dedup key embeds raw `0x00` separators. `git diff --numstat` reports `-  -`, `file` reports `data`. Observed live
during validation: `grep -n 'inFlight' plus-service/src/ask/expandSearch.mjs` returns **nothing**, because grep skips
binary files. The single most security-relevant file on this branch is invisible to diff review and to routine search.
That is very likely why several findings below survived an earlier review round.

Fix: `return \`${job.email}\\u0000${job.path}\\u0000${job.contentHash}\`;` — identical runtime key, plain text on disk.
Verify with `git diff --stat` showing line counts instead of `Bin`. Consider `*.mjs text` in `.gitattributes`.

### #5 — Wipe deletes the rows but does not drain the queue, so bodies still egress after the user wipes
`plus-service/src/mirror/http.mjs:125` · confidence 75 · security · validated

The wipe route awaits `store.mirrorWipe(a.email)` and returns. The queued job closes over `job` and calls
`generateExpandPhrases({ title, tags, body: job.body })` **directly** — the validator confirmed the plaintext body
lives in the closure and is never re-read from the store, so deleting the row does not starve it. Nothing cancels or
drains the pool. A user who wipes still has their note bodies sent to Anthropic afterwards.

Fix: an email-keyed cancellation set checked *inside* the job (not only at enqueue), called from the wipe route before
`store.mirrorWipe`. Timestamp it so a later re-sync is not permanently blocked.

### #8 — The expand-backfill route is dead: it is not in the allowlist and 404s
`plus-service/src/mirror/http.mjs:132` · **upgraded from P2 by the validator** · testing → correctness

Reported as "no test coverage"; the validator found the reason. `isAsk` at `http.mjs:45-54` omits
`/v1/ask/mirror/expand-backfill`, so `handleMirrorRoutes` returns false before ever reaching the handler
(verified by invoking it: `handled=false`). The client caller at `src/platform/plusClient.ts:806-819` can only ever
get a 404.

This removes a mitigation another reviewer was counting on: `askCoordinator.ts` fires that backfill after every
successful Sync, so "rows that missed the upsert window self-heal" is **not true today**. Combined with #6, there is
currently no working backfill path at all.

Fix: add the path to the `isAsk` allowlist, then add the route test that would have caught it.

---

## P2 — Moderate

### #3 — `askExpandModel` defaults to Sonnet, not the Haiku-class tier KTD5 pinned
`plus-service/src/config.mjs:100` · downgraded from P1 by the validator · previous-comments + correctness

Plan KTD5 (`docs/plans/2026-08-06-004-...-plan.md:176`) says "temperature 0, Haiku-class model via config
`ASK_EXPAND_MODEL`". The getter falls back to `env("ATOMS_PLUS_MODEL", "claude-sonnet-4-5-20250929")`. The validator
judged the "contradicts its own comment" framing half fair — "avoid hard-coded Haiku ids" *is* honored — but the
comment's other promise, "prefer Plus classify model", is broken in the unset case: `anthropicModel` defaults the same
env to `claude-sonnet-5`, so classify and expand silently diverge on two different dated ids.

Cost and config drift rather than a correctness bug — but it is now the default for every deployment, and one of the
ids is dated.

Fix: `get askExpandModel() { return env("ASK_EXPAND_MODEL", "") || config.anthropicModel; }`.

### #4 — The anti-leak assertion is vacuous and can never fail
`plus-service/test/ask-search-expand.test.mjs:122` · downgraded from P1 by the validator (test-only, no user impact)

`assert.ok(!(JSON.stringify(hits[0]).includes("how to stop") && hits[0].expand))`. The validator confirmed
`buildSearchHits` (`askHelpers.mjs:1037-1085`) enumerates its fields explicitly and never sets `.expand`, so the right
conjunct is always `undefined` and the assertion passes unconditionally. R19 ("expand text never on MCP payloads")
currently holds — verified independently by three reviewers reading `buildSearchHits` and `shapeFetchAtom` — but it is
guarded by a test that cannot fail.

Fix: split into two assertions that can each fail — no raw text anywhere in the payload, and `hits[0].expand` is
`undefined`.

### #7 — The KTD6 / AE10 anti-hallucination grounding guard was never written
`plus-service/src/ask/expandSearch.mjs:86` · confidence 75 · previous-comments · validated

KTD6 requires dropping phrases "with no token overlap of length >= 4 with title ∪ tags ∪ bodySlice (anti-generic)".
The filter loop checks length, a generic-phrase regex, exact title match, and dedupe. The validator confirmed
`ctx.tags` and `ctx.bodySlice` are accepted in the signature, passed by `generateExpandPhrases`, and **never read** —
so an ungrounded model phrase can enter the search index and surface a note that has nothing to do with the query.
No AE10 fixture exists anywhere under `plus-service/test/`, though the plan marks it mandatory in its DoD.

### #9 — `search_atoms` now runs a second full-account scan on every call
`plus-service/src/store/askPostgresMethods.mjs:196` · confidence 75 · performance · not independently validated

`mirrorSearch` already does `SELECT * FROM atom_mirror WHERE email = $1` and decrypts every row. This PR adds
`mirrorExpandCoverage`, which independently re-scans the same account sequentially after it, on every call including
non-empty ones, purely to compute a count that is a strict subset of data already in memory. On SQLite the second scan
is synchronous and blocks the event loop again back-to-back.

Fix: derive coverage from the rows `mirrorSearch` already fetched; keep the standalone export only for the backfill route.

---

## P3 — Low

### #6 — The ops backfill script is a self-declared stub
`plus-service/scripts/backfill-ask-expand.mjs:25` · **validator refuted the stated consequence**, downgraded P2 → P3

Three reviewers reported it prints `ok:true` while doing nothing. The validator refuted that: `src/store/index.mjs`
genuinely does not exist, but with `createStore` null the script takes the else branch at :33-37, prints
"No createStore; memory only — nothing to backfill." and `process.exit(1)`. An operator gets an honest failure, not a
false success. What remains is a stub shipped in `scripts/` — housekeeping. Real impact lives in #8.

### #10 — A keyless deployment still spends the expand budget and logs per row
`plus-service/src/ask/expandSearch.mjs:215` · correctness

`enqueueMirrorExpand` checks `askExpandEnabled`, the in-flight set, and the rate limit, but the `anthropicApiKey`
guard is at :104 *inside* the queued job. A deployment with no key burns its rate-limit budget and emits a
`console.info` per row. Hoist `if (!config.anthropicApiKey) return false;` next to the other cheap guards; keep the
inner guard as the defence-in-depth the F3 test pins.

---

## Pre-existing (does not count toward the verdict)

- **P2** `plus-service/src/store/askHelpers.mjs:1096` — the relative floor compares mediums to the top *medium*, not
  the top over all candidates, which KTD3 specifies.
- **P2** `plus-service/test/ask-search-expand.test.mjs:75` — expand store methods run on the memory store only; sqlite
  and postgres have no coverage for `mirrorSetExpand` / `mirrorExpandCoverage` / `mirrorListMissingExpand`.

---

## Learnings & past solutions

`learnings-researcher` found the diff already honors the corpus, in several cases because its author wrote the docs:

- `solutions/security/a-versioned-consent-needs-both-halves-in-the-gate.md` — **honored.**
  `askPrivacyAckIsCurrent` checks both a real timestamp and version equality, and `settleAckRecords` clears the
  dependent write ack when the parent goes stale. Worth confirming `settleAckRecords` runs at *every* settings-load
  boundary — that doc's lesson 1 is "enforced at one call site is enforced nowhere."
- `solutions/best-practices/a-golden-value-in-the-same-file-is-defended-only-by-a-comment.md` — **honored and cited
  verbatim** in `askConsentVersion.test.ts:188-190`, including its residual limit.
- `solutions/logic-errors/security-fix-repair-wired-into-only-one-branch.md` — **honored.** The new expand surface is
  implemented identically across all three backends and the single enqueue call site is the production path.
- Open question raised: is `askExpandCoverageFloor = 0.8` the intended *production* default, or a dogfood number?
  At 0.8, `retrieval` reads `lexical` for a long time on any account that is not fully backfilled.

## Agent-native

`searched_fields` is still `["title","tags","body"]` (`askHelpers.mjs:935`) while a hit in the same payload can carry
`match_signals: ["expand"]` and `retrieval: "lexical_expanded"`. The payload disagrees with itself, and
`searched_fields` is part of the documented absence contract an agent reads to decide what was searched.
Fix: include `"expand"`, or pass a dynamic `searched_fields` from the handler.

Working well: `retrieval` is coverage-gated rather than existence-gated (KTD1), expand text never reaches an MCP
payload (verified independently by four reviewers), and `expand_enc` is a column on `atom_mirror` rather than a side
table — so wipe removes it structurally and the shipped consent text holds at the persistence layer.

---

## Coverage

- **Cross-model adversarial pass: degraded.** Route `grok-cli`, `model_requested: grok-4.5`,
  `effort_requested: high`, `receipt_supported: false`, `model_actual: unverified`, `effort_actual: unverified`,
  `independence_verified: false`. The peer ran 540s+ against its 600s hard-only bound and produced no schema-shaped
  output — `--json-schema` buffers, so a run that dies before the final step yields literally nothing. The in-process
  adversarial fallback was correctly removed at the routing boundary when the peer started, so **the adversarial lens
  did not run.** With ~460s left against a 600s-window route, a same-route retry could not have finished; not retried.
- **Validation:** one batch, 8 findings selected (all P0/P1 plus the four highest actionable P2s). 7 validated, 1
  refuted (#6, consequence disproved, P2 → P3). Two severities corrected by the validator: #3 P1 → P2, #4 P1 → P2.
  One **upgraded**: #8 P2 → P1 (the route is dead, not merely untested). No validator shortcut was taken — the shortcut
  requires cross-model corroboration, which this run does not have.
- **Suppressed:** 3 findings at anchor 50 (expand pool has no terminal `.catch()`; the queue has no global size cap;
  the coverage "empty" check inspects ciphertext that is never empty). Carried as residual risks.
- **Cross-reviewer agreement:** #1 (2 reviewers), #3 (2), #6 (3). No `fast-pass` findings.
- `project-standards` returned **zero** violations: versioning bumped consistently across manifest/package/versions,
  log safety honored (only bounded reason slugs reach `console`), no `pipeline/*` or `plugin/main.ts` changes.
- Not selected: `maintainability` (structure landed in earlier commits; `ce-simplify-code` just passed over the new
  code), `api-contract` (agent-native covers the MCP payload contract).

## Residual risks

- Consent is all-or-nothing for hosted users: the only off switch is server-side `ASK_EXPAND_ENABLED=0`, which a hosted
  user cannot reach. Worth a product decision before paying accounts.
- Clause (4) promises "encrypted" phrases; `encryptMirrorField` falls back to a literal `plain:` prefix with no
  `ATOMS_ASK_MIRROR_KEY` (`crypto.mjs:26-27`). Pre-existing parity with bodies, not a new inaccuracy.
- Spend caps are per process, so N replicas give N× each. A compromised session can drive N × 200 full-body model
  calls per hour. `pool.queue` is unbounded.
- Rows whose expansion fails permanently are re-listed forever, so every Sync re-pays Anthropic for them and
  `expand_coverage` can never reach the 0.8 floor. No retry counter or dead-letter marking.

## Testing gaps

- No test asserts an upsert without a current ack stamp does not enqueue expansion — there cannot be one until #1 has
  a gate. Once it does, assert on the **fetch stub**, not stored state: asserting state passes today while egress
  still happens.
- No test covers wipe-versus-queued-expand (#5). Same rule: assert the fetch stub was never called.
- No coverage of the expand-backfill route (#8), the per-upsert cap, or the privacy invariant that `needExpand` is
  stripped from the client-visible upsert response.
- No handler-level test for `retrieval` / `expand_coverage` on the `search_atoms` payload; only the pure helper is
  tested.
- No AE10 paraphrase-grounding fixture despite the plan's DoD marking it mandatory.
- `ask-search-expand.test.mjs` sets `process.env.ASK_EXPAND_ENABLED = "0"` with no restore — safe only because
  `node --test` forks per file.

---

## Verdict

**Not ready** — on #1 alone.

The consent chain is the entire justification for flipping the default, and it has no server half. A device on
0.6.86 keeps mirroring under wording that never mentioned body egress, and the server expands its bodies anyway —
retroactively, for rows already stored. That is exactly the failure the ack-version machinery was built in #360 to
prevent, and turning the flag on is what makes it reachable.

Everything else is ordinary work. Fix order: **#1 (decide first)** -> #8 -> #2 -> #5 -> #4 -> #7 -> #3 -> #9 -> #10.
