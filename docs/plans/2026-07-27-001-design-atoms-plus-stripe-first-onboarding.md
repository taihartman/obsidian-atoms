# Design — Atoms Plus stripe-first onboarding (mobile-first)

**Date:** 2026-07-27  
**Status:** design locked (brainstorm) — not implemented  
**Supersedes for auth/pay UX:** paste-`sess_` happy path; dogfood-labeled Settings copy  
**Related:** #115 public launch · `plus-pricing.json` · `docs/design-handoff/atoms-plus/` · `docs/runbooks/atoms-plus-prod.md`  
**Out of scope here:** Ask/MCP (#112), model bake-off, Apple IAP product, promo engine redesign  

---

## 1. Goal

A stranger can: install plugin → **Try Plus** → email → Stripe trial (card) → return to Obsidian → **Process works**, without pasting a session token on the happy path.

Mobile-first (iOS/Android Obsidian). Desktop gets the same spine; optional deep link is polish only.

---

## 2. Decisions (locked)

| ID | Decision |
|----|----------|
| A | **Stripe-first pay** after in-app email — not “Checkout with zero plugin identity” |
| A1 | **Card required** for 14-day trial (Stripe subscription trial) |
| E2 | Plugin collects **email once**, Checkout **prefilled + locked** to that email |
| X2 | **Soft account** on Continue (session on device, `inactive`, 0 filings) before/without completed Checkout |
| H3 | CTA on **Atoms home** and **Settings → Atoms Plus** |
| Mobile | **Refresh-on-resume** is primary return path (session already on device) |
| Desktop | Optional `obsidian://` deep link after Checkout; not required for correctness |
| D1/D2 | **Second device** = magic link only (no second charge) |
| Kill | Paste-`sess_` as normal path; “dogfood” in user-facing strings |
| IAP | **Web Stripe only for v1** — plugin inside host app Obsidian; no native IAP in this design (revisit if Apple/Obsidian policy forces it) |
| Sync | Plus session is **device-local** (not vault Sync). Phone after desktop pay ⇒ magic link |
| Abuse | No filings until **Checkout webhook** success; rate-limit soft-account + magic-link |
| Mismatch | Checkout email **immutable** = plugin email; webhook grants only that account |
| Portal | Settings → **Manage billing** → Stripe Customer Portal (browser) |
| Privacy | In-product line + linked **Privacy** (and Terms) URL before/with trial |

---

## 3. Happy path (mobile-first)

```
Home "Try Atoms Plus" / Settings
        │
        ▼
   Enter email → Continue
        │
        ├─ POST create soft account + session
        ├─ Persist sess_ on device (inactive, remaining 0)
        │
        ▼
   Start free trial → Stripe Checkout (system browser)
        │  customer_email locked, metadata.email = same
        │  mode subscription + trial_period_days from plus-pricing.json
        ▼
   User completes card / trial
        │
        ▼
   Webhook checkout.session.completed
        │  grant trialing + includedFilings on that email
        ▼
   Browser return page
        │  "Return to Obsidian → Atoms will update"
        │  optional: Open Obsidian (desktop)
        │  backup: "Email me a sign-in link" if session lost
        ▼
   Obsidian resumes → auto GET /v1/me (poll 2–3×)
        │
        ▼
   Status trialing · Process uses Plus proxy · meter decrements
```

**Settings while active:** email, status (quiet — no ambient counters per mock), Refresh, Manage billing (portal), Sign out, privacy link.

---

## 4. Other paths

| Path | Behavior |
|------|----------|
| Abandon Checkout | Session remains `inactive`. Home/Settings: **Finish trial setup** → same Checkout |
| Webhook lag | After return: “Updating subscription…” + poll `/v1/me` for ~30s; manual Refresh |
| Lost session (cleared app data) | Magic link to same email → new sess_; entitlement already on server |
| Second device | Settings: email → **Send sign-in link** → open link → session on that device (exchange must write session without paste on mobile if possible; see §6) |
| Exhausted filings | Existing Monthly Limit Reached + Get More (top-up Checkout) |
| Trial end / cancel | inactive; CTA subscribe; portal if `stripeCustomerId` |
| BYOK present | Unchanged: Plus preferred when active/trialing/exhausted; free path named on offer |
| Already subscribed, new install | Email → magic link (or Continue detects active server-side and skips Checkout) |

---

## 5. Email ↔ Stripe mismatch (required)

**Rule:** The account email is chosen in the plugin. Stripe must not create a different customer identity.

Implementation intent:

1. Soft account key = `normalize(email)`.  
2. Checkout: set `customer_email` (or existing `customer` if known) and **do not** offer email edit if Stripe API allows lock; put `client_reference_id` / `metadata.atoms_email` = normalized email.  
3. Webhook: resolve account **only** by metadata / client_reference_id / locked email — never by a typed-over Checkout email if different.  
4. If Stripe returns a divergent email, **fail closed** (log + no grant) or grant only to plugin email and ignore Stripe email field for account id.

---

## 6. Magic link role (narrow)

| Use | Role |
|-----|------|
| Happy path pay | **Not** required |
| Second device / restore | **Primary** |
| Backup after pay if session gone | Return page CTA |
| Operator dogfood | Still works |

**Mobile restore UX goal:** opening the magic link should land on a page that either:

- uses a custom URL / copy-light confirmation that the **already-open** plugin can poll for (“link opened — pull to refresh”), or  
- one-tap “Copy session” only as last resort  

v1 minimum: browser shows short-lived success + “Open Obsidian and tap Refresh status”; improve deep exchange in a follow-up if paste remains painful.

---

## 7. Abuse controls

| Control | Intent |
|---------|--------|
| Filings only after paid/trial webhook | Soft account cannot Process |
| Rate-limit `POST` soft-account + magic-link | Per IP + per email (e.g. N/hour) |
| Magic token 15m one-time | Unchanged |
| Stripe card on trial | Raises cost of throwaway trials |
| Prod dogfood grants off | Already fail-closed |

Optional later: block disposable email domains; CAPTCHA if abuse appears.

---

## 8. Privacy / legal (product surface)

- Keep: captures go to Anthropic under operator account; no training claim as today.  
- Add Settings + Checkout-adjacent links: **Privacy policy** and **Terms** (hosted pages; content is human/legal, not this design).  
- Trial fine print near CTA: 14 days, then $X/mo, cancel anytime, card required — numbers from `plus-pricing.json` only.

---

## 9. Apple / IAP note

v1 charges via **Stripe in system browser**. Atoms is an Obsidian plugin (not a standalone App Store binary). Risk is lower than a dedicated IAP app but not a legal opinion — if policy changes, design swap is “store billing” behind same entitlement model (`status` / `remaining`), not a new meter.

---

## 10. API / plugin shape (intent — for later plan)

| Piece | Intent |
|-------|--------|
| `POST /v1/auth/start` (name TBD) | body `{ email }` → create/ensure soft account + session; rate-limited |
| `POST /v1/billing/checkout` | existing; requires session; kinds `start_trial` \| subscribe \| topup |
| Checkout email lock | server enforces email = session account |
| Webhook | unchanged events; grant only matched email |
| Plugin | drop paste-first UI; email → Continue → Checkout; on layout resume / interval after “awaiting payment” flag → `GET /v1/me` |
| Copy | remove dogfood labels; match design-handoff button names |

Exact routes and migrations belong in an implementation plan after this design is approved.

---

## 11. Success criteria

- [ ] New user on **phone**: Try Plus → email → Stripe trial → back to Obsidian → Process without pasting `sess_`  
- [ ] Abandon Checkout → Finish setup resumes without new email  
- [ ] Second device: magic link only; meter shared  
- [ ] Paying with a different email in Stripe cannot attach filings to the wrong account  
- [ ] Soft account alone cannot classify (401/402/inactive)  
- [ ] No user-visible “dogfood”  
- [ ] Portal opens for manage/cancel  
- [ ] Privacy + terms links present  

---

## 12. Non-goals (v1)

- Native Apple/Google IAP  
- Session sync via Obsidian Sync  
- Password accounts  
- Checkout-only with zero pre-session (rejected — harder mobile return)  
- In-plugin chat / MCP  

---

## 13. Implementation follow-up

1. Human approve this design.  
2. Claim Issue (extend #115 or new “Plus stripe-first onboarding”).  
3. `ce-plan` / implementation plan: plugin Settings + home, plus-service soft-account + email lock, return page, copy, tests, QA on test_vault + human phone smoke.  
4. Do not block public launch secrets (Resend/Stripe live) on this UX — launch can ship current flow briefly; this design is the stranger-grade UX target.

---

## 14. Open micro-details (non-blocking)

- Exact Obsidian URI scheme for desktop optional return  
- Polling intervals / backoff numbers  
- Whether “Continue” auto-opens Checkout or shows a second **Start free trial** button (recommend **one** primary after email: “Start free trial” opens Checkout immediately)
