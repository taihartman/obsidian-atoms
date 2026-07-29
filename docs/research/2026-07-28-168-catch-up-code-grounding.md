# Grounding dossier — #168 Plus-supported vault catch-up

Extraction only. Verified against master 2026-07-28.

## Pricing SSOT — `plus-pricing.json` (full)

```json
{ "monthlyUsd": 6, "yearlyUsd": 60, "yearlyDiscountNote": "save two months",
  "topUpUsd": 2, "includedFilingsPerPeriod": 150, "topUpFilings": 50,
  "trialDays": 14, "rollover": false, "currency": "USD" }
```

Readers: `src/shared/plusPricing.ts:6` (typed `PlusPricing`, `readPlusPricing` throws on wrong
type) → `src/home/atomsHomeData.ts`. `plus-service/src/config.mjs:20-30` reads with hardcoded
fallback, then env-overridable getters (`:73` includedFilings, `:78` topUpFilings, `:81` trialDays).
Tests: `test/plusPricing.test.ts`, `test/wwwPricing.test.ts`.

**Derived anchor: a filing is priced at 4¢** — both included ($6 / 150) and marginal ($2 / 50).

## Batch backfill — `src/pipeline/backfill.ts`

```
:27  BATCHES_URL = https://api.anthropic.com/v1/messages/batches
:31  DEFAULT_BACKFILL_MODEL = "claude-haiku-4-5-20251001"   ($1 / $5 per Mtok, :37)
:48  BATCH_DISCOUNT = 0.5
:50  ASSUMED_OUTPUT_TOKENS = 250   // conservative over-estimate
:91  estimateBatchCost({captureCount, inputTokensPerRequest, model, assumedOutputTokens})
:107   worstCaseUsd = ((worstIn*rates.input + estOut*rates.output)/1e6) * disc
:113   bestInput = Math.min(perIn, 80) * n        // volatile capture suffix
:119   summaryLine = "N capture(s) · ~$X worst-case (batch 50% off, no cache credit)
                      · best-case ~$Y if cache hits"
:59-76 CostEstimate carries creditsCacheReads: false
```

Docstring `:87-90`: "Conservative batch cost: full prefix priced on every request × 50% batch.
Does **not** credit cross-request cache reads (U10 / KTD3 batch caveat)."

Flow: `:259 prepareBackfillEstimate` → `getPastDailyNotesWithUnmarkedCaptures` →
`enumerateBackfillWork` → `countTokensForClassifyRequest` → `estimateBatchCost`.
`:239 assertBatchUsesHourCache` · `:307 submitMessageBatch` · `:335 getBatchStatus` ·
`:365 waitForBatchEnded({maxWaitMs: 30*60*1000, intervalMs: 5000})` ·
`:404 parseBatchResultsJsonl`. Auth is a raw `x-api-key` on every call (`:318`, `:348`) —
**no Plus/session path exists in this module.**

## The BYOK gate — `src/plugin/main.ts`

```
:850 runBackfillFlow()
:851   const apiKey = this.requireApiKey();      // ← the whole bug
:883   new BackfillConfirmModal(app, estimate, async () => executeBackfillBatch(...))
:902   executeBackfillBatch → buildBatchCreateBody → submitMessageBatch
       → waitForBatchEnded({intervalMs: 8000, maxWaitMs: 60*60*1000})
       → fetchBatchResultsJsonl → parseBatchResultsJsonl → applyBackfillResults
:1436 requireApiKey()          // BYOK only
:1449 requireClassifyAuth()    // Plus-aware — used by Process/Preview/Update, NOT by backfill
:1453 resolveClassifyAuth(auth, {plusBaseUrl, onRemaining})
```

Command registered at `src/plugin/commands.ts:135` (`atoms:backfill-estimate-confirm`).

**Correction to issue #168 and to the handoff:** the class is `BackfillConfirmModal`, invoked
inline from `runBackfillFlow`. There is no `BackfillGateModal`.

## plus-service backend — `plus-service/`

Node, no framework. Entrypoint `src/server.mjs:669` (`createServer` + `listen`). Deploy via
`Dockerfile` + `fly.toml`. Routes, all matched on `path` in `server.mjs`:

```
:179 GET  / , /health          :195 GET  /v1/billing/return
:216 POST /v1/auth/start       :263 POST /v1/billing/webhook
:281 POST /v1/auth/magic-link  :314 POST /v1/auth/sign-out
:321 GET  /v1/auth/dev-exchange  :336 GET + :348 POST /v1/auth/exchange
:368 GET  /v1/me               :376 POST /v1/promo
:398 POST /v1/billing/checkout :500 POST /v1/billing/portal
:541      /mcp                 :571 POST /v1/classify
```
Plus `src/mirror/http.mjs:46,94,112` — `/v1/ask/outbox/pull`, `/v1/ask/outbox/ack`.

### A one-time payment path ALREADY SHIPS — `plus-service/src/stripe.mjs`

```js
:10  CheckoutKind = 'start_trial'|'subscribe_monthly'|'subscribe_yearly'|'topup_50'
:38  case "topup_50": return { mode: "payment", priceId: topup, plan: "topup" };
:129 params["payment_intent_data[metadata][email]"] = opts.email;
:310 if (kind === "topup_50" || fromPrice === "topup" || obj.mode === "payment") {
:311   await store.addTopUp(email, config.topUpFilings);
```
Safety already in place around it: `:261 hasProcessedEvent`, `:270-283 resolveCheckoutGrantEmail`
(mismatch → fail closed), `:289 payment_status === "unpaid"` → skip, `:296 price allowlist`,
`:304 claimOrDuplicate` **before** grant ("crash after claim + before grant is preferred to
double-mint").

### Anthropic call
`src/anthropic.mjs:162 proxyClassify(body)` — one synchronous `fetch` (`:171`) to
`config.anthropicUrl` (default `/v1/messages`), model `ATOMS_PLUS_MODEL` default
**`claude-sonnet-5`** (`config.mjs:54`).

### NOT FOUND (verified absent)
- **No Batches API usage anywhere in plus-service** (`grep -rn batch plus-service/src/` → 0 hits).
- **No cron, no worker process, no job runner, no `setInterval`.** All long-running work today
  is client-side inside Obsidian.
- **No catch-up price field** in `plus-pricing.json`; **no catch-up kind** in `resolveCheckoutKind`.

## Ask outbox — the only durable server-held work queue

`plus-service/src/store/askSqliteMethods.mjs:80-95`:
```sql
CREATE TABLE ask_outbox ( id TEXT PRIMARY KEY, email TEXT, kind TEXT,
  payload_enc TEXT, status TEXT, client_request_id TEXT, error TEXT,
  created_at TEXT, claimed_at TEXT, applied_at TEXT );
CREATE UNIQUE INDEX idx_ask_outbox_email_crid ON ask_outbox(email, client_request_id);
```
Methods in all three stores (`memory.mjs:458`, `askSqliteMethods.mjs:274`,
`askPostgresMethods.mjs:279`): `outboxEnqueue`, `outboxPull` (`:318`), `outboxAck`,
`outboxReclaimStale` (`:305`, resets `claimed_at` → pending), `outboxOpenCount` (`:244`).
**Cap: `askHelpers.mjs:640 OUTBOX_MAX_OPEN = 50`** → `{ok:false, error:"outbox_full"}`.
Payload encrypted at rest (`askHelpers.mjs:760/764`), validated by `validateOutboxPayload`.

Client drain: `main.ts:1050 applyAskOutbox()`, guarded by `askOutboxInFlight` (`:167,1059`),
triggered on load/layout/interval (`:223, :232, :589, :1571`). Pull → `planAskOutboxApply` → ack.
Planner `src/platform/askOutbox.ts` — payload `{title, body, tags?, links?, parent_title?,
relation?, client_request_id?}`; plan action `create | applied_idempotent | reject(path_exists)`.

Framing already shipped: `oauth/html.mjs:29` "queue new atoms (outbox) … Writes land only after
your vault applies them." `mcp/instructions.mjs:23` "On pending, say it is queued for the vault."

## Metering / entitlement — service-side, per filing

`server.mjs:571-655` on `POST /v1/classify`:
```js
:591 if (isProduction() && !idem) → 400 "Idempotency-Key header required"
:597 const consume = await store.tryConsumeFiling(session, idem);
     // "auth"→401, "idempotency_conflict"→409, "in_flight"→409
:611 → 402 { message: "Included filings used up this period. Wait for reset or buy a top-up.",
             status: "exhausted", remaining: 0 }
:619 replay returns consume.cached.responseJson
:634 on upstream failure → store.refundFiling(session, idem)
:646 store.completeUsage(idem, {email, status:"ok", responseJson, remaining})
```
Balance model `store/shared.mjs`: entitlement shape `{status, plan, remaining, periodEnd}`
(`:22-26`); `:60` expired periodEnd → remaining = 0. Grants: `grantPeriod(email, {status, plan,
days, remaining: config.includedFilings})` for subscribe/trial (`stripe.mjs:326`) and renewal on
`invoice.paid` (`:342-368`); `addTopUp(email, config.topUpFilings)` for the one-time path.
Tests: `plus-service/test/meter.test.mjs`, `security-meter.test.mjs`.

## Capture counting + write path

`src/pipeline/daily.ts:58 getPastDailyNotesWithUnmarkedCaptures(app, todayOrOpts)`
→ `{notes, totalUnprocessed}`; throws `DailyNotesDisabledError` (`:62`); default **excludes
today**, `includeToday` opt-in (`:53-56`). Called from `src/home/atomsHomeView.ts:630,634`.

`src/pipeline/render.ts:466 planWrite({result, capture, dailyPath, dailyDate, atomFolder,
existingAtomPaths}) → PlannedWrite`
`src/pipeline/render.ts:543 applyWrite(app, plan, dailyContent, opts?) → {result, newDailyContent}`

## Landing-page coupling
`test/wwwPricing.test.ts` — test named "scopes catch-up to BYOK until Plus supports it" **fails**
if landing copy pairs Plus with catch-up. `www/src/index.html.tmpl` `#backfill` section carries the
BYOK-only copy. Both must change in the same PR that ships this.
