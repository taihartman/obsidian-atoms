# Atoms marketing operating system

**For:** founders who will not run marketing as a second job.  
**Model:** agents do the work · you approve in short bursts · budget buys distribution when organic is too slow.  
**Target founder time:** **≤30 minutes/week** steady state (often less). Setup weeks cost more once.

**Authority:** `docs/voice.md` · `.agents/product-marketing.md` · this file for *how we run marketing*.

---

## Honest limits

Agents can draft, research, schedule checklists, pull numbers, and stage sends.  
They should **not** auto-broadcast, auto-spend ads, or impersonate you in communities without a gate.

| Fully agent-run | Agent drafts → you yes/no | Needs you (or paid human) once |
|---|---|---|
| Research, drafts, PRs for site copy | Field notes broadcast | Community plugin listing |
| Metrics snapshot into a file | Paid creative go-live | Social account creation |
| Directory list research | “Post this reply” paste jobs | Being a real person in a thread |
| SEO / comparison page drafts | Budget changes | Bank/Stripe/Resend secrets |

If someone sells “fully autonomous marketing,” ignore them. What we build is a **dispatch desk**: work arrives ready; you tap yes.

---

## Your role (the only job description)

1. **Approve queue** — open the weekly file, answer yes/no/skip (target: 15 min).  
2. **One real sentence when asked** — a story seed for Field notes, or a reply to a real user.  
3. **Unlock money/access once** — Resend, Stripe read, directory accounts, ad accounts if we use them.

You do not write copy, design creatives, or “be on social every day.”

---

## Agent role

Any coding agent in this repo (with marketing skills loaded) is the marketer of record:

- Drafts on-voice via `atoms-voice` + marketing skills  
- Runs Field notes skill through test-send; waits for explicit broadcast approval  
- Maintains `docs/marketing/` state files  
- Never invents metrics, fake social proof, or pricing  
- Never spends or sends without the gate in this doc  

---

## North star (early stage)

**People who complete:** install → first atoms filed → something comes back.  

Secondary: Field notes list growth · Plus trials when phone/key friction hits.  

Not yet: brand campaigns, multi-platform presence, complex funnels.

---

## One-time foundation (do once, then stop)

Track in `docs/marketing/setup-checklist.md` (create when starting).

| # | Item | Who | Why |
|---|---|---|---|
| F1 | **Install path truth** — Community directory listed *or* setup/landing copy matches BRAT-only reality | Agent drafts PR; you submit listing if needed | Broken first step kills all marketing |
| F2 | **Metrics read access** — agent can read Resend segment size + Stripe Plus counts (dashboard export or API key in secrets you control) | You unlock; agent documents how | Weekly review needs numbers |
| F3 | **Product-marketing.md** corrected by founder | You skim 10 min | All skills read this |
| F4 | **Single discovery home** — pick one primary: Obsidian forum *or* one social *or* PKM newsletters | You pick; agent executes | Split presence dies at low time |
| F5 | **Welcome + list hygiene** already live | Done (tryatoms) | Keep; don’t rebuild |

Do not start paid acquisition until F1 is true.

---

## Steady-state loops (only three)

### Loop A — Weekly dispatch (15 min you)

**Cadence:** weekly (agent) · you open when notified.  
**Purpose:** one place to say yes/no.  
**Output:** `docs/marketing/queue/YYYY-MM-DD.md`

Agent each week:

1. Pull metrics (subs, Plus trials/paid if available, site notes if any).  
2. Propose **at most 3** actions for the next 7 days (drafted, not “go invent something”).  
3. Stage any copy needing approval (Field note, directory blurb, reply paste).  
4. Mark skip reasons so the queue doesn’t grow forever.

You: reply in the file or chat: `1 yes / 2 no / 3 skip`. Done.

**Stop condition:** if you ignore 3 weeks in a row, agent pauses new acquisition ideas and only maintains list health + critical fixes.

### Loop B — Field notes (rare; highest leverage owned channel)

**Cadence:** when there’s something worth saying (default aim: ~monthly, silence OK).  
**Purpose:** own audience without social treadmill.  
**Skills:** `field-notes`, `atoms-voice`, `emails` (light).

Flow (already built):

1. You drop a rough story **or** agent proposes 3 seeds from product/changelog/replies.  
2. Agent drafts JSON, art, test-send.  
3. You approve once → broadcast + publish.  
4. Agent files PR for published archive if needed.

**Your time per issue:** ~10–20 min (read + yes), not writing.

**Do not:** turn Field notes into a weekly sales drip (voice forbids it).

### Loop C — Distribution shots (batch, not daily posting)

**Cadence:** 1–2 per month when queue has capacity.  
**Purpose:** put Atoms where Obsidian/PKM people already look.

Agent-prepped packs (you paste or approve):

- Directory / marketplace listings (Obsidian community, alternative.to-style, AI directories later)  
- One-off useful posts (forum “I built…”, changelog-as-story — on voice)  
- Creator / newsletter sponsorship one-pagers when budget is on  

**Not in v1 loops:** daily Twitter, TikTok, LinkedIn grind. Revisit only if Loop A shows organic discovery is the bottleneck *and* F1 is done.

---

## Budget (how money replaces your hours)

You said budget is available. Use it to buy **distribution and hands**, not dashboards.

### Locked budget (founder choice 2026-08-10)

**~$100–200 / month.** Treat **$150** as the planning midpoint. Hard cap **$200/mo** unless you raise it in writing.

At this level money is a **spice**, not a growth engine. Most lift still comes from agent-run organic (Field notes, install path, directories). Spend only on things that put Atoms in front of people who already care about notes/Obsidian/PKM.

| Use of $100–200 | When | Notes |
|---|---|---|
| **1× small newsletter / roundup sponsor** | After F1 (install truth) | Prefer Obsidian/PKM/AI-notes lists; one shot/mo beats thin daily ads |
| **Directory / launch listing fees** | As needed | One-time; come out of the monthly pot |
| **Art help for a Field note** (optional) | When a letter needs better figures | Skip if agent art is good enough |
| **Tools** | Only if required | Prefer free tier; don’t spend the whole pot on SaaS |

**Do not** at $100–200: Meta/Google always-on, agencies, multi-platform social managers, “growth retainers.”

**Default until F1 + first weekly queues work:** $0 paid. Then first paid experiment ≤$200 with a written brief + kill date.

### Higher bands (only if you raise budget later)

| Band | $/mo | What it buys |
|---|---|---|
| **B · Push** | $500–2,000 | 1–2 real sponsors/mo + light contractor hours |
| **C · Experiment** | $2,000–5,000 | Serious sponsorship + controlled paid tests after tracking |

Paid social before Community listing + clean install is lighting money on fire.

### What we will not spend on early

- Broad Meta/TikTok without a tight Obsidian/PKM angle and landing proof  
- Rebrand / agency retainers  
- Fake engagement  
- Tools that only produce reports nobody reads  

### Spend gate

Every paid action: agent writes a 5-line brief (goal, audience, cap $, success metric, kill date) → you reply **approve / reject**. No evergreen blank check.

---

## Automation map (build order)

Only build automation that removes a repeated human step.

| Priority | Automation | Status |
|---|---|---|
| 1 | Field notes: draft → test → approve → broadcast | **Exists** (`field-notes` skill + scripts) |
| 2 | Weekly queue file + metrics stub | **Define in ops** — agent runs on request or schedule |
| 3 | Metrics: Resend count + Stripe Plus snapshot script | **To build** when you grant read access |
| 4 | Directory submission tracker | Spreadsheet/md checklist agent maintains |
| 5 | Optional: contractor brief generator from queue | Later |
| 6 | Paid ads creative loop | Only after Band B+ and F1 |

Scheduling options later: cron + agent prompt, or you message “run weekly marketing” once a week (good enough).

---

## What “tell me what to do” looks like

When you open chat and say **“marketing”** or **“weekly marketing”**, the agent should:

1. Read this file + `product-marketing.md` + latest queue.  
2. Produce or update the weekly queue (≤3 items).  
3. Do all draft work in-repo.  
4. End with a short **You do** list (copy-paste actions only).

Example **You do** list:

```text
1. Reply YES to Field notes test in your inbox (or request changes).
2. Paste this paragraph into Obsidian forum thread X (link).
3. Approve $400 sponsorship brief in docs/marketing/spend/….md
```

If the list is empty, marketing is healthy — do nothing.

---

## 90-day sequence (lazy path)

| Weeks | Focus | Your involvement |
|---|---|---|
| 1–2 | F1 install truth · F2 metrics · correct product-marketing · first weekly queue | Setup answers + listing submit if needed |
| 3–6 | Field notes #2 · directory pack · install/onboarding copy fixes as PRs | Approvals only |
| 7–10 | First paid test (newsletter sponsor) if Band A/B chosen · learn | One approve + read results |
| 11–12 | Keep / kill channels · update product-marketing with real language | 30 min review |

---

## Kill criteria

Stop or cut a channel if after a fair test:

- No installs or list signups attributable, **or**  
- It needs weekly creative from you, **or**  
- It fights `docs/voice.md` (guilt, hype, fake proof)

---

## File layout

```text
docs/marketing/
  operating-system.md          ← this file
  state.json                   ← desk SSOT (metrics, queue, foundation, budget)
  desk/index.html              ← generated UI (npm run marketing-desk)
  desk/README.md               ← how to open / agent ritual
  spend/                       ← paid briefs + outcomes (optional)
  learnings.md                 ← short log of what worked (optional)
.agents/product-marketing.md   ← positioning SSOT for skills
```

### Marketing desk (HTML)

Founder UI for the weekly dispatch. Not a BI tool.

```bash
npm run marketing-desk          # rebuild + open browser
npm run marketing-desk:build    # rebuild only
```

Agent updates `state.json`, rebuilds, founder opens the page and answers ≤3 items. Details: `docs/marketing/desk/README.md`.

---

## Changelog

- 2026-08-10 — v1.1 HTML marketing desk (`state.json` + `npm run marketing-desk`).
- 2026-08-10 — v1 OS for low founder time, agent-led execution, optional budget bands.
