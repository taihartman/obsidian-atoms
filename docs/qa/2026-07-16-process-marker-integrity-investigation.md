# Investigation: Process “1 failed” + wrong markers (2026-07-16)

**Lane:** debug  
**Vault:** Remote Vault (read-only inspection)  
**Plugin:** 0.6.11 · model `claude-sonnet-5`  
**Status:** root causes identified; fix not implemented (needs hard claim)

---

## What the user saw

Process finished with something like “N atoms, M markers, **1 failed**.” One capture stayed unprocessed; several other captures look “done” but their `↳ [[…]]` markers point at the **wrong** atom.

---

## Live evidence (Remote Vault)

### A. The failed capture (still unprocessed)

`Quick Notes/2026-07-16.md`:

```text
- Made reservations at the hidden Inn for Christian's bachelor party…
  (no marker)
```

- No matching atom file.
- Empty bullet `- ` also present (skipped by parser; not the failure).

### B. Dry-run re-check (CLI, 2026-07-17T02:19Z)

`atoms:dry-run-preview-include-today` on the same vault:

| Field | Result |
|---|---|
| Scanned unprocessed | **1** (Hidden Inn only) |
| Classify | **ok** |
| Verdict | atom |
| Title | `Booked the hidden Inn for Christian's bachelor party, excited for food` |

So the failure was **not** a permanent invariant/schema problem. It was a **one-shot classify miss** (transient API/network/rate-limit/invalid JSON, or a single bad completion). Process does not record which.

### C. Marker ↔ capture integrity (broken)

Parsed with current `parseCaptures` — one marker per bullet (not stacked), but titles do not match the capture body / atom body.

**2026-07-16**

| Capture (abbrev) | Marker title | Atom body for that title | Aligned? |
|---|---|---|---|
| Grok usage limits | Penfield interview | Penfield body | **NO** |
| Andrew loves HSM | Nichita loves pajamas | pajamas body | **NO** |
| Darkest Files | `Sherry is Ning friend…` (stale; **no atom file**) | — | **NO** |
| Penfield interview | Ning (alias) | Ning body | **NO** |
| Popcorn chicken | Popcorn atom | popcorn body | yes |
| Hidden Inn | *(none)* | — | failed |
| Andrew HSM joke | Andrew joke atom | joke body | yes |

**2026-07-15** — same class of bug on several bullets (e.g. periwinkle → Andrew HSM; Christian/MHA → Darkest Files alias).

Atoms themselves are mostly fine: **verbatim bodies match the captures they were created from.** The corruption is in **daily markers** (processed pointer), not atom body sacredness.

Correct atoms still exist for the mis-marked captures (Grok, Darkest, Penfield, periwinkle, MHA, pajamas, …). So creation worked at least once; markers later disagree.

---

## Root cause 1 — Silent per-capture failure (the “1 failed”)

**Where:** `src/pipeline/write.ts` (~141–144)

```ts
if (!outcome.ok) {
  failed += 1;
  continue; // reason + message discarded
}
```

- Classify failures (`rate_limit`, `server`, `offline`, `invariant`, `unknown`, …) only increment a counter.
- No entry in `WritePathReport.entries`, no Notice with the capture snippet, no `devLog` of reason in the write loop.
- User sees: `…, 1 failed` and cannot tell which line or why.
- Capture stays unmarked → **retryable** (Hidden Inn still in queue; dry-run now succeeds).

**Not the cause of wrong markers** — failed captures get no marker at all.

---

## Root cause 2 — Collision treats “wrong existing title” as success (integrity)

**Where:** `src/pipeline/render.ts` `planWrite` → `skip_existing_atom`

When the model returns `verdict: atom` with a **title that already exists** as an atom file:

1. Do **not** create a new file (protect existing body — correct for security).
2. Still append `↳ [[that title]] <!--linker-->` under **this** capture.
3. Capture is now `processed: true`.

There is **no check** that the existing atom’s body matches this capture (or is a deliberate re-process of the same claim).

### Why the model can emit a wrong existing title

Context (`buildContextUserMessage`) sends a full **Note titles** list. The prompt pushes reuse of existing titles for **links**, not for the atom’s own title — but models regularly confuse “link target” with “this note’s title,” especially with many similar person/preference titles in context.

### Proven with unit repro

`test/collision-integrity-repro.test.ts`:

1. Grok capture + existing Penfield path → `skip_existing_atom` + marker under Grok pointing at Penfield.
2. That capture is then filtered out of `unprocessedCaptures` forever — **re-Process will not fix it.**

This matches production: capture “done,” marker title is another atom, correct atom may still exist from an earlier good run.

### How you get “good atom + wrong marker” on the same capture

Likely multi-step:

1. **Run A:** classify returns a good novel title → atom created + correct marker.
2. Marker later lost or daily rewritten (Sync race, concurrent Process/Update, manual edit, conflict resolve) **or** Run A never landed the marker (modify failed after create — rarer).
3. **Run B:** capture unprocessed again; model returns an **existing** title from context; collision writes **wrong** marker; existing good atom left untouched.

Even without step 2, a **first** run that only ever collides never creates the right atom — body only lives in the daily until a good novel title is produced.

Within one batch, `existingAtoms` is updated as titles are planned — two captures getting the same title → second is collision (second body never gets its own atom).

---

## Root cause 3 — Wrong state is permanent and invisible

| Mechanism | Effect |
|---|---|
| `parseCaptures` only checks sentinel presence | Wrong `[[title]]` still counts as processed |
| No marker↔body audit | Home/library never flags misaligned markers |
| `repairMarkerTitleInDaily` (Update notes) | Retargets marker only under the bullet matching **this atom’s body**; orphan markers under other bullets keep stale titles (e.g. Sherry string under Darkest Files with no file) |
| User-facing Process summary | Counts only — no per-item failure or collision detail |

Classic **line-index drift** (top-down insert without re-resolve) produces **stacked** markers under one bullet. Production dailies show **one marker per bullet, wrong title** — so this incident is **not** primarily the pre-`d6dbeee` stack bug; bottom-up + re-resolve are in 0.6.11. Collision/wrong-title is the better fit.

---

## Root cause 4 — Observability gaps in production builds

- Write-loop failures not logged with reason (even in dev, write path doesn’t call `logClassifyOutcome`).
- `lastWriteReport` is in-memory only; gone after reload (CLI saw `null` after the user’s run).
- Collisions are counted (`N collision(s)`) but not listed (which capture → which existing title).

---

## What is *not* broken

- Verbatim body path (atom files inspected: body = capture text).
- Empty-bullet skip (`isEmptyCaptureText`).
- Bottom-up sort + `resolveCaptureEndLine` + `captureAlreadyHasMarker` (prevents classic stack drift when titles are correct).
- Hidden Inn content itself (classifies cleanly on retry).

---

## Fix direction (for a claimed issue — do not implement unclaimed)

Priority order for production safety:

1. **Collision integrity gate**  
   On `skip_existing_atom`, read existing atom body (or refuse collision without body check). If body does not match this capture (normalize whitespace), treat as **failure** or force a novel title path — **do not** mark the capture processed with a foreign title.

2. **Surface failures**  
   Push failed captures into the report: `{ captureSnippet, reason, message }`. Notice + home summary: which line failed and why. Keep `devLog` in write loop.

3. **Surface suspicious collisions**  
   Notice/home: “collision: capture X → existing Y” when body mismatch; never silent.

4. **Optional repair command**  
   Scan dailies: for each atom marker, if `[[title]]` atom body ≠ capture text → list or re-queue (strip marker / reprocess). Needed to heal Remote Vault.

5. **Prompt hardening** (secondary)  
   Explicit: “Atom title must be a **new** declarative claim for **this** capture; never reuse an existing note title as this atom’s title (use links[] for relations).”

6. **Concurrency**  
   Document: don’t run Process + Update notes + phone Sync rewrite on the same daily simultaneously; consider single-flight lock on write path.

---

## Immediate user actions (no code)

1. **Retry Process (include today)** — Hidden Inn should file now (dry-run ok).
2. **Do not trust markers** on 2026-07-15/16 for the misaligned rows; open atoms by library/search, not only from daily arrows.
3. **Manual marker fix** (human): under each capture, set `↳ [[Correct Title]] <!--linker-->` to the atom whose body equals that capture — or delete wrong markers and re-Process after a collision fix ships (today re-Process won’t touch marked lines).

---

## Reproduction artifacts

- Unit: `test/collision-integrity-repro.test.ts` (documents current collision behavior).
- CLI: `obsidian command id=atoms:dry-run-preview-include-today` → Hidden Inn ok.
- Integrity script pattern: parse daily + compare marker title atom body vs capture text (used in this investigation).

---

## Decision needed

Claim a shipping issue (e.g. **fix: collision must not attach foreign atom markers**) covering gates 1–3 above, then implement under hard claim + draft PR. Optional follow-up: vault repair command + heal Remote Vault markers under explicit human approval.
