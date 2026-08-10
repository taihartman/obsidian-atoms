# Product Marketing Context

**Document version:** v5  
**Last updated:** 2026-08-10  
**Status:** Draft from codebase — founders should correct gaps marked *unknown* or *inferred*.

## Product Overview
**One-liner:** Apple Notes capture speed, real Obsidian underneath — then ask your notes.  
**What it does:** Fast capture (phone shortcut / share sheet / dumps) lands in a vault you own. Atoms files past captures into plain linked notes (words stay verbatim), so you can expand them, use the graph and other plugins, and optionally Ask from Claude or ChatGPT (MCP). Not a separate notes app.  
**Product category:** Second-brain / personal knowledge tool inside Obsidian (not a notes app, not a task manager).  
**Product type:** Free open-source Obsidian plugin + optional paid hosted tier (Atoms Plus).  
**Business model:** Free forever with bring-your-own Anthropic key. Atoms Plus: $6/mo or $60/yr (150 filings/period, 14-day trial, top-ups available). Ask from Claude/ChatGPT is Plus (or self-host). Vault always stays the user’s files.

## Target Audience
**Target companies:** N/A (B2C / individual knowledge workers).  
**Decision-makers:** The person who already takes notes — usually themselves.  
**Primary use case:** Capture thoughts quickly (often on phone), have them filed and linked without folder homework, get them back when they matter.  
**Jobs to be done:**
- Get stuff out of my head without losing it forever
- Find what I already wrote without searching a pile of dailies
- Use Claude/ChatGPT on *my* notes without turning my vault into a chatbot project
**Use cases (from landing stories, not formal segments):**
- Relationships / people (remembering what matters about someone)
- Work context that would otherwise vanish into dailies
- Journaling / energy / personal threads over time
**Inferred ICP (not validated with interviews):**
- Already uses or will install Obsidian
- Captures in short dumps / daily notes / share sheet
- Phone-primary capture (walk, gym, commute)
- Wants a second brain in real life, not PKM theater
- Open to Claude/ChatGPT as a layer on notes

## Personas
B2C — skip multi-stakeholder table. Primary user = buyer.

## Problems & Pain Points
**Core problem:** You wrote it down and never found it again. Capture is easy; getting the note back when it matters is hard.  
**Why alternatives fall short:**
- Apple Notes / voice memos / paper: great intake, weak hand-back
- Raw daily notes in Obsidian: pile grows; links and resurfacing are manual
- Pointing a chatbot at raw dailies: noisy, unstructured, not trustworthy
- Task apps / streak apps: guilt and homework, not memory
**What it costs them:** Lost context with people and work; “I know I wrote that somewhere”; second-brain systems that become maintenance jobs.  
**Emotional tension:** Quiet regret, not panic. Relief when something comes back. Avoid guilt marketing.

## Competitive Landscape
**Direct:** Other Obsidian AI plugins (e.g. Copilot-style BYOK + paid managed AI; Smart Connections free/Pro). Fall short when the product is “chat on vault” rather than file → resurface → ask with verbatim bodies.  
**Secondary:** All-in AI notes (e.g. Reflect ~$10/mo). Fall short if the user wants Obsidian + plain markdown ownership.  
**Indirect:** Apple Notes, Drafts (capture), paper, “I’ll remember.” Fall short at filing and return.  
**Category claim:** Second brain inside Obsidian — notes you can ask — not a task app, not a CRM.

## Differentiation
**Key differentiators:**
- Body sacred: model files and links; never rewrites your thoughts
- Past-capture pipeline (classify → atoms → home), not live chat-on-folder as the core
- Gentle resurface (mind-change, on-this-day, connected, quiet) — stream, not guilt queue
- Ask from Claude/ChatGPT via MCP on a mirror of Atoms/
- Free BYOK forever; Plus optional for phone/key friction + hosted Ask
- Leaving is easy: plain markdown in your vault
**How we do it differently:** You only do the first step (capture). Filing and return are the product.  
**Why that’s better:** Second brain you actually use — no homework, no hype.  
**Why customers choose us:** *Inferred until we have quotes* — Obsidian-native, honest limits, quiet product, Ask path.

## Objections
| Objection | Response |
|-----------|----------|
| “I need another API key / it’s fiddly on phone” | Plus: managed filing, no key on device. Free path stays. |
| “I don’t want AI rewriting my notes” | Bodies stay verbatim. We classify and link; we don’t polish your thoughts. |
| “I already have a second-brain system” | If it already returns notes when they matter, you may not need us. If capture piles up unread, that’s the gap. |
| “Is this a task / reminder app?” | No. No due dates, streaks, or backlog guilt. Memory, not chores. |
| “Can I leave?” | Yes. Markdown in your vault. Plus is optional glue, not a lock-in vault. |
| “Community plugin / install friction” | *Open product issue:* directory listing status must match setup copy before paid acquisition. |

**Anti-persona:**
- People who want a full PKM methodology course or Zettelkasten theater
- Task/GTD power users looking for a todo system
- Users who refuse Obsidian and won’t switch
- Anyone needing enterprise multi-seat SSO first

## Switching Dynamics
**Push:** Notes pile up; search fails; chatbot-on-dailies disappoints; phone capture dies at “paste API key.”  
**Pull:** Five-second capture comes back when it matters; Ask from tools you already use; quiet product.  
**Habit:** Staying in Apple Notes / raw dailies because “good enough” and setup cost feels high.  
**Anxiety:** AI will mangle my words; another subscription; Obsidian complexity; data leaving device (Plus mirror).

## Customer Language
**How they describe the problem:**
- “You wrote it down. You never found it again.” (shipped hero — validate with real users)
- *Unknown verbatim from customers — collect via Field notes replies and support.*
**How they describe us:**
- *Unknown — collect.*
**Words to use:** second brain in real life; capture; file; resurface; Ask; your words stay yours; when it matters; Field notes; practice  
**Words to avoid:** leverage; unlock; 10x; streak; backlog; overdue; use case (deck-speak); newsletter (for Field notes); guilt CTAs; fake social proof (“join 10,000 users”); em dashes  
**Glossary:**
| Term | Meaning |
|------|---------|
| Atom | One filed note: title, links, verbatim body |
| Capture / dump | Raw intake (daily bullet, shortcut, share sheet) |
| File / classify | AI turns past captures into atoms |
| Resurface | Home gently brings atoms back |
| Ask | Query atoms from Claude/ChatGPT (Plus/MCP) |
| Field notes | Occasional maker letters — not a sales drip |
| BYOK | Bring your own Anthropic key (free path) |
| Plus | Hosted filing + Ask; optional paid |

## Brand Voice
**Tone:** Quiet confidence. Warm, plain, specific.  
**Style:** Short sentences. Periods and colons. Concrete moments over abstract KM. Honest about limits.  
**Personality:** Calm, precise, human, anti-hype, anti-guilt.  
**Authority:** `docs/voice.md` is canonical for all product-authored words.

## Proof Points
**Metrics:** *Unknown publicly.* Do not invent. GitHub stars were 0 at draft time; Field notes has 1 published letter.  
**Customers:** *Unknown — no public logos.*  
**Testimonials:** None yet. Prefer real Field notes replies over fabricated quotes.  
**Value themes:**
| Theme | Proof |
|-------|-------|
| Find it again | Product loop + landing claim (need user stories) |
| Words stay yours | Architecture + voice non-negotiable |
| Low cost of entry | Free BYOK; $6 Plus |
| Leave anytime | Plain markdown vault |

## Goals
**Business goal:** Grow people who complete capture → file → return; convert phone/key-friction users to Plus without pressuring free vault users.  
**Founder operating model:** Agent-led marketing; founder ≤30 min/week approvals. Marketing budget **~$100–200/mo** (midpoint $150, cap $200) — see `docs/marketing/operating-system.md`. Not a founder-led daily social grind.  
**Discovery home:** Reddit **r/ObsidianMD** (primary). Field notes = owned list. X = optional amplify when something ships. Obsidian forum = later if needed.  
**Conversion action (primary):** Install Atoms and get first atoms filed (activation). Secondary: Field notes subscribe; Plus trial when key friction hits.  
**Current metrics:** *Unknown* — need Resend subscriber count, Plus MRR/trials, install path mix (BRAT vs directory), activation rate.  
**Stage:** Early public launch. Product + Plus + site live. Distribution thin. Paid only after install path is truthful.

## Channels & assets (current)
| Asset | Status |
|-------|--------|
| tryatoms.app | Live |
| Setup / privacy / terms | Live |
| Field notes list + archive | Live (1 note) |
| GitHub releases | Live (rapid 0.6.x) |
| Obsidian Community directory | *Verify — setup may overclaim* |
| Social (X, LinkedIn, etc.) | None found |
| Support | GitHub Issues only |

## Open questions for founders
1. Real ICP: who has already gotten value? Any names/stories?
2. Subscriber count (Resend) and Plus trials/paid (Stripe)?
3. Community plugin listing: **listed** (founder confirmed 2026-08-10).
4. Primary goal next 90 days: users, Plus $, list growth, or learning?
5. Time budget for marketing (hrs/week) and $ budget (likely ~$0–2K organic)?
6. Comfort with social presence vs Field-notes-only distribution?

## Changelog
*Newest first.*
- v5 (2026-08-10) — Founder story: Apple Notes capture + Obsidian power + Ask/MCP (not daily-notes-only).
- v4 (2026-08-10) — Discovery home locked: r/ObsidianMD; Field notes owned; X optional.
- v3 (2026-08-10) — Budget locked ~$100–200/mo (mid $150, cap $200).
- v2 (2026-08-10) — Goals: agent-led low-touch OS + budget bands; pointer to docs/marketing/operating-system.md.
- v1 (2026-08-10) — Initial context drafted from repo, voice.md, landing, pricing SSOT, and product constitution. Gaps marked for founder correction.
