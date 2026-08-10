# r/ObsidianMD — what actually ranks (2026-08-10)

## Top of past year (shape, not exact copy)

High-traction is mostly:

- Vault showcases / graphs / “I wrote a book in Obsidian”
- Official kepano / team product posts
- **Plugin launches with screenshots or short video**
- One anti-AI culture post (“AI boosterism is ruining this community”)

**Plugin flair top examples (style notes):**

| Post vibe | What works |
|---|---|
| Notebook Navigator launches | Long but concrete feature dumps + screenshots + “try it / tell me” |
| Pocket Bird | Self-deprecating (“considerably less useful”), GIF, free, fun |
| Advanced PDF Export | **Problem first** (class notes → PDF hand-in sucks) → so I built X → bullets → links |
| Journal View | Daily-note friction story → tried other plugins → built this → no migration pitch |
| Handwriting → MD | Short: “didn’t find a fit, so I made…” + community link |
| Recipes / Health.md | Personal kick + schema/screenshots + “lmk what you think” |

## Writing patterns that score

1. **Problem in plain English first** (1–3 short paras). Not a tagline.
2. **“So I built …”** once. Not a hero headline.
3. **What it does** as short bullets or a tight list. Concrete Obsidian nouns (daily notes, community plugins, command palette).
4. **Screenshot / GIF / video** almost always. Text-only launches underperform.
5. **Install path:** Community plugins → search name (and/or community.obsidian.md link).
6. **Soft close:** feedback welcome / AMA / questions in comments.
7. **Human mess is fine:** “Hey”, “Hello all”, light typos, no polished marketing cadence.
8. **AI is a landmine.** Top culture post hates boosterism. If AI is involved, understate it and lead with the job (file past captures, resurface), not “AI second brain.”

## Patterns that read as AI / get ignored

- Parallel brand pillars (“quietly / never / deliberately”)
- “Honest limits worth saying up front” (corporate FAQ voice)
- Fake specificity without a real personal beat
- Em dashes, rocket emojis, “supercharge”, “game changer”
- Landing-page structure pasted into Reddit
- Lead with pricing / Plus / promo

## Hard rule (kepano / mods)

Top post: **“If your first post is to promote your app, you will be banned.”**

Before posting Atoms:

- Account should not be brand-new with zero history in the sub.
- Prefer contributing once (comment helpfully) before a launch post if the account is cold.
- Flair **plugins** when available.
- One post; don’t spam cross-subs the same day.

## Offer / trial on Reddit

| Mechanism | Status in product |
|---|---|
| Free forever BYOK | Shipped — lead with this |
| 14-day Plus trial (card) | Shipped in Settings |
| Promo codes (N free months) | **Server exists** (`ATOMS_PLUS_PROMOS`, `POST /v1/promo`) · **no plugin redeem UI** (audit: no UI ships) |

**For this launch post:** do not center a promo code until redeem is one field in Settings. Offer:

1. Free path (BYOK) as default.
2. Optional: “Plus has a 14-day trial in Settings if you don’t want a key on your phone.”
3. Optional later: enable `ATOMS_PLUS_PROMOS=REDDIT=1` + small redeem UI, then a quiet comment (not the title).

Manual “DM me for a month” only if founder will actually grant via ops.

## Sources

- old.reddit.com/r/ObsidianMD/top/?t=year  
- old.reddit.com/r/ObsidianMD/search?q=flair:plugins&sort=top&t=year  
