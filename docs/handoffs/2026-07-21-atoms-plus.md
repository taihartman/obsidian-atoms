---
handoff_date: 2026-07-21
branch: feat/atoms-plus-managed-filing
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/92
status: in-progress
---

# Handoff — Atoms Plus (managed filing)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then continue from **Next steps**. Everything you need is below.

## Goal

You are shipping **Atoms Plus**: an optional paid plane so users can file past daily captures via a **managed Anthropic path** without pasting their own API key. Free **BYOK forever** stays. Product is a vault plugin + small Node service — not a second notes app. Vault remains SSOT; body sacred; no ambient filing meters; no rollover of unused filings.

## Current status

### Product (do not relitigate)

- **Price SSOT:** repo-root `plus-pricing.json` — currently **$6/mo**, **$60/yr** (2 mo free), top-up **$2 / +50**, **150** filings/period, **14-day** trial, **rollover: false**.
- Change money numbers **only** in `plus-pricing.json`. Plugin formats via `src/shared/plusPricing.ts`; `plus-service` loads the same JSON.
- UI mock approved (v3 Apple language): `docs/design-handoff/atoms-plus/index.html` + README.
- Limit copy: **Monthly Limit Reached** / **Get More** / allotment starts over on billing date (not “renews automatically” next to top-up).
- No “For You” label in Plus copy.
- Efficient model toggle deferred → GitHub **#90**.
- Issue **#91** tracks full MVP; PR **#92** is the draft branch PR (do not close #91 until U7).

### Code landed on branch (committed)

| Unit | What’s there |
|------|----------------|
| **U1** | `src/platform/filingAuth.ts` — BYOK vs Plus session; device-local `sess_`; limit dismiss day |
| **U2** | `src/platform/plusClient.ts` — magic-link, exchange, me, classify, checkout HTTP |
| **U3** | `classifyCapture` Plus Bearer path; `resolveClassifyAuth`; Process/Preview/Update/auto-run wired |
| **U4** | `previewCache.ts` + dry-run cache wire (re-open free) |
| **U5a–c** | Home hero Try Plus / limit; Settings Plus section (no meters); dogfood session paste **only after `/v1/me` succeeds** |
| **U6 dogfood** | `plus-service/` — in-memory store, magic link (console), meter, Anthropic proxy, dogfood checkout grants (not real Stripe yet) |
| **SSOT pricing** | `plus-pricing.json` + tests |

### Verified

- Plugin unit tests were green at last full run (**322+**); plus-service store + HTTP dogfood tests green.
- World-class QA: **dogfood-OK, not public Ready** — `docs/qa/2026-07-17-feat-atoms-plus-managed-filing-world-class-qa.md` + live dogfood notes `docs/qa/2026-07-17-atoms-plus-live-dogfood.md`.
- Fixes re-verified: Not Now dismiss, session verify-before-save, PORT-aware magic links.
- **Not proven in automation:** live Obsidian UI screenshots; Process with real Anthropic key through plugin (CLI can’t inject SecretStorage / device-local session easily).

### Architecture (one line)

Plugin resolves **none | byok | plus** → same pipeline; Plus hits `plus-service` with Bearer; service holds master Anthropic key + enforces 150/period; vault never leaves Obsidian as SSOT.

## Next steps

1. **Work in the sibling worktree** (path in frontmatter) on `feat/atoms-plus-managed-filing`.
2. **Stripe test catalog + live Checkout smoke** (code landed; needs `sk_test_`):
   ```bash
   cd plus-service
   export STRIPE_SECRET_KEY=sk_test_…
   node scripts/create-stripe-catalog.mjs   # → STRIPE_PRICE_*
   # stripe listen --forward-to localhost:8787/v1/billing/webhook
   export STRIPE_WEBHOOK_SECRET=whsec_… DOGFOOD_AUTO_GRANT=0
   npm start
   # Checkout kinds open real Stripe URL; webhook grants filings
   ```
   OpenCode Stripe MCP is **live** OAuth — do **not** create catalog via MCP until test mode; use the script + test secret.
3. **Human or agent dogfood with real key** (if you have `ANTHROPIC_API_KEY`):
   ```bash
   cd plus-service && ANTHROPIC_API_KEY=… DOGFOOD_AUTO_GRANT=1 npm start
   # Obsidian test vault: Settings → Plus URL http://127.0.0.1:8787
   # Magic link → paste sess_ → Save Session → Process past captures
   ```
4. **Durable store** — replace in-memory `plus-service/src/store.mjs` (SQLite/Postgres/D1).
5. **Real magic-link email** (Resend/Postmark) instead of console-only links.
6. **U5e** fidelity screenshots vs mock; **U7** version bump, README optional-paid language, mark PR ready when dogfood loop is clean.
7. Do **not** start companion/widgets or Efficient mode (#90) unless product reopens them.

## Key files

- `plus-pricing.json` — **only place to change $ / filing counts**
- `src/shared/plusPricing.ts` — format helpers for UI
- `src/platform/filingAuth.ts` / `classifyAuth.ts` / `plusClient.ts` / `previewCache.ts`
- `src/pipeline/classify.ts` — `deps.plus` Bearer path
- `src/home/atomsHomeData.ts` — hero + offer/top-up copy
- `src/home/atomsHomeView.ts` — wait card actions
- `src/settings/settings.ts` — `renderPlusSection`
- `plus-service/src/server.mjs` + `store.mjs` + `config.mjs` + `anthropic.mjs`
- `docs/design-handoff/atoms-plus/index.html` — UI SSOT (prices should match JSON)
- `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` — implementation-ready plan (U5a–e detailed)
- `docs/qa/2026-07-17-feat-atoms-plus-managed-filing-world-class-qa.md`
- PR: https://github.com/taihartman/obsidian-atoms/pull/92 · Issue #91

## Decisions & constraints

- Free BYOK forever; never pitch BYOK on exhaust.
- No ambient 118/150 meters; numbers only on offer / Get More.
- No rollover MVP.
- Plugin never holds managed Anthropic master key.
- Agent dogfood only on `test_vault/` / demo-vault — not Remote Vault notes.
- Multiplayer: claim before code (STATUS + Issue + draft PR already exist for this branch).
- Hard claim rules in `AGENTS.md` / `docs/collab.md`.

## Open questions / blockers

- Stripe product/price IDs not created in live Stripe yet (MCP available per user — use next).
- Durable DB choice for plus-service not locked.
- Email provider not locked.
- Full live Obsidian Plus→Process path still needs human or better dogfood hook.

## Git state

- Branch `feat/atoms-plus-managed-filing` (base `master`), remote `origin` = `https://github.com/taihartman/obsidian-atoms.git`.
- Last real commit before this handoff: `5257e44 refactor(plus): single SSOT for commercial pricing`
- WIP snapshot commit: `433f270 wip: handoff snapshot — atoms-plus`
- Diff since `master`: ~38 files, +5612/-63 (approx at handoff time)
- Unrelated dirty/untracked in main checkout (do not mix into Plus unless intentional): modified `docs/ideation/2026-07-16-open-ideation.html`; untracked entity-orbits QA screenshots, `opencode.json`, `.omo/`

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-atoms-plus
git fetch origin && git switch feat/atoms-plus-managed-filing && git pull --ff-only
npm test
cd plus-service && npm test && cd ..
# optional dogfood:
# cd plus-service && ANTHROPIC_API_KEY=… DOGFOOD_AUTO_GRANT=1 npm start
# ./scripts/install-to-vault.sh   # from worktree root
```

Then continue from **Next steps** above.
