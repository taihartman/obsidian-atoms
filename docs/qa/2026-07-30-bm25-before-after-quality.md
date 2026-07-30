# Before / after quality — BM25 shortlist (#186)

How to compare **your vault’s link quality** before deploy vs after.

## Two different questions

| Layer | What it measures | Mutates vault? | Cost |
|---|---|---|---|
| **A. Retrieval ceiling** | “If we re-classified this capture today, would the *right titles even be in the shortlist*?” | No (read-only) | Free |
| **B. On-disk note quality** | “Do atom files actually have better/worse links after Process / Update notes?” | Yes | API $ |

#186 is almost entirely **layer A**. Layer B only moves when you run Process (new captures) or **Update notes** (existing atoms).

## Baseline already taken (before)

Read-only run against `~/Documents/Remote Vault` on **2026-07-30**:

```bash
node scripts/analyze-vault-shortlist.mjs \
  --vault "$HOME/Documents/Remote Vault" \
  --examples 5 \
  --out docs/research/data/2026-07-30-before-bm25-remote-vault-shortlist.json
```

| | |
|---|---|
| Notes / atoms | 376 / 38 |
| Graded atoms (have resolvable links) | 25 |
| Gold links | 30 |
| Report | `docs/research/data/2026-07-30-before-bm25-remote-vault-shortlist.json` |

### Headline (layer A) — your vault today

| Selector | @40 | @100 | @400 |
|---|---|---|---|
| **alphabetical** (Plus *before* #186) | **0%** | 23% | 100%* |
| recency | 70% | 87% | 100%* |
| keyword | 80% | 87% | 100%* |
| **bodyPlusTitle** (ships in #186) | **93%** | 97% | 100%* |
| hybridBody | 97% | 97% | 100%* |

\*At this vault size, k=400 ≥ all notes, so @400 is not a real cap. The product-relevant row is **@40** (Plus cap) and **@400** only once the vault is larger than the shortlist.

**Translation:** under today’s Plus alphabetical-40, **none** of your existing gold links would even be *shown* to the model if those captures were filed again. Body scoring surfaces **28/30** of them at k=40.

Examples the free script printed (missed by alpha-40, found by body):

- Andrew / High School Musical cluster  
- Aploma nudge button → App ideas  
- Christian → My Hero Academia  

## After deploy — layer A (free, same as before)

Same command, new outfile. Diff the two JSON `rows` tables.

```bash
# After BRAT / install of 0.6.53+ and Fly plus-service deploy
node scripts/analyze-vault-shortlist.mjs \
  --vault "$HOME/Documents/Remote Vault" \
  --examples 5 \
  --out docs/research/data/2026-07-30-after-bm25-remote-vault-shortlist.json
```

**What should stay the same:** bodyPlusTitle / hybridBody numbers (selector code is the same family as the research script).  
**What changes in product:** Plus path stops using alphabetical; it uses the device’s ranked shortlist. Layer A “Plus effective” moves from the alphabetical row toward bodyPlusTitle.

Layer A alone does **not** rewrite any notes.

## After deploy — layer B (on-disk links)

Only if you want file-level before/after:

### 1. Snapshot now (before any Update notes)

Pick a small set of atoms that already have links (or that feel under-linked). Export paths + current link prose:

```bash
# Example: copy link prose from a few atoms into a scratch file you keep outside the vault
# Do this once before Update notes.
```

Or simply **git isn’t available in the vault** — use Obsidian Local History / a zip of `Atoms/` if you want a full freeze:

```bash
# Optional full freeze (your machine; not committed)
zip -r ~/Desktop/atoms-before-bm25-$(date +%Y%m%d).zip \
  "$HOME/Documents/Remote Vault/Atoms"
```

### 2. After plugin + plus-service are live

**Do not reprocess the whole vault blindly.** Prefer:

1. **New captures** for a few days → Process as usual → spot-check new atoms’ links.  
2. **Targeted Update notes** on a handful of older atoms (not bulk) → compare link prose to the zip/snapshot.

What to count by hand on the sample:

| Metric | How |
|---|---|
| Links added | titles present after that weren’t before |
| Links dropped | titles gone after |
| Same-target better reason | same `[[title]]`, clearer reason prose |
| Hallucinated / wrong | link you disagree with |

Precision matters more than raw link count (product rule: false edges destroy trust).

### 3. What *not* to expect

- Markers stay; bodies stay sacred — quality delta is **title/tags/links**, not body rewrite.  
- Prompt bottleneck (#196): even with perfect shortlist, model may still decline ~half of true links. Retrieval fix ≠ “every missing link appears.”  
- Small vault: @400 “100%” is not a win to celebrate; watch **@40** and live Process on new captures.

## Suggested minimal experiment (you)

1. **Keep** the before JSON (already written).  
2. Deploy #186 + Fly plus-service.  
3. Re-run layer A → confirm bodyPlusTitle still ~93% @40.  
4. Process **3–5 new** captures that should link into existing clusters (e.g. another Aploma / person / show note).  
5. Optionally Update notes on **3–5** older atoms from the “missed by alphabetical” examples.  
6. Side-by-side: zip before vs new link prose.

## Files

| Path | Role |
|---|---|
| `docs/research/data/2026-07-30-before-bm25-remote-vault-shortlist.json` | Layer A baseline |
| `docs/research/data/2026-07-28-remote-vault-shortlist.json` | Earlier research baseline (same story) |
| `scripts/analyze-vault-shortlist.mjs` | Read-only harness (safe on personal vault) |
