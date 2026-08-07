# Research: Atoms companion capture app

**Date:** 2026-08-07  
**Status:** investigation only — no claim, no implementation  
**Origin:** product conversation (Shortcuts pain, Android gap, widgets, Plus/self-host question)  
**Related:** GitHub [#166](https://github.com/taihartman/obsidian-atoms/issues/166) (Android capture), `#56` inbox contract (shipped), ideation ranked companion **#2** (`docs/ideation/2026-07-17-next-product-monetization-ideation.html`), Plus plan deferred companion/widgets/share sheet

---

## One-line frame

The companion is **not a second brain**. It productizes the already-external **Capture** leg: append stamped lines; the Obsidian plugin still drains, files, and resurfaces.

```
Companion / Shortcut  →  stamped bullet  →  Atoms System/Inbox.md (or cloud queue → same)
                      →  plugin drain → daily  →  Process → atoms
```

Wire contract (byte-sensitive):

```text
- 2026-07-28T17:23:34-04:00 capture text here
```

ISO local + **colon offset** + **seconds**; multiline → `\n\t` continuations. Spec: `docs/capture-shortcut.md`, parser `src/pipeline/inbox.ts`.

---

## Why it exists (jobs)

| # | Job | Today |
|---|---|---|
| 1 | Capture in ≤5s without opening Obsidian | iOS Shortcut works but fragile; install/recipe traps |
| 2 | **Android capture** (constitution #11) | **None** — #166 open; tryatoms must not fake a path |
| 3 | Home-screen / lock-adjacent one-tap | Widgets / tiles; Shortcuts placement is homework |
| 4 | Closed-app reliability | Inbox bookmark path exists because daily-note capture failed when Obsidian was force-quit |
| 5 | Verbatim body (type + voice) | Body sacred — companion is an authoring tool only |

### The “third reason” you forgot

Beyond Shortcuts quality, Android, and widgets, the repo points at:

1. **Share Sheet / Android share target** — catch links and selected text without a per-source Shortcut. tryatoms already markets this; delivery is fragile.
2. **Honest offline / delivery status** — *Saved · waiting for vault* vs *In vault*. Sync lag today is invisible; companion can make “never lossy” legible.
3. **One installable artifact for both platforms** — no shareable Android equivalent to an iCloud Shortcut link; Tasker is not product.

**Lead with:** share ingress + delivery trust + one binary. Widgets are table stakes once you have an app.

---

## What must never be in the companion

| Forbidden | Why |
|---|---|
| Classify / Process / Preview / Update notes | Plugin owns filing |
| Create/edit atoms, markers, hubs, library, resurface | Second brain stays in Obsidian |
| Rewrite or “improve” capture body | Body sacred |
| Tasks, due dates, streaks, guilt queues | Not a task app |
| Cloud as second library / reverse-sync authority | Vault SSOT; queue only |
| Paywall the basic capture habit if free daily bullets stay first-class | Plus sells judgment/uptime, not the habit |

**Boundary forever:** *Companion appends stamped lines. Plugin drains, files, resurfaces. Cloud (if any) is a dumb pipe, never a brain.*

---

## Can the app write to Obsidian directly?

**There is no third-party Obsidian Sync API.** Write = local files (or a queue the plugin applies). With Obsidian closed, even a perfect local write does not leave the device until Obsidian opens (documented today for Shortcut).

| Path | iOS | Android | Obsidian open for write? | Plus? | Fits inbox? | Verdict |
|---|---|---|---|---|---|---|
| Shortcut → Bookmark (shipped) | Yes | No | No (force-quit OK) | No | Yes | Keep as free iOS baseline |
| SAF / folder append to `Inbox.md` | Only if vault is Files-visible | **Yes — #166 preferred** | No | No | Yes | Best free Android path |
| Sync sandbox FS write | **No** (no App Group) | Sometimes | No | No | Yes if writable | Don’t bet iOS product on this |
| `obsidian://` / Capture URI (#51) | Yes | Yes | **Launches app** | No | Possible | **Rejected** once — zero app-switch is load-bearing |
| Advanced URI / Actions URI | Yes | Yes | Launch/open | No | Possible | Power-user only |
| Local REST API | No | No | Desktop only | No | Dev | Out |
| Git / Working Copy | Yes | Yes | No | No | Yes | Niche |
| **Reuse Ask outbox `create_atom`** | Yes | Yes | Enqueue no; land needs plugin | Yes + Ask | **No** (atoms, not dailies) | Wrong object |
| **New Plus capture queue → plugin → inbox** | Yes | Yes | Enqueue no | Yes or self-host | **Yes** | Best no-FS / widgets / Sync-sandbox iOS path |

### Critical distinction

**Ask outbox** (`create_atom` / `continue_atom`) is **not** capture. It creates titled atoms under `Atoms/`, needs Plus + Ask + Allow filing, and skips the daily → Process loop. Do not repurpose it as the companion spine.

A **new capture outbox** (enqueue stamped lines → plugin appends inbox or drains with same semantics) is the constitution-safe server shape.

---

## Monetization

| Option | Tradeoff |
|---|---|
| Plus-only companion | Funds dual-ship; paywalls habit; weak for #166 honesty |
| Separate IAP (Drafts-style) | Third SKU; Apple tax; undercuts Plus story |
| Free forever vault-only | Max trust; no revenue; iOS FS often impossible |
| BYO server only | Privacy niche; support hell; not sole MVP |
| **Hybrid (recommended)** | **Free:** type/voice → vault delivery where possible (Android SAF; iOS Shortcut or Files vault). **Plus:** cloud capture relay, polished widgets/share, delivery status. Filing stays BYOK or Plus as today. Self-host = same client, base URL override (`docs/ask-self-host.md`). |

**Avoid:** pure Plus-only if marketing still says free daily-bullet capture is first-class.

Platform asymmetry is real: Android may get true free FS append; iOS Sync-sandbox users may need Plus/self-host relay for closed-app parity. Document that; don’t paper over it.

---

## Tech stack (no app in monorepo today)

| Rank | Stack | Notes |
|---|---|---|
| **1** | **Native SwiftUI + Kotlin/Compose** | Widgets + share extensions are first-class; best cold-launch |
| **2** | KMP shared core + native UI/extensions | Share stamp/queue/HTTP; keep OS chrome native |
| **3** | Flutter + **mandatory** native extension targets | OK main UI; budget widgets/share as native from day 1 |
| Avoid | Capacitor / PWA-as-capture | Weak launch/widget story (ironic: Obsidian mobile is Capacitor) |

**Auth:** reuse Plus magic-link → device verifier → `sess_` Bearer. Mobile is another Plus client, not a new IdP. Not `mcp_*` tokens.

**MVP cost (rough):** dual-platform compose + widget + share + queue + server enqueue + plugin drain ≈ **10–15 person-weeks**. iOS-only + backend ≈ **5–8**. Shortcut-only Android docs ≈ days (does not close the product gap).

---

## Recommended strategy (not an approved plan)

### Tier 1 — stay on inbox contract, minimize backend

1. **Spike Android SAF** append to `Atoms System/Inbox.md` with Obsidian force-quit; open days later; Monday stamp → Monday daily (#166 acceptance).
2. **Spike iOS:** can dogfood vault sit where Files can write? If no → Tier 2 required for iOS companion parity.
3. Do **not** primary-path on `obsidian://` (already failed).

### Tier 2 — Plus (or self-host) capture queue

```
App → POST /v1/capture/enqueue  (NEW, sess_)
Plugin → pull + append Inbox.md + ack  (mirror Ask outbox shape, different payload)
```

- Widgets and Share extensions only need network + local queue.
- Self-host inherits same binary + URL override.
- Prefer apply-to-**inbox** so one drain path stays SSOT.

### MVP surface (if you greenlight later)

| In | Out |
|---|---|
| Type + voice compose | Classify, library, resurface, Ask |
| Correct stamp (shared golden tests with `inbox` parser) | OCR / camera intelligence |
| One widget + share extension | Watch apps, clipboard spies |
| Delivery honesty UI | Editing inbox as a product surface |
| Dual platform (or explicit phased plan note) | Writing straight into `Atoms/*.md` |

### Branding

**Capture for Atoms** (or similar) — not “the Atoms app.” Vault remains Obsidian.

---

## Precedents that fit

| Product | Lesson |
|---|---|
| **Drafts** | Queue first, file later; widgets + share + Siri |
| **Things** | Tiny capture UI; sync reliability is the product |
| **Reflect** | Daily-centric stamps match drain model |
| Bear/Craft/Mem | They own the store — you don’t; don’t copy full note apps |

---

## Risks

| Risk | Mitigation |
|---|---|
| Companion becomes mini second brain | Written non-goals; no classify client |
| “Capture missing” = Sync vs app vs drain vs stamp | One status model; shared stamp test pack |
| Multi-device inbox merge races | Append-only; never truncate; plugin already hardened |
| App Store “useless without another app” | Position as companion utility; show value in onboarding |
| Plus-only blocks #166 honesty | Free vault path on at least one OS |
| Start too early vs Community/Plus stability | Ideation: distribution before heavy new surface; spike first |

---

## Spike checklist (1–3 days, before any claim)

1. Android: SAF append, Obsidian force-quit, multi-day stamp → correct daily.
2. iOS: Files-visible vault write vs Sync-sandbox impossibility.
3. Two devices offline-append inbox, then both open (merge behavior).
4. Magic-link → `sess_` → `/v1/me` in a throwaway mobile harness.
5. Sketch `capture enqueue/pull/ack` next to existing outbox routes (shape + one failing test) — only if Tier 2 needed.
6. Cold-launch timer: empty SwiftUI type→save vs Flutter hello (kill framework debate with a number).

---

## Open decisions for humans

1. **Gating:** hybrid free+Plus relay vs Plus-only vs free vault-only?
2. **Sequencing:** Android-first free SAF vs dual-ship with Plus relay from day one?
3. **When:** spike now vs after Plus/Community milestones?
4. **Framework:** native dual vs KMP vs Flutter-with-native-extensions?

---

## Source map

| Path | Role |
|---|---|
| `CLAUDE.md` | Capture OOS for plugin; non-negotiables |
| `docs/architecture.md` | Three legs; Capture external |
| `docs/capture-shortcut.md` | Inbox recipe + Sync closed-app |
| `src/pipeline/inbox.ts` | Path, stamp, drain |
| `docs/plans/2026-07-28-002-feat-ios-capture-inbox-drain-plan.md` | Inbox contract; URI rejected |
| `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md` | Companion deferred |
| `docs/ask-self-host.md` | DIY same binary |
| `docs/dev-obsidian-mcp.md` | Local REST desktop-only |
| `src/platform/askOutbox.ts`, `plus-service` outbox routes | Atom queue ≠ capture |
| GitHub #166 | Android acceptance + directions |

---

*Research synthesis from parallel investigate agents, 2026-08-07. Not a plan; not a claim.*
