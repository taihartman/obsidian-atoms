# STATUS — in flight

Agent radar for multiplayer work. **Update this when you claim, block, or finish.**  
Process: [`docs/collab.md`](docs/collab.md) · Issues/PRs on GitHub.

## In flight

| State | Issue | Owner | Branch | Plan | Hot files | Notes |
|---|---|---|---|---|---|---|
| In progress | #251 | tai | feat/ask-mcp-pairing | docs/plans/2026-08-04-002-feat-ask-mcp-pairing-plan.md | plus-service oauth/mirror/store, src/platform/plusClient.ts, src/settings/settings.ts | Pairing code + cookie chooser; Fly before plugin |

## How to claim (copy)

1. Create/assign GitHub Issue  
2. `git checkout master && git pull && git checkout -b feat/<name>`  
3. Add a row above (State = `In progress`)  
4. Push branch and open **draft** PR  
5. Only then implement  

States: `Queued` · `In progress` · `Blocked` · `In review` · `Done` (then remove row)

## Recently merged (optional, last ~5)

| Merged | Issue / PR | Summary |
|---|---|---|
| 2026-08-04 | #246 / #247 | Ask coordinator peel + wire the inert confirm-withdrawal hook · **0.6.65** (released) |
| 2026-08-04 | #248 / #249 | Mirror completeness floor counts surviving evidence, not raw scan · **0.6.64** |
| 2026-08-04 | #225 / #226 | Gate mirror deletion, fix outbox ack, verify marker placement · **0.6.63** |
| 2026-08-04 | #243 / #244 | Classify dual-surface parity freeze + people hard-rules line · **0.6.63** |
| 2026-08-02 | #230 / #231 | Production trial checkout no longer revokes the plugin session; a rejected session is never a dead end · **0.6.62** |
| 2026-08-01 | #224 #227 / #228 | Person invites name model-identified people, not the leading verb · **0.6.61** |
| 2026-07-30 | #196 / #218 | Classify prompt same-thread link soften + quality 7 · **0.6.57** |
| 2026-07-30 | #186 / #187 | BM25 body-scored shortlists for classify context · **0.6.53** |
| 2026-07-30 | #206 / #207 | tryatoms Obsidian on-ramp for newcomers (install step 1 + hero link) |
| 2026-07-29 | #194 / #195 | Ask MCP Bar B — `atoms:write` scope + Claude directory pack (Fly already live) |
| 2026-07-29 | #188 / #189 | Ask MCP dual-era 2026-07-28 + OAuth `iss` + Claude JSON Accept fix (Fly already live) |
| 2026-07-29 | #184 | Capture Shortcut link refreshed + renamed **Capture Atom** everywhere · **0.6.51** |
| 2026-07-29 | #182 / #183 | Cloudflare Web Analytics through the tryatoms.app CSP + corrected privacy claims |
| 2026-07-28 | #181 | Verified iOS Shortcut link + the recipe that actually works · 0.6.50 (shipped in 0.6.51) |
| 2026-07-28 | #56 / #167 | iOS capture inbox + drain into dailies · **0.6.49** |
| 2026-07-28 | #174 / #175 | Community review lint (styles, confirm, types) · **0.6.47** |
| 2026-07-28 | #115 | Plus public launch ops — tryatoms domain, Resend, Stripe **live** on Fly |
| 2026-07-28 | #150 / #152 | Ask MCP unmisreadable shapes (revision status, snippet authority, scope) |
| 2026-07-27 | #120 / #146 | DIY Ask self-host guide (`docs/ask-self-host.md`) |
| 2026-07-27 | #119 / #141 | Ask ChatGPT MCP connector · **0.6.41** — Fly deploy + AE5 dogfood before BRAT |
| 2026-07-27 | #137 / #138 | Ask mirror parity (events + delete + reconcile) · **0.6.39** — Fly deploy + dogfood before BRAT release |
| 2026-07-27 | #131 #129 / #132 | Ask dogfood follow-ups · **0.6.36** |
| 2026-07-27 | #127 / #128 | Ask write path create/continue · **0.6.35** |
| 2026-07-27 | #123 / #124 | Plus stripe-first onboarding (0.6.33) |
| 2026-07-27 | #112 / #116 | Ask your brain remote MCP · release **0.6.32** |
| 2026-07-27 | #91 #107 / #92 | Atoms Plus managed filing + production backend (0.6.30) |
| 2026-07-22 | #100 / #102 | Reconsider capture (flagged) · release 0.6.27 |
| 2026-07-18 | #97 / #98 | Library row opens vault note (not in-home reader) |
| 2026-07-18 | #93 #95 / #94 | Entity orbits T0–T3 + Together Open list (0.6.26) |
| 2026-07-17 | #83 / #84 | Open atom graph command (0.6.19) |
| 2026-07-17 | #74 / #75 | ghost textButton kit + bridge chrome fix |
| 2026-07-17 | #71 / #72 | Land, then remember + drop For you label (0.6.14) |
| 2026-07-17 | #66 / #67 | collision body-gate + Process failure surface (0.6.13) |
| 2026-07-16 | #63 / #64 | library within-day created order (0.6.12) |
| 2026-07-16 | — | remove PR Closes CI; agent-checked only |
| 2026-07-16 | #53 / #54 | drop junk link reasons (0.6.10) |
| 2026-07-16 | #48 / #49 | aliases/prior as self (0.6.9) |
