# Plus classify — model / effort bake-off

**Date:** 2026-07-27  
**Branch:** `feat/atoms-plus-managed-filing`  
**Method:** Offline script `plus-service/scripts/bakeoff-classify.mjs` against server-owned `classifyTemplate` + `buildClassifyPayload` (same shape as live proxy).  
**Not a prod flip.** Live default remains `claude-sonnet-5` with API effort default (`high` when `ATOMS_PLUS_EFFORT` unset).

## Setup

| Item | Value |
|---|---|
| Fixtures | 20 synthetic captures (people / media / ideas / noise / ambiguous) — not personal Remote Vault |
| Vault context | ~40 titles + person hubs Jordan/Riley + Active vocabulary (server template format) |
| Arms | sonnet-5@high · sonnet-5@low · sonnet-5@medium · opus-5@low |
| Effort wire | `ATOMS_PLUS_EFFORT` → `output_config.effort` (optional; omit = API default high) |
| $ rates | Published list USD/MTok; cache write ~1.25× input, cache read ~0.1× |
| Key | Operator Anthropic key (Fly secret) — never logged |

### Quality rubric (1–5 auto)

| Dimension | What |
|---|---|
| **schema** | Valid verdict/title/tags/proposed_tags/links |
| **verdict** | Matches gold atom vs noise (task soft-retired) |
| **title** | Declarative claim length/usefulness; empty on noise |
| **links** | Hub precision (Jordan/Riley/Sleep/Arrival/Shows) + non-boilerplate reasons |

Product quality surface = **titles + links**, not prose (body sacred).

## Summary table

| Arm | Model | Effort | Quality avg (1–5) | $/filing | Est. @$150 filings | Avg latency | Fails |
|---|---|---|---|---|---|---|---|
| **sonnet-low** | claude-sonnet-5 | low | **4.94** | **$0.00315** | **$0.47** | 3.3s | 0 |
| **sonnet-medium** | claude-sonnet-5 | medium | **4.96** | $0.00320 | $0.48 | 3.9s | 0 |
| sonnet-high (baseline) | claude-sonnet-5 | high | 4.94 | $0.00349 | $0.52 | 3.1s | 0 |
| opus-low | claude-opus-5 | low | 4.89 | $0.01678 | $2.52 | 4.8s | 0 |

### Token totals (20 filings each)

| Arm | input | output | cache_write | cache_read |
|---|---:|---:|---:|---:|
| sonnet-high | 1,046 | **2,190** | 3,580 | 68,020 |
| sonnet-low | 1,046 | **1,729** | 3,580 | 68,020 |
| sonnet-medium | 1,046 | 1,801 | 3,580 | 68,020 |
| opus-low | 1,046 | 2,011 | 3,580 | 68,020 |

Low effort cut Sonnet **output tokens ~21%** vs high (1,729 vs 2,190) with **identical** quality avg. Cache read dominates after the first cold write in each arm — production warm-cache $/filing will track the post-write rows (~$0.002–0.004 Sonnet).

### Dimension averages

| Arm | schema | verdict | title | links |
|---|---:|---:|---:|---:|
| sonnet-high | 5.00 | 5.00 | 5.00 | 4.75 |
| sonnet-low | 5.00 | 5.00 | 5.00 | 4.75 |
| sonnet-medium | 5.00 | 5.00 | 5.00 | **4.85** |
| opus-low | 5.00 | 5.00 | 5.00 | 4.55 |

**Verdict accuracy: 20/20 on every arm** (all noise golds → noise; all atom golds → atom; zero `task` emissions).

## Sample hard cases (titles only; bodies not stored)

| Fixture | sonnet-high | sonnet-low | opus-low |
|---|---|---|---|
| mind-change-sleep | Sleep debt actually compounds… → [[Sleep debt…]] | same quality link | same + “revising earlier claim” |
| riley-arrival | Riley + Arrival links | Riley + Arrival | Riley + Arrival + Movies hub |
| list-shows | Watchlist title + Shows | title only (no Shows) | title + Shows |
| noise-text-mom | noise / empty title | noise | noise |
| starbucks-pitch | atom product title | atom + App ideas | atom + App ideas |

Opus occasionally over-links (Movies hub on Arrival) — slightly **lower** link score, not higher.

## Cost vs Plus SKU

Plus includes **150 filings/period** at **$6/mo** list (`plus-pricing.json`).

| Arm | COGS @150 (this bake) | COGS share of $6 |
|---|---:|---:|
| sonnet-low | ~$0.47 | ~8% |
| sonnet-medium | ~$0.48 | ~8% |
| sonnet-high | ~$0.52 | ~9% |
| opus-low | ~$2.52 | **~42%** |

Opus-low alone leaves thin margin once Stripe fees, email, Neon, and headroom for Update-notes / retries are included. Sonnet keeps COGS comfortably under a $1–1.5 target band even if volume doubles.

## Recommendation (DEFAULT prod — do not apply without approval)

1. **Keep model: `claude-sonnet-5`.** Opus does not win quality on this classify surface and costs ~5×.
2. **Prefer effort `low` (or `medium`) over default `high`.** Quality tied / slightly better on medium links; low is cheapest with no verdict regressions. Start with **`ATOMS_PLUS_EFFORT=low`** on Fly when ready.
3. **Do not set Opus as default** for managed classify. Optional later: Opus only for a paid “max quality” path or rare hard-repair job — not the meter default.
4. **No prod flip in this change set.** Code adds optional `ATOMS_PLUS_EFFORT` only; unset behavior unchanged (API high).

### Suggested operator steps (when approved)

```bash
# After human approval only:
fly secrets set ATOMS_PLUS_EFFORT=low -a atoms-plus
# Leave ATOMS_PLUS_MODEL unset or claude-sonnet-5
```

Re-run `node plus-service/scripts/bakeoff-classify.mjs --arms=sonnet-low,sonnet-high` after any template change.

## Implementation landed (this branch)

| Change | Purpose |
|---|---|
| `plus-service/src/config.mjs` | `ATOMS_PLUS_EFFORT` getter (low\|medium\|high\|xhigh\|max) |
| `plus-service/src/anthropic.mjs` | Pass `output_config.effort` when set |
| `plus-service/scripts/bakeoff-classify.mjs` | Offline arm runner using server payload builder |
| `plus-service/test/security-meter.test.mjs` | Effort optional / invalid ignored |
| `.env.example` | Documents model + effort envs |

**Prod default not changed.**

## Raw machine output

Full scored rows (no capture bodies): `/tmp/atoms-plus-effort-bakeoff-2026-07-27T15-10-09-628Z.json` (local agent machine; not committed).

## Risks / caveats

- N=20 synthetic fixtures; not a full personal-vault dogfood. Titles are easy to score; reason prose quality is only lightly penalized (boilerplate filter).
- First filing per arm pays cache write (~$0.014 Sonnet / ~$0.076 Opus) — averages include that cold start once per arm.
- Latency noise is high (network + region); do not over-read avg ms differences between low and high.
- Model IDs `claude-sonnet-5` / `claude-opus-5` matched live Fly config at run time.

## Decision / applied

**2026-07-27 — approved and applied**

- Fly secret: `ATOMS_PLUS_EFFORT=low` (Deployed)
- Image: effort wire in `config.mjs` + `anthropic.mjs` deployed to `atoms-plus`
- Verified on machine: `buildClassifyPayload` → `output_config.effort: "low"`, model `claude-sonnet-5`
- Health: `https://atoms-plus.fly.dev/health` → `{"ok":true}`
- Model default unchanged (`claude-sonnet-5`)
