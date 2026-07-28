# Handoff — tryatoms.app landing page (Atoms Plus)

**Date:** 2026-07-28  
**For:** Claude (or any strong frontend agent) — build + deploy  
**Owner human:** Tai  
**Repo:** `taihartman/obsidian-atoms`  
**Why:** Settings → Atoms Plus → **See Plans** currently dumps a long Notice. We own `tryatoms.app` + Cloudflare; replace Notice with a real URL.

---

## Goal

Ship a **single beautiful marketing/pricing page** at **https://tryatoms.app** (and ideally `www`) that:

1. Explains Atoms + Atoms Plus in plain language  
2. Shows pricing from SSOT (never invent numbers)  
3. Tells people how to install and start trial  
4. Hosts short **Privacy** + **Terms** (can be same page anchors or `/privacy` `/terms`)  
5. Lets the plugin open this URL instead of a Notice  

**Not a product app.** No login, no checkout on the site (Checkout stays in the Obsidian plugin via Stripe).

---

## Product one-liner

**Atoms** turns past daily-note captures into a trusted second brain (flat atoms, verbatim bodies, gentle resurface).  
**Atoms Plus** = managed AI filing (no BYOK) + optional **Ask** (Claude/ChatGPT MCP over a cloud mirror of `Atoms/`).

Free forever with your own Anthropic key. Plus is optional.

---

## Pricing SSOT (do not invent)

Read and display **only** from repo-root:

`plus-pricing.json`

```json
{
  "monthlyUsd": 6,
  "yearlyUsd": 60,
  "yearlyDiscountNote": "save two months",
  "topUpUsd": 2,
  "includedFilingsPerPeriod": 150,
  "topUpFilings": 50,
  "trialDays": 14,
  "rollover": false,
  "currency": "USD"
}
```

Also: model is Sonnet-class filing (plugin default); top-up is +50 filings for $2; no rollover.

If you hardcode prices in HTML for v1, add a comment: `// keep in sync with plus-pricing.json` and match exactly.

---

## Design direction (high bar)

You were chosen for **frontend taste**. Avoid generic AI SaaS purple gradient sludge.

### Tone
- **Apple-plain / calm** — same voice as plugin mocks  
- Confident, short sentences  
- Name the free path without guilt  
- No dark patterns, no fake scarcity, no “join 10,000 users”

### Visual references (in repo — open these)
| Path | Use |
|------|-----|
| `docs/design-handoff/atoms-plus/index.html` | **Primary** Plus UI language, offer copy, button labels |
| `docs/design-handoff/atoms-plus/README.md` | Locked product rules for Plus chrome |
| Plugin Settings / home copy | “Try Atoms Plus”, “Start free trial”, “Use my own key” |

### Aesthetic brief
- Distinctive but quiet: good type, generous whitespace, one accent color (not Bootstrap blue)  
- Works in light mode first; dark optional if elegant  
- Mobile-first (phone is a first-class Obsidian surface)  
- Motion: subtle or none; respect `prefers-reduced-motion`  
- Real content only — no lorem, no stock dashboard screenshots unless from our QA shots under `docs/qa/screenshots/` (optional)

### Skills available in this repo (use if helpful)
- `.agents/skills/frontend-design/SKILL.md`  
- `.agents/skills/hallmark/SKILL.md` (anti-slop)  
- Do **not** need Stripe skills for this page  

---

## Page structure (minimum sections)

1. **Hero** — product name + one sentence + primary CTA  
   - Primary: “Get Atoms” → GitHub / BRAT install  
   - Secondary: “Start free trial” → short how-to (plugin Settings)  
2. **How it works** — 3 steps max (Capture → Process → Resurface / Ask)  
3. **Plus** — what you get: 150 filings/period, 14-day trial (card), managed key, Ask/MCP optional  
4. **Pricing** — monthly / yearly / top-up from SSOT; fine print: cancel anytime, BYOK free forever  
5. **Ask** (short) — chat in Claude/ChatGPT; connector URL `https://plus.tryatoms.app/mcp`  
6. **Privacy** — Atoms/ mirror for Ask is opt-in; Process sends captures to Anthropic (Plus = our key; BYOK = yours); we don’t train on notes (match plugin honesty)  
7. **Footer** — Terms, Privacy, GitHub `taihartman/obsidian-atoms`, contact optional  

### Copy constraints (constitution-aligned)
- Body text of captures is **sacred** / verbatim in atoms  
- Not a task app  
- Desktop + iOS + Android  
- Never claim the website files notes for you without the plugin  

---

## Technical requirements

### Hosting
- **Cloudflare Pages** (preferred) or Workers static assets  
- Project name suggestion: `tryatoms` or `tryatoms-www`  
- Production URL: **https://tryatoms.app**  
- Optional: `www.tryatoms.app` → apex  

### DNS (Cloudflare zone `tryatoms.app` already exists)
Human/agent will attach Pages custom domain. Typical:
- Pages custom domain `tryatoms.app`  
- Do **not** break existing:
  - `plus.tryatoms.app` → Fly (`atoms-plus`)  
  - `mail.tryatoms.app` → Resend DNS only  

### Repo layout (recommended)
Put site in monorepo so pricing/docs stay near product:

```text
www/                    # or site/
  index.html            # or Astro/Vite single page
  privacy.html          # or #privacy
  terms.html
  styles.css
  public/
wrangler.toml           # if Workers/Pages via wrangler
```

**Or** standalone `tryatoms-www` repo — only if monorepo is painful. Prefer monorepo `www/`.

### Stack preference
- **Static HTML + CSS** (or minimal Astro/Vite) — fastest, no framework tax  
- No React app shell unless it clearly helps design quality  
- No cookie banners unless required; no analytics required for v1 (optional Plausible later)  

### Deploy
```bash
# Example — adapt to chosen stack
npx wrangler pages project create tryatoms
npx wrangler pages deploy www --project-name=tryatoms
# Then Cloudflare dashboard: Custom domains → tryatoms.app
```

Agent has Cloudflare via `wrangler` OAuth on Tai’s machine (zone read; DNS write may need token — ask human if Pages domain attach fails).

---

## Plugin change (same PR or follow-up)

File: `src/settings/settings.ts` — **See Plans** button (Plus section).

**Today:** builds a long `Notice(...)`.  
**Wanted:**

```ts
window.open("https://tryatoms.app", "_blank");
// or https://tryatoms.app/plus if you use a path
```

Bump plugin version if shipping plugin change (manifest + package + versions.json).  
If site ships first, plugin can follow in a tiny PR.

Also search home CTA copy if “See Plans” exists elsewhere.

---

## Out of scope
- Stripe Checkout on the website  
- User accounts / magic link on the site  
- Full docs site / blog  
- Changing `plus-pricing.json` amounts (product decision separate)  
- Touching Fly `plus-service` unless linking only  
- Personal Remote Vault  

---

## Acceptance criteria

- [ ] https://tryatoms.app loads on phone + desktop, looks intentional (not template)  
- [ ] Prices match `plus-pricing.json` exactly  
- [ ] Clear path: install plugin (BRAT `taihartman/obsidian-atoms`) → Settings → Start free trial  
- [ ] Privacy + Terms reachable  
- [ ] MCP URL documented once  
- [ ] `plus.tryatoms.app` and mail DNS still work  
- [ ] Plugin **See Plans** opens the site (if in scope of this work)  
- [ ] No secrets in repo  

---

## Environment facts (current prod)

| Service | URL |
|---------|-----|
| Plus API | https://plus.tryatoms.app |
| MCP | https://plus.tryatoms.app/mcp |
| Mail from | Atoms Plus \<plus@mail.tryatoms.app\> |
| Plugin default Plus URL | https://plus.tryatoms.app (empty settings) |
| GitHub | https://github.com/taihartman/obsidian-atoms |
| BRAT | `taihartman/obsidian-atoms` |

Stripe is **live** on Fly; trial is card-upfront 14 days.

---

## Process notes for the implementing agent

1. Read `AGENTS.md` + `CLAUDE.md` + `STATUS.md` before code; claim a GitHub Issue if multiplayer.  
2. Prefer `www/` in monorepo + draft PR.  
3. Do not commit secrets.  
4. After deploy, paste live URL + screenshot in PR.  
5. If design needs a product call (name “Atoms” vs “Atoms Plus” on hero), default: **Atoms** product, **Plus** as paid layer.  

---

## Suggested Issue title

`feat: tryatoms.app landing page for Atoms Plus (replace See Plans Notice)`

---

## Success

A stranger can open tryatoms.app, understand the product, see $6/150/14-day trial, install via BRAT, and the in-plugin **See Plans** button is no longer a text dump.
