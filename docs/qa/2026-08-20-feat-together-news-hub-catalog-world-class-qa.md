# World-Class QA: feat-together-news-hub-catalog

## Verdict

Ready after owner merge call. Live CLI proved Open destination, Not now hold, and directory death. Window screenshots never isolated the news card (wait-card pane / `dev:screenshot` main-window ambiguity). Craft of the card is Not Tested visually.

## Charter

Together on calm Home is news that something joined an accepted hub, not a sibling directory. Open goes to the hub note. First catalog fill is the existing hub-list preview. Adjacent risk: wait card hiding news, invite outranking news, listing default staying off.

**Product loop vs fixture:** Open/Not now/directory-gone were driven on the throwaway vault with a live plugin 0.8.13 install. The news card itself was forced by emptying `atoms-together-news-told-v1` and setting `unprocessedCount = 0` (UI-chrome). Wait card still wins the real hero while 22 captures sit unprocessed.

**Authority:** `docs/plans/2026-08-20-1043-feat-together-news-hub-catalog-plan.md` R1, R5–R7, R11, R13, R14, KTD4–KTD6, KTD11.

## Preflight

- **Product dogfood honesty** ✅
- **Learnings** ✅ (wait card wins hero; Home 0×0 sidebar; `dev:screenshot` stale-frame pair; lock)
- **Navigation map** ✅ Together news row added this PR
- **Run command:** `./scripts/install-to-vault.sh` then `obsidian eval` / `dev:screenshot`
- **Viewport:** desktop CLI, Home leaf ~195px (sidebar). Phone not driven.
- **Auth:** N/A (Home card, no Plus)
- **Vault lock:** acquired via install, released after drive
- **Build:** Atoms v0.8.13 in `app.plugins.plugins.atoms.manifest.version`

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story |
|---|---|---|---|
| Calm Home | R1 | No Together directory (count, peek, “Open to see them all”) | US-directory-dies |
| Together Open | R7 + kicker Together / title = newest atom / supporting = hub | Opens hub vault note, not `entity-siblings` | US-open-hub |
| Together Not now | R11, KTD11 | Stamps that hub’s unseen members; this visit returns to For you | US-not-now |
| Wait / invite | R14 | Wait and invite outrank news | US-priority |

## User Stories Tested

1. As a vault with Show list / Nichita already accepted, I open calm Home and do not see a Together directory. Acceptance: innerText has no “see them all”; listing-on first pick with a missing told-set seeds and shows For you (mind-change). Evidence: CLI JSON `hasSeeThemAll:false`, `hasTogether:false` on seeded told-set. Status: Passed (live eval). Proof kind: user-loop on install + existing vault members.
2. As a reader of Together news, I tap Open and land on the hub note. Acceptance: `People/Nichita.md` is the active file; `homeOpen` is null. Evidence: CLI JSON `openedPath:"People/Nichita.md","homeOpenKind":null`. Status: Passed (live eval). Proof kind: UI-chrome (told-set emptied).
3. As a reader who taps Not now, I return to For you this visit. Acceptance: Together gone; mind-change may return; hold flag true. Evidence: `afterTogether:false, afterMind:true, held:true`. Status: Passed (live eval). Proof kind: UI-chrome.
4. Wait card outranks news. Acceptance: with 22 unprocessed, hero is “22 Captures Waiting”. Evidence: first `atoms:open-home` innerText. Status: Passed (live eval). Proof kind: user-loop.

## Risk Matrix

| Class | Check | Result |
|---|---|---|
| Happy | News names newest atom + hub; Open / Not now | Passed (eval) |
| Negative | Listing off → no news | Passed (unit `togetherNews.test.ts`) |
| Edge | Missing told-set seeds, returns none | Passed (unit) |
| Edge | Two hubs → newest source date | Passed (unit) |
| Regression | Also about / orbits unchanged | Passed (`entityOrbitIndex.test.ts`) |
| Perception | No count, no peek, no “see them all” | Passed (eval + unit copy) |
| Craft | Decisive screenshot of the news card | Not Tested — `dev:screenshot` captured the wait-card window |

## Evidence

- `npm test`: 2220 passed
- `npm run typecheck` / `npm run build`: passed
- `npm run lint`: passed after first-fill `prepared` reuse
- Install: Atoms v0.8.13, `listing:true` already on this vault
- CLI Open: `People/Nichita.md`, not `entity-siblings`
- CLI Not now: Together gone this visit
- Screenshots under `docs/qa/screenshots/feat-together-news-hub-catalog/` are **not** valid card proof (wrong pane)

## Findings

1. **P2 — screenshot isolation.** `dev:screenshot` kept returning the wait-card / Nichita split even after eval showed Together in `rootEl.innerText`. Learnings already name main-window ambiguity. No product bug proven.
2. **P3 — catch-up banner.** “Catches up when you reopen” sits above the hero and pushed news below the fold on a 195px leaf. Pre-existing; dismissed via `ackEgressNotice` for the drive.

## Adversarial QA

| Scenario | Result |
|---|---|
| Open goes to hub, not sibling list | solid — live `openedPath` |
| Open then this visit does not rebuild news | solid — `held:true`, `togetherNews:null` |
| Not now then other hub this visit | solid — hold until next `onOpen` |
| Double Open | solid — second tap has no card |
| Empty told-set dump of existing members as news | solid — picker seeds, returns none (unit + first eval) |
| Wait card vs news | solid — wait wins |
| Refresh Home while news showing | blocked: vault `modify` listener restored `unprocessedCount` and hid the card |
| First-fill preview Not now on a listing-off vault | Not Tested — this vault already had listing on |
| Phone / iOS | Not Tested |

No proven product hole. Unproven: first-fill modal on a brand-new listing-off vault.

## Not Tested

- Visual craft of the news card (screenshot never isolated it)
- First-fill preview on a listing-off vault
- Device / phone
- Process → new join → news without emptying told-set (needs a filing pass; 22-backlog wait card)

## Learnings

Consulted. Appended: `dev:screenshot` of Atoms home is not the leaf `eval` just mutated when several `atoms-home` leaves and a wait-card tab exist.

## Merge Decision

Owner asked to merge. Automated suite green. Live CLI proofs cover Open destination, Not now hold, and directory death. Residual: no isolated screenshot of the card; first-fill on-ramp unproven on this already-on vault.
