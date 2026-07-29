# Open decision — dark-mode `--faint` contrast on tryatoms.app

**Status:** investigation only. No tracked file was edited, no git write ran, nothing deployed.
**Repo:** `/Users/a515138832/StudioProjects/obsidian_plugin` (branch `master`, `www/` clean).
**Background:** `docs/qa/2026-07-28-feat-tryatoms-landing-page-qa.md` measured dark `--faint` at 4.61:1 — AA + 0.11.
**Headline:** 4.61:1 is the *best* case, not the typical case. Two live pairings already fail AA at **4.32:1**.

---

## 0. Executive summary

`--faint` is an **alpha** token (`rgba(..., 0.5)`), so its rendered contrast is a function of whatever
surface it lands on. It lands on three different dark surfaces. The QA measurement was taken against
pure black — the most flattering of the three.

| Dark surface | Where | Ratio (current) | AA 4.5 |
|---|---|---|---|
| `#000` (`--bg`) | bands, hero, footer, legal pages | **4.61** | pass, +0.11 |
| `#1c1c1e` (`--surface`) | `.file`, `.appcard` | **4.55** | pass, **+0.05** |
| `#262624` (Claude window) | `.claude-tool`, `.claude-cite` | **4.32** | **FAIL, −0.18** |
| `#2c2c2e` (`--elev`) | *no `--faint` usage today* | 4.14 | fail (latent) |

Every `--faint` consumer renders between 10.88px and 13.6px, so the WCAG large-text 3:1 allowance
**never applies** — 4.5:1 is the required floor at all 13 sites.

The stylesheet's own comment asserts the opposite of what ships:

> `www/src/styles.css:19-21` — *"Both of these clear 4.5:1 on their surfaces; the old --faint sat at
> 2.4:1 in dark and 1.8:1 in light, which put disclosure copy below the readability floor."*

That claim is false for `--faint` on `#262624`. The fix that produced the comment was measured on one
surface and generalized to "their surfaces".

---

## 1. Where `--faint` is defined

**Dark (default `:root`) — `www/src/styles.css:10-28`:**

```css
:root {
  --bg: #000;                            /* styles.css:11 */
  --surface: #1c1c1e;                    /* styles.css:12 */
  --elev: #2c2c2e;                       /* styles.css:13 */
  --label: #fff;                         /* styles.css:16 */
  /*
   * Text tiers are separated by size and weight, not by fading toward the
   * background. Both of these clear 4.5:1 on their surfaces; the old --faint
   * sat at 2.4:1 in dark and 1.8:1 in light, which put disclosure copy below
   * the readability floor.
   */
  --muted: rgba(235, 235, 245, 0.6);     /* styles.css:23 */
  --faint: rgba(235, 235, 245, 0.5);     /* styles.css:24  <-- the token in question */
}
```

**Light override — `www/src/styles.css:44-57`:**

```css
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f2f2f7;                       /* styles.css:46 */
    --surface: #fff;                     /* styles.css:47 */
    --elev: #e9e9ee;                     /* styles.css:48 */
    --label: #000;                       /* styles.css:51 */
    --muted: rgba(60, 60, 67, 0.78);     /* styles.css:52 */
    --faint: rgba(60, 60, 67, 0.74);     /* styles.css:53 */
  }
}
```

**Fourth surface, not a token.** The Claude-window mock hard-codes its chrome — it is Anthropic's
warm dark, not an Atoms token, so it is invisible to any token-level audit:

```css
.claude { background: #262624; }                        /* styles.css:357-359 */
@media (prefers-color-scheme: light) { .claude { background: #faf9f5; } }  /* styles.css:365-368 */
```

`www/dist/a/styles.d701bc8a.css` is **byte-identical** to `www/src/styles.css` (verified by `diff`);
`www/build.mjs:245` only fingerprints the filename. So `src` is safe to treat as the shipped truth.

---

## 2. Every `--faint` usage and its real dark surface

13 declarations, 5 distinct surfaces-in-practice. Surface determined by walking each consumer's
enclosing container in `www/src/index.html.tmpl` / `privacy.html.tmpl` / `terms.html.tmpl` to the
nearest ancestor that declares a `background`.

| # | Declaration | Selector | Size | Nearest bg-declaring ancestor | Dark surface | Ratio |
|---|---|---|---|---|---|---|
| 1 | `styles.css:224` | `.eyebrow` | 0.70rem / 11.2px / 600 | `.wrap` in `.band`/`.hero` → `body` `styles.css:78` | `--bg` `#000` | 4.61 |
| 2 | `styles.css:314` | `.file-name` | 0.72rem / 11.5px mono | `.file` `styles.css:296-297` `background: var(--surface)` | `--surface` `#1c1c1e` | **4.55** |
| 3 | `styles.css:349` | `.file-body .marker` | inherits 0.75rem-ish | same `.file` | `--surface` `#1c1c1e` | 4.55 (dead — see note) |
| 4 | `styles.css:414` | `.claude-tool` | 0.70rem / 11.2px mono | `.claude` `styles.css:357-359` `background: #262624` | `#262624` | **4.32 FAIL** |
| 5 | `styles.css:437` | `.claude-cite` | 0.76rem / 12.2px | `.claude` `styles.css:357-359` | `#262624` | **4.32 FAIL** |
| 6 | `styles.css:690` | `.graph-hint` | 0.72rem / 11.5px | sibling of `.graph-fig`, no bg → `body` | `--bg` `#000` | 4.61 |
| 7 | `styles.css:756` | `.pair-date` | 0.74rem / 11.8px | `.appcard` `styles.css:705-709` `background: var(--surface)` | `--surface` `#1c1c1e` | **4.55** |
| 8 | `styles.css:898` | `.stage` | 0.68rem / 10.9px / 600 | `.specimen--inline`, no bg → `body` | `--bg` `#000` | 4.61 |
| 9 | `styles.css:908` | `.caption` | 0.85rem / 13.6px | `.s-rel`/`.s-work`, no bg → `body` | `--bg` `#000` | 4.61 |
| 10 | `styles.css:971` | `.note` | 0.85rem / 13.6px | hero `.wrap`, no bg → `body` | `--bg` `#000` | 4.61 |
| 11 | `styles.css:1136` | `.fineprint` | 0.82rem / 13.1px | `.band > .wrap`, no bg → `body` | `--bg` `#000` | 4.61 |
| 12 | `styles.css:1217` | `.foot` | 0.85rem / 13.6px | `<footer class="foot">`, no bg → `body` | `--bg` `#000` | 4.61 |
| 13 | `styles.css:1265` | `.legal .updated` | 0.82rem / 13.1px | `.legal` `styles.css:1233` has no bg → `body` | `--bg` `#000` | 4.61 |

**px math:** no `font-size` is declared on `html` (`www/src/styles.css:66-68` sets only
`-webkit-text-size-adjust`), so `1rem = 16px`. `body` is 17px (`styles.css:81`) but that does not
change `rem`. Largest `--faint` text is 13.6px; WCAG large text starts at 18.66px bold / 24px regular.
**No usage qualifies for the 3:1 allowance.**

### Template sites feeding each row

- **`.eyebrow`** — 12 instances, all direct `.wrap` children in `.band`/`.hero`:
  `index.html.tmpl:76, 205, 321, 459, 525, 529, 594, 633, 670, 705, 751, 782`. None inside `.card` or `.appcard`.
- **`.file-name`** — `index.html.tmpl:255, 278, 301`, each inside `<div class="file">` (`:254, :277, :300`).
- **`.file-body .marker`** — **dead rule.** No `class="marker"` exists in any `.tmpl`, and `www/src/app.js`
  never injects one (`grep -n marker www/src/app.js` → no hits; the only "marker" string in a template
  is prose at `index.html.tmpl:675`). Listed for completeness; it is not currently a live pairing.
- **`.claude-tool`** — `index.html.tmpl:111, 136, 161, 376, 404, 431`, inside `.claude-body` inside
  `<div class="claude" role="img">` (`:104, :129, :154, :366, :394, :422`).
- **`.claude-cite`** — `index.html.tmpl:120, 145, 169, 380, 408, 435`, same `.claude` ancestors.
- **`.graph-hint`** — `index.html.tmpl:606, 613, 620`, siblings of `<figure class="graph-fig">` (no bg).
- **`.pair-date`** — `index.html.tmpl:497, 502`, inside `<div class="appcard" role="img">` (`:491`).
- **`.stage`** — `index.html.tmpl:247, 253, 270, 276, 293, 299`, inside `.specimen.specimen--inline` (`:245`).
- **`.caption`** — `index.html.tmpl:261, 284, 307, 387, 415, 442`.
- **`.note`** — `index.html.tmpl:182` (hero, under `.actions`).
- **`.fineprint`** — `index.html.tmpl:447, 659, 772, 801` are true `--faint`. `index.html.tmpl:513` and
  `:739` carry `.fineprint--legible`, which resets to `--muted` at `styles.css:1143-1146` — those two
  are **not** at risk (6.36:1).
- **`.foot`** — `index.html.tmpl:808`, `privacy.html.tmpl:123`, `terms.html.tmpl:116`. Only
  `.foot-note` (`styles.css:1209`) inherits it; `.foot nav a` resets to `--muted` at `styles.css:1227-1229`.
- **`.legal .updated`** — `privacy.html.tmpl:23`, `terms.html.tmpl:20`.

### One caveat worth naming, not leaning on

Both failing consumers live inside `<div class="claude" role="img" aria-label="…">`. A conformance
lawyer could argue WCAG 1.4.3's "part of a picture" exemption. **Do not rely on it.** The text is real
DOM text rendered at 11.2px and read by every sighted visitor; the `role="img"` is there to stop screen
readers narrating a fake chat transcript, not to opt out of legibility. `.pair-date` sits in the same
`role="img"` posture inside `.appcard` (`index.html.tmpl:491`) and is at 4.55 — also not a place to
spend the exemption.

---

## 3. Contrast arithmetic

**Method (WCAG 2.x).**

1. Composite the alpha token onto its opaque surface in gamma-encoded sRGB, per channel:
   `out = α·fg + (1−α)·bg`. (This is what the browser does for a plain `rgba()` text colour over an
   opaque background — no separate colour space, no blend mode in play here.)
2. Linearize each 8-bit channel: `c' = c/255`, then `C = c'/12.92` if `c' ≤ 0.04045`, else
   `C = ((c'+0.055)/1.055)^2.4`.
3. Relative luminance: `L = 0.2126·R + 0.7152·G + 0.0722·B`.
4. Ratio: `(L_lighter + 0.05) / (L_darker + 0.05)`.

### 3a. Worked example — the failing pair (`--faint` on `#262624`)

Composite `rgba(235, 235, 245, 0.5)` over `#262624` = `(38, 38, 36)`:

```
R = 0.5·235 + 0.5·38 = 136.5
G = 0.5·235 + 0.5·38 = 136.5
B = 0.5·245 + 0.5·36 = 140.5
```

Linearize the foreground:

```
R' = 136.5/255 = 0.535294  →  ((0.535294+0.055)/1.055)^2.4 = (0.559521)^2.4 = 0.248177
G' = same                                                                   = 0.248177
B' = 140.5/255 = 0.550980  →  ((0.550980+0.055)/1.055)^2.4 = (0.574389)^2.4 = 0.264298

L_fg = 0.2126(0.248177) + 0.7152(0.248177) + 0.0722(0.264298)
     = 0.052762 + 0.177497 + 0.019082
     = 0.249341
```

Linearize the background `#262624`:

```
R' = 38/255 = 0.149020  →  ((0.149020+0.055)/1.055)^2.4 = (0.193384)^2.4 = 0.019383
G' = same                                                                = 0.019383
B' = 36/255 = 0.141176  →  ((0.141176+0.055)/1.055)^2.4 = (0.185950)^2.4 = 0.017642

L_bg = 0.2126(0.019383) + 0.7152(0.019383) + 0.0722(0.017642)
     = 0.004121 + 0.013863 + 0.001274
     = 0.019257
```

Ratio:

```
(0.249341 + 0.05) / (0.019257 + 0.05) = 0.299341 / 0.069257 = 4.3222
```

**4.32:1 — fails AA 4.5:1 by 0.18.** At 11.2px (`.claude-tool`) and 12.2px (`.claude-cite`), the
large-text allowance does not apply.

### 3b. Same method, sanity-check against the QA number (`--faint` on `#000`)

```
composite = (0.5·235, 0.5·235, 0.5·245) = (117.5, 117.5, 122.5)
R_lin = ((117.5/255 + 0.055)/1.055)^2.4 = (0.488895)^2.4 = 0.179557   (= G_lin)
B_lin = ((122.5/255 + 0.055)/1.055)^2.4 = (0.507481)^2.4 = 0.196340
L_fg  = 0.9278(0.179557) + 0.0722(0.196340) = 0.166573 + 0.014176 = 0.180749
L_bg  = 0 (pure black)
ratio = (0.180749 + 0.05) / (0 + 0.05) = 0.230749 / 0.05 = 4.6147
```

**4.61:1** — reproduces the QA doc exactly, which confirms the method and confirms that the QA pass
measured only this one surface.

### 3c. Full matrix (verified numerically; hand arithmetic above agrees to 4 decimals)

**Dark mode.** Bold = pairing that exists in the shipped page.

| Token | on `--bg` `#000` | on `--surface` `#1c1c1e` | on `.claude` `#262624` | on `--elev` `#2c2c2e` |
|---|---|---|---|---|
| `--faint` `0.5` (current) | **4.6147** | **4.5459** | **4.3222 ✗** | 4.1415 ✗ (unused) |
| `--muted` `0.6` | **6.3638** | **5.9502** | **5.5618** | 5.2721 |
| `--label` `#fff` | 21.0000 | 17.0147 | 15.1610 | 13.9366 |

**Light mode** — for completeness; nothing here fails, and nothing here needs to change.

| Token | on `--bg` `#f2f2f7` | on `--surface` `#fff` | on `.claude` `#faf9f5` | on `--elev` `#e9e9ee` |
|---|---|---|---|---|
| `--faint` `0.74` (current) | **4.7194** | **5.0187** | **4.8756** | 4.5057 (unused, +0.006) |
| `--muted` `0.78` | 5.2607 | 5.6304 | 5.4531 | 4.9989 |

### 3d. Verdict per pairing

| Pairing | Ratio | AA 4.5 (small) | Large-text 3:1 | Verdict |
|---|---|---|---|---|
| `.claude-tool` on `#262624` | 4.3222 | **FAIL** | n/a (11.2px) | **Ship-blocking** |
| `.claude-cite` on `#262624` | 4.3222 | **FAIL** | n/a (12.2px) | **Ship-blocking** |
| `.file-name` on `--surface` | 4.5459 | pass +0.05 | n/a (11.5px) | At-risk — a 1-point surface lift breaks it |
| `.pair-date` on `--surface` | 4.5459 | pass +0.05 | n/a (11.8px) | At-risk |
| `.file-body .marker` on `--surface` | 4.5459 | pass +0.05 | n/a | At-risk, but rule is dead code |
| 9 sites on `--bg` `#000` | 4.6147 | pass +0.11 | n/a (10.9–13.6px) | At-risk — this is the floor QA already flagged |
| any future `--faint` on `--elev` | 4.1415 | **would FAIL** | n/a | Latent trap |

Nothing anywhere fails 3:1, and nothing anywhere is eligible for 3:1.

---

## 4. Recommended replacement

### 4a. Target: **≥ 5.0:1 on the worst dark surface the token can land on** (`--elev` `#2c2c2e`), not on `#000`

Why that target, stated plainly:

- **Not 4.5 "with a bit extra."** The measured spread of this one token across the four dark surfaces
  is **0.47** (4.14 → 4.61). Any value tuned to clear 4.5 on one surface fails on another. The gate has
  to be set on the darkest surface the token can reach, or it is not a gate.
- **Not AAA 7:1.** On a dark canvas, "more contrast" means "brighter", and 7:1 on `#000` requires
  ≈ `rgba(235,235,245,0.63)` — **brighter than `--muted`** (6.36:1). AAA would invert the tier order:
  the faint tier would out-shout the muted tier above it. AAA is the wrong target here for a structural
  reason, not a cost reason.
- **5.0 on `--elev` gives ~5.98 on `#000`** — a full 1.48 above the floor on the page's dominant
  surface, and ≥0.5 above it on every surface including one the token does not use yet.

### 4b. The value

```css
/* www/src/styles.css:24 — dark mode */
--faint: rgba(235, 235, 245, 0.58);
```

| Surface | Current | Proposed `0.58` | Δ |
|---|---|---|---|
| `--bg` `#000` | 4.6147 | **5.9817** | +1.37 |
| `--surface` `#1c1c1e` | 4.5459 | **5.6483** | +1.10 |
| `.claude` `#262624` | 4.3222 ✗ | **5.2967** | +0.97, now passing |
| `--elev` `#2c2c2e` | 4.1415 ✗ | **5.0310** | +0.89, latent trap closed |

Light mode needs no change (4.72–5.02 today, all passing).

### 4c. The hex, as asked — and why the hex is the wrong shape for this token

The literal answer is **`#88888e`** (that is `rgba(235,235,245,0.58)` composited over `#000`).
**Do not ship it as an opaque token.** An opaque colour cannot track its surface, so it re-breaks
exactly the pairing this is meant to fix:

| Surface | `rgba(235,235,245,0.58)` | opaque `#88888e` |
|---|---|---|
| `--bg` `#000` | 5.9817 | 5.9591 |
| `--surface` `#1c1c1e` | 5.6483 | 4.8282 |
| `.claude` `#262624` | 5.2967 | **4.3022 ✗ (still fails)** |
| `--elev` `#2c2c2e` | 5.0310 | **3.9548 ✗ (worse than today)** |

The alpha form is load-bearing: as the surface lightens, the composited text lightens with it and
partially compensates. Swapping to a hex throws that compensation away and turns a 0.47 spread into a
**2.00** spread. Keep `rgba()`.

If an opaque token is required for some other reason, it has to be **per-surface**, e.g. global
`--faint: #88888e` plus a scoped override on the foreign-brand chrome:

```css
.claude { --faint: #949499; }   /* ≈5.0:1 on #262624 */
```

That override is defensible on its own merits — `.claude` is Anthropic's surface embedded in the
Atoms palette, so it arguably *should* redeclare its own text tiers rather than inherit tokens tuned
for `#000`. But it is a second change, not a substitute for fixing the token.

### 4d. Does `0.58` still read as faint? Two different answers.

- **Against adjacent normal text (`--label` `#fff`): yes, clearly.** On `#000` the proposed faint sits
  at L=0.249 against white's L=1.0 — about a quarter of the luminance, 5.98:1 vs 21:1. It still reads
  as a quieter tier, and `styles.css:17-22` already declares that the tier separation is carried by
  **size and weight**, which is untouched (10.9–13.6px, some uppercase/600, against 17px body).
- **Against `--muted`: no. The distinction disappears.** `0.58` vs `0.60` is a two-point alpha
  difference — 5.98 vs 6.36 on `#000`, ΔL ≈ 0.019. Not perceptually separable. And this is not a
  tuning failure: the algebra says any value clearing 4.5 with real margin on `#262624` needs
  α ≥ ~0.56, and `--muted` is α 0.60. **On this palette, "accessible" and "distinct from muted" are
  mutually exclusive for a third tier.**

  So the honest follow-on recommendation: **collapse the tier.** Delete `--faint` and point its 13
  consumers at `--muted` (6.36 / 5.95 / 5.56 / 5.27 — passes everywhere with more margin than the
  0.58 patch), keeping size and weight as the only differentiator, exactly as the file's own comment
  already claims. That is a larger diff and a design call, not a contrast fix, so it belongs in its
  own issue. The `0.58` bump is the minimal correct change that unblocks AA today.

  Note that `--muted` and `--faint` do sit adjacent in the pricing band (`--muted` at `styles.css:1123,
  1129`, `--faint` at `styles.css:1136`) and in the resurface band (`.fineprint--legible` at
  `styles.css:1143` next to plain `.fineprint`). Whoever takes the collapse decision should look at
  those two spots first — they are the only places the tier difference is doing visible work.

---

## 5. Proposed guard

### 5a. Does a contrast test already exist?

**No.** `grep -rn "contrast\|luminance\|relativeLum" test/` returns nothing across all 46 test files.
The only near-hit on `4.5` is a cost figure in `test/backfill.test.ts`. There is nothing to extend —
this is a new file, not a parallel one.

### 5b. What to model it on

`test/wwwPricing.test.ts` is the existing precedent for asserting on the landing page, and its shape
should be reused:

- It is a plain `vitest` file under `test/`, so it rides `npm test` with no new tooling.
- `package.json:13` runs `"pretest": "npm run build:www"`, so `www/dist` is always fresh at test time.
- Its stated purpose (`test/wwwPricing.test.ts:1-9`) is "a price change without `npm run build:www`
  fails here, not on tryatoms.app" — the same posture we want for contrast.

One deviation: read **`www/src/styles.css`**, not `www/dist`. `dist` is byte-identical to `src`
(verified), and the tokens are authored in `src`; reading `src` makes the failure message point at the
line the author has to edit.

### 5c. The test

New file `test/wwwContrast.test.ts`. Three assertions, in order of what they protect:

**(1) Every declared pairing clears the target.** The pairing table is *declared*, not inferred — the
test cannot walk the DOM, so the surface for each consumer is written down and reviewed by a human.

```ts
const FLOOR = 4.5;   // WCAG AA, small text — hard fail
const TARGET = 5.0;  // margin gate — fails before the floor is reached

const DARK_PAIRINGS = [
  { selector: ".eyebrow",           token: "--faint", surface: "--bg" },
  { selector: ".file-name",         token: "--faint", surface: "--surface" },
  { selector: ".file-body .marker", token: "--faint", surface: "--surface" },
  { selector: ".claude-tool",       token: "--faint", surface: "#262624" },
  { selector: ".claude-cite",       token: "--faint", surface: "#262624" },
  { selector: ".graph-hint",        token: "--faint", surface: "--bg" },
  { selector: ".pair-date",         token: "--faint", surface: "--surface" },
  { selector: ".stage",             token: "--faint", surface: "--bg" },
  { selector: ".caption",           token: "--faint", surface: "--bg" },
  { selector: ".note",              token: "--faint", surface: "--bg" },
  { selector: ".fineprint",         token: "--faint", surface: "--bg" },
  { selector: ".foot",              token: "--faint", surface: "--bg" },
  { selector: ".legal .updated",    token: "--faint", surface: "--bg" },
  // --muted consumers belong here too, same table, same gate.
];
```

Token values are parsed out of `www/src/styles.css` (the `:root` block for dark, the
`@media (prefers-color-scheme: light)` block for light) rather than duplicated in the test — otherwise
the test asserts against its own copy and passes forever while the page regresses.

**(2) Coverage parity — the assertion that actually prevents the regression.** Count the
`color: var(--faint)` declarations in the stylesheet and require it to equal the number of `--faint`
rows in the table. A new consumer added without declaring the surface it sits on fails the test with a
message telling the author to add the row:

```ts
const declared = css.match(/color:\s*var\(--faint\)/g)?.length ?? 0;
expect(declared).toBe(DARK_PAIRINGS.filter(p => p.token === "--faint").length);
```

This is the piece that turns the test from a snapshot into a gate. Without it, someone adds
`.new-thing { color: var(--faint) }` on `--elev` and the suite stays green at 4.14:1.

**(3) Hard-coded surfaces are enumerated.** Assert that the set of non-token background colours in the
stylesheet (`#262624`, `#faf9f5`) is exactly the set the table knows about, so a fourth foreign-brand
surface cannot be introduced silently:

```ts
const hardcoded = new Set(css.match(/background:\s*(#[0-9a-f]{3,8})/gi) ?? []);
expect([...hardcoded].sort()).toEqual(["background: #262624", "background: #faf9f5"]);
```

**Shared helper.** `compositeOver()`, `relativeLuminance()`, `contrastRatio()` — ~25 lines, pure
functions, no DOM. Put them in the test file for now; if a second surface ever needs them, promote to
`test/helpers/contrast.ts`.

### 5d. Threshold policy

Fail at `< TARGET` (5.0), and report the FLOOR (4.5) in the failure message so the reader can tell
"lost margin" from "actually inaccessible":

```
--faint on #262624 = 4.32:1 (target 5.0, WCAG AA floor 4.5) — .claude-tool, .claude-cite
```

Gating at 5.0 rather than 4.5 is the whole point of the exercise: this token has been sitting 0.11
above the floor and shipped a 4.32 failure anyway, because 0.11 is not enough room to notice drift.

### 5e. What this guard would *not* have caught

It would not have caught the original bug on its own, because it needs the pairing table to name
`#262624` as `.claude-tool`'s surface — and a human has to write that row. Assertion (3) is what forces
that: introduce a hard-coded surface, and the test demands you account for it. Worth stating in the
test's header comment so the next author does not trust it further than it goes.

---

## 6. Next step (blocked on a claim)

This repo requires an assigned GitHub Issue + a `STATUS.md` row + a draft PR before implementation
(`docs/collab.md`, `CLAUDE.md` § Workflow). None exists for this, so this stops at the report.

When claimed, the change is small enough for the **amend lane**: two files
(`www/src/styles.css` one line, `test/wwwContrast.test.ts` new), plus a `manifest.json` /
`package.json` version bump if the landing page ships with a build. The tier-collapse question in
§4d should be a separate issue.
