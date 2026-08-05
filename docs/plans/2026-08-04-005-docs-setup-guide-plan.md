# Plan — `/setup`: the from-zero onboarding page

**Date:** 2026-08-04
**Lane:** Full feature
**Why this lane:** net-new site surface (new page + build registration + nav + tests), a new
primary user story ("I have never opened Obsidian and I want this working"), and it moves
product-facing copy. Exceeds the Light rule of thumb (≤~2 real logic files).
**Doc-review:** full multi-persona — UI/product copy moves, and the page *is* the product for
a new user. Add `voice-designer` (site has a strong, distinctive voice) and `design-critic`.

---

## Problem

A new user who has never used Obsidian cannot get Atoms working from what tryatoms.app
currently says. Three concrete gaps, all verified against the live tree:

1. **The install story is five thin `<li>`s** (`www/src/index.html.tmpl:761-783`). It says
   "create a vault", "install BRAT", "add the beta plugin" as if each were one motion. A prior
   on-ramp pass already merged (#206/#207), so this is round two — the thin version has been
   tried and is still not enough.
2. **The iOS capture Shortcut is invisible on the site.** The device-verified recipe exists at
   `docs/capture-shortcut.md` and the plugin ships a one-tap iCloud link
   (`src/settings/captureShortcut.ts:16`), but a prospective user reading the site never learns
   capture is a Shortcut, never mind how to install it. Android has no equivalent and the site
   never says so.
3. **`#ask` sells the payoff and withholds the method.** The section
   (`www/src/index.html.tmpl:323-460`) is entirely benefit copy — "Ask from Claude or ChatGPT",
   "Follow the thread". The actual mechanism (Enable Ask mirror → MCP connector URL → pairing
   code → Claude *Settings → Connectors → Add custom connector*, ChatGPT *Settings → Apps &
   connectors, Developer mode*) exists only inside plugin settings, where a non-user cannot see
   it.

Meanwhile the landing page is 843 lines and cannot absorb any of this.

## Product bar

A person who has never heard of Obsidian can go from nothing to *(a)* Atoms installed and
running, *(b)* capture working from their phone, and *(c)* recall working from Claude or
ChatGPT — without leaving the page, guessing, or reading the repo.

Success is not "the steps are listed." It is **no dead ends**: every step names the exact UI
label to look for, and every known trap is called out at the moment it bites.

## Scope

**One new page, `/setup`**, with three anchored parts and a sub-nav:

| Part | Covers |
|---|---|
| 1 · Install | Obsidian → vault → community plugins → BRAT → `taihartman/obsidian-atoms` → enable → key or trial |
| 2 · Capture | iOS Shortcut (one-tap link first, manual recipe as fallback) + honest Android state |
| 3 · Ask | Enable Ask mirror → connector URL → pairing code → Claude and ChatGPT wiring |

Landing-page `#install` shrinks to a short pointer at `/setup`. Nothing else on the landing
page moves in this change.

**Out of scope:** an Android capture recipe (see KTD3), redesigning `#ask`'s benefit copy,
touching the pricing/privacy sections, any plugin code change.

## Key technical decisions

**KTD1 — One page, not three.** Anchored sections `#install` / `#capture` / `#ask` on `/setup`,
with a sub-nav. One URL to hand a newcomer; the landing page shrinks either way. Splitting into
`/capture` and `/ask` stays cheap later because the anchors become the page names.

**KTD2 — Screenshots only where the UI is genuinely confusing, and only where they can be
produced honestly.** Verified this session: the Obsidian CLI reaches *inside an open vault*
(`plugins:restrict`, `plugin:install`, `dev:screenshot` — probe produced a 300KB PNG), so the
community-plugins toggle, BRAT's *Add beta plugin* modal, the enable toggle, and Settings →
Atoms can all be captured for real. Vault creation happens in the vault-switcher window, which
the CLI cannot reach, and iOS steps cannot be captured from this machine at all. Those stay
text. **No mock or reconstructed screenshots** — per non-negotiable #9, a staged image is not
product proof.

**KTD3 — Android gets an honest "not yet" plus the fallback that works.** State plainly there
is no Android shortcut, say why (no Shortcuts-equivalent append-to-bookmark path), and give the
manual route: type `- thought` bullets into the daily note. This matches
`docs/architecture.md:15` ("Android-capable later"). Writing a speculative Tasker recipe we
cannot device-verify would violate the same honesty rule as a staged screenshot.

**KTD4 — The iCloud link leads; the 9-action recipe is the fallback.** Most users should tap
one link. The manual build stays for when the link breaks or someone wants to understand it —
carrying both documented traps verbatim (`Format Date` action vs the `Current Date` variable;
`ZZZZZ` not `Z`), because both cost real time on device.

**KTD6 — Screenshots are phone-shaped, and the page is built mobile-first.** Captures are
390×844 @2x (780×1688) via `dev:mobile on` plus an Electron `setContentSize` — `dev:mobile`
alone leaves the window at desktop size. Phone-shaped images are the right call independent of
capture convenience: Atoms' daily loop *is* the phone (capture by Shortcut, read in chat), a
tall narrow image embeds cleanly in a single-column reading layout, and BRAT install works on
mobile Obsidian. **Caveat to resolve:** most people will do the BRAT install at a desktop, so
mobile-shaped shots of a desktop-performed step could mislead. Mitigation is wording — the text
names menu paths that are identical on both, and the page says up front that the install can be
done on either. Flagged for doc-review.

**KTD5 — The page inherits the site's hard constraints.** `test/wwwPricing.test.ts` enforces:
no unsubstituted `{{tokens}}`, no `<script>` on non-index pages, no inline `style=` attributes
(the CSP drops them silently), fingerprinted assets. New page joins `PAGES` in
`www/build.mjs:237`. Images are fine as-is — CSP is already `img-src 'self' data:`.

## Units

| # | Unit | Files | Verify |
|---|---|---|---|
| U1 | ~~Walk the install for real in a fresh vault; record friction points and capture screenshots~~ **DONE 2026-08-04** | `docs/qa/2026-08-04-setup-walkthrough-findings.md`, `docs/qa/screenshots/setup-guide/` | ✅ Empty vault → Atoms 0.6.69 enabled; 5 shots at 390×844 @2x |
| U2 | `setup.html.tmpl` scaffold + register in `PAGES` + nav/sub-nav + styles | `www/src/setup.html.tmpl`, `www/build.mjs`, `www/src/styles.css` | `npm run build:www` clean; page renders |
| U3 | Part 1 — Install, from U1's real notes, with screenshots | `www/src/setup.html.tmpl`, `www/src/a/*` | A reader can follow it start to finish with no gaps |
| U4 | Part 2 — Capture: iOS one-tap + manual recipe + Android honesty | `www/src/setup.html.tmpl` | Matches `docs/capture-shortcut.md`; link matches `captureShortcut.ts:16` |
| U5 | Part 3 — Ask: mirror toggle, connector URL, pairing code, Claude + ChatGPT | `www/src/setup.html.tmpl` | Labels match `src/settings/settings.ts:1150,1202,1264` exactly |
| U6 | Shrink landing `#install` to a pointer; add `/setup` to nav + footer | `www/src/index.html.tmpl` | Landing page shorter; no orphaned anchors |
| U7 | Extend `test/wwwPricing.test.ts` to cover `setup` | `test/wwwPricing.test.ts`, `www/build.mjs` | Token/CSP/fingerprint assertions run against the new page |

U1 gates U3. U4/U5 can proceed in parallel with U1 since their source material is already
verified on disk.

## Risks

- **Screenshots date.** Obsidian and BRAT UIs shift. Mitigation: capture only the few steps
  where words genuinely fail, and keep the text authoritative so a stale image degrades
  gracefully instead of misleading.
- **Voice clash.** The site reads "You wrote it down. You never found it again." A procedural
  page can turn into a flat manual. Mitigation: `voice-designer` lens in doc-review.
- **Drift from plugin labels.** If settings copy changes, the page lies. Mitigation: U5 quotes
  labels from `settings.ts` and doc-review checks them against source.

## Verification

`npm run build:www` → `npm test` (site assertions) → read the built page start to finish as a
newcomer would. Shipping tail per CLAUDE.md: simplify → code-review → compound →
world-class-qa. This is a docs/site change with **no plugin UI**, so PR evidence is the built
page plus the U1 install screenshots, not vault dogfood screenshots.

## U1 — done (2026-08-04)

Walked from a genuinely empty vault (`new vault/`, created by the user through the GUI) to
Atoms 0.6.69 installed and enabled. Full write-up: **`docs/qa/2026-08-04-setup-walkthrough-findings.md`**.
Five phone-sized screenshots in `docs/qa/screenshots/setup-guide/`.

Three findings materially change the copy and are now folded into the units above:

- **Restricted Mode is on by default and the site never mentions it** — a hard dead end at the
  current step 2. The button is **Turn on community plugins**.
- **BRAT auto-enables what it installs**, so the site's "Enable Atoms" step is a phantom.
- **The one-tap iOS path lives inside the plugin** (Settings → Atoms → **Install Capture
  Atom**), so Part 2 leads with that button, not the 9-action recipe.

The `test_vault/fresh-install-walkthrough` folder and its injected `obsidian.json` entry are now
unused leftovers from the failed automation attempts — remove both during cleanup (backup at
`obsidian.json.bak-atoms-research`).
