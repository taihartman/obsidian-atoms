# Plan — tryatoms.app landing page (Atoms Plus)

**Date:** 2026-07-28
**Source:** [`docs/handoffs/2026-07-28-tryatoms-landing-page.md`](../handoffs/2026-07-28-tryatoms-landing-page.md)
**Branch:** `claude/tryatoms-landing-page-e46194`

```
Lane:  light
Why:   WHAT is fully specified by the handoff. New isolated `www/` directory with zero
       plugin blast radius, plus a 3-line change to one existing button handler.
       No security / auth / model-surface / vault-write widening.
Doc-review: light (coherence + feasibility, with design + product lenses — public
       product copy and pricing claims move)
Done when: `www/` builds to a static bundle, prices assert-match `plus-pricing.json`,
       page verified at mobile + desktop widths in a real browser with screenshots,
       plugin See Plans opens the URL, PR carries evidence.
```

**Auto-escalate triggers to watch:** if the page needs a product claim the handoff
does not settle (a new promise about what Atoms does), stop and ask rather than
inventing marketing copy.

---

## Scope

**In:**

1. `www/` — static landing page (`index.html`, `privacy.html`, `terms.html`, `styles.css`)
2. Pricing generated from `plus-pricing.json` at build time (no hand-typed numbers)
3. A unit test that fails if rendered prices drift from the SSOT
4. `src/settings/settings.ts` — **See Plans** opens `https://tryatoms.app` instead of a `Notice`
5. Version bump (`manifest.json` + `package.json` + `versions.json`) for the plugin change
6. Deploy to Cloudflare Pages — **preview URL first**. Production deploy and custom-domain
   attach happen only after Tai reviews the preview (decided 2026-07-28)

**Out:** Stripe Checkout on the site · accounts / magic link on the site · docs site or blog ·
changing `plus-pricing.json` amounts · touching Fly `plus-service` · analytics · cookie banner ·
personal Remote Vault.

---

## KTDs (key technical decisions)

### KTD1 — Pricing is generated, not typed

The handoff allows hardcoding with a `keep in sync` comment. Rejected: a comment is not a
gate, and a stale price on a public page is the single worst failure this page can have.

`www/build.mjs` reads `plus-pricing.json` and substitutes `{{monthlyUsd}}`-style tokens into
`index.html.tmpl` → `www/dist/index.html`. `npm run build:www`. A vitest case renders the
template and asserts every price string in the output matches the SSOT, so a price change in
the JSON without a rebuild fails CI, not a customer.

Dependency-free — Node's `fs` + a replace pass. No Astro, no Vite, no framework tax.

### KTD2 — Dark-first, using the real Atoms token palette

The handoff says "light mode first". Tension: every committed product mock
(`docs/design-handoff/atoms-plus/index.html`) and the plugin's own chrome are dark-canonical
Apple-plain — near-black `#000` / `#1c1c1e` surfaces, `#0a84ff` tint, SF stack. A light-first
marketing page would not look like the product it is selling.

**Decided (Tai, 2026-07-28): dark by default, with a light variant behind
`prefers-color-scheme: light`** using the light values the tokens doc already defines
(`#f2f2f7` bg, `#fff` cards, `#000` label, accent darkened via `color-mix`). Both modes ship;
the default matches the product. This supersedes the handoff's "light mode first" line.

### KTD3 — Copy is lifted from the mock, not written fresh

Every user-facing sentence reuses a verbatim string already reviewed in
`docs/design-handoff/atoms-plus/`, or is composed from the constitution's own language.
Locked rules carried onto the page:

- Free BYOK path is named without pressure, never as a downgrade
- "Why it costs" appears **exactly once**
- Approved button vocabulary, title case: Try Atoms Plus · Use My Own Key · Start Free Trial
- **No em dashes** in app-authored copy
- Never claim the website files notes for you without the plugin
- Not a task app; body text is verbatim; desktop + iOS + Android

### KTD4 — No JS on the page

No framework, no analytics, no cookie banner, therefore no consent surface. Motion is CSS
only and gated on `prefers-reduced-motion`. The page is HTML + one stylesheet.

---

## Page structure

| # | Section | Content |
|---|---|---|
| 1 | Hero | "Atoms" + one sentence + `Get Atoms` (BRAT / GitHub) primary, `See how it works` secondary |
| 2 | How it works | Capture → Process → Resurface, three steps, no more |
| 3 | What you get | Verbatim bodies, links not folders, flat library, desktop + phone |
| 4 | Plus | 150 filings/period, managed key, 14-day trial, Ask optional. "Why it costs" lives here |
| 5 | Pricing | Monthly / yearly / top-up from SSOT. Fine print: cancel anytime, BYOK free forever |
| 6 | Ask | Short. Connector URL `https://plus.tryatoms.app/mcp`, stated once |
| 7 | Install | BRAT `taihartman/obsidian-atoms` → Settings → Atoms → Start free trial |
| 8 | Privacy summary | Mirror is opt-in; Process sends captures to Anthropic; we don't train on notes |
| 9 | Footer | Privacy, Terms, GitHub |

`privacy.html` and `terms.html` are separate short pages sharing the stylesheet.

---

## Units

| U | Work | Verify |
|---|---|---|
| U1 | `www/` scaffold + `build.mjs` + SSOT substitution + `npm run build:www` | `dist/index.html` contains `$6`, `$60`, `150`, `14`, `$2`, `50` |
| U2 | `styles.css` — token palette, type scale, dark + light, mobile-first | Renders at 390px and 1440px without horizontal scroll |
| U3 | `index.html.tmpl` — all nine sections with locked copy | Copy audit against §KTD3 rules, incl. em-dash grep |
| U4 | `privacy.html` + `terms.html` | Reachable from footer; claims match plugin honesty |
| U5 | Price-drift vitest | Mutate SSOT in-test → assertion fails |
| U6 | Plugin See Plans → `window.open` + version bump | `npm run build`, CLI smoke in test vault |
| U7 | Cloudflare Pages **preview** deploy | Preview URL loads; screenshots at both widths |
| U8 | Production + custom domain | **Gated on Tai reviewing the U7 preview.** Verify `plus.tryatoms.app` and mail DNS still resolve after |

---

## Risks

| Risk | Mitigation |
|---|---|
| Price drift between page and SSOT | KTD1 — generated + asserted, not commented |
| Marketing overclaim vs constitution | KTD3 — verbatim reuse; doc-review with product lens |
| Breaking `plus.tryatoms.app` or Resend mail DNS | Only attach the apex/`www` hostname; verify both subdomains resolve after; never touch existing records |
| Wrangler token lacks DNS write | Confirmed: token has `pages (write)` + `zone (read)`, **no** `dns_records (write)`. Apex attach may need Tai in the dashboard. Preview deploy is unaffected |
| Deploying to a live public domain unasked | U8 is a hard gate. Preview URL is the default deliverable |

---

## Shipping tail

`ce-simplify-code` → `ce-code-review` → `ce-compound` → `world-class-qa` (browser pass at
390px and 1440px, both color schemes, plus the adversarial half) → PR with `Closes #<issue>`,
Evidence table, and screenshots committed under `docs/qa/screenshots/tryatoms-landing/` and
linked by absolute `raw.githubusercontent.com` URL.

## Multiplayer claim (before any code)

GitHub Issue `feat: tryatoms.app landing page for Atoms Plus (replace See Plans Notice)` →
assign → `STATUS.md` row → draft PR → then implement.
