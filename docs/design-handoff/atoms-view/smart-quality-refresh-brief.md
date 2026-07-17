# Smart quality refresh — product brief (Apple bar)

**Status:** design direction (not a plan yet)  
**Problem:** Filing got smarter. Libraries can hold hundreds of older atoms. Full Process-parity reclassify of everything is slow, costly, and feels like homework.  
**Bar:** The system absorbs the 800. The user never does.

Related: `update-linking.html` (v3 strip → light confirm → done), plan 015 (Process-parity Update notes), `linkQuality.ts` (local weak-reason repair).

---

## North star

When filing improves, older notes **quietly catch up in the right way** — free work free, paid work rare and justified, capture text never touched, no guilt counter.

**Wrong product:** “Update 800 notes to the newer filing quality?”  
**Right product:** “A few older links can be sharper. Refresh?” — and most of the work already happened offline, or never needed the model.

---

## Apple principles (mapped)

| Principle | Here |
|-----------|------|
| **Invisible complexity** | Never surface triage tiers, stamps, or “weak reason regex.” One calm strip. |
| **Respect attention** | No “you are 800 behind.” Counts only when small or after user opens detail. |
| **Respect money** | Local first. API only when the graph needs judgment. Cost named before spend. |
| **Trust the body** | Capture prose is sacred. Titles/links may change; say so once, simply. |
| **Progressive disclosure** | Primary: one button. Secondary: “What will change.” Never a review spreadsheet as the door. |
| **Finish feels done** | Land peak: what got sharper, not a batch log. Residual debt is silent until useful. |
| **Never auto-spend** | User initiates any API path. Local hygiene may run when they open Home or tap Refresh (still reversible, never destructive). |
| **Photos, not Disk Utility** | Optimize what they *meet again* (resurface, recents, mind-change), not reindex the vault for sport. |

---

## Product model: two clocks, one verb

Keep one user-facing verb: **Refresh** (or keep **Update** if shipping continuity matters).

Under the hood, two clocks:

1. **Polish** — local graph hygiene (weak sticker reasons, junk/self links, broken `[[targets]]` if safe). Free. Instant. Does **not** claim Process parity. Optional light stamp: `links-polished` / date — **not** a `CURRENT` bump.
2. **Refile** — same AI path as Process (title/tags/links). Costs key + time. Stamps `atoms-quality = CURRENT`. Body sacred. Cap per run (phone-first).

**Rule:** Bump `CURRENT` only when old notes are wrong without a model. Link-sticker cleanup alone must not force 800 refiles.

---

## What the user experiences

### Default (library idle, some older notes)

Secondary strip under Process wait (Process always wins the hero):

- **Title:** Filing got sharper  
- **Body (small N):** “A few older notes can use the new linking.”  
- **Body (large N):** “Older notes can use the new linking. We’ll start with the ones that matter most.”  
- **Button:** Refresh  

Never: “800 notes outdated.” Never: dollar amount on the strip.

### Confirm (light sheet — not a review product)

One breath, then act:

- What we protect: “Your original capture text stays the same.”  
- What may change: “Titles and links may improve.”  
- If API will run: “Uses your Anthropic key” + **honest scope** (“About 12 notes this pass” / “Free polish first, then optional AI”).  
- Primary: **Refresh**  
- Secondary: **Not now**  
- Tertiary (small): **What will change** → explainer, not a checklist of 800 rows.

### Running

Calm progress only: “Sharpening links…” / “3 of 12.” Snippet of current title. No token meters. Failures stay eligible; copy stays kind (“Some didn’t finish — try again when you’re free”).

### Done (land peak)

- Prefer substance over count: “Links on *Alex · gift colors* feel clearer.”  
- Or small count: “Sharpened 12 notes.”  
- If residual remains and is large: silence, or one line later — not a guilt banner.  
- Dismiss → back to For you / library.

### Large library behavior (the 800 case)

**System chooses the work.** User chooses whether to run.

Default pass order:

1. **Free polish** for everything that is clearly sticker-weak (offline).  
2. **AI refile** only a **small, ranked set** this session (same 15-class cap as today, or slightly higher on desktop).  
3. Rank for AI by product value, not age alone:  
   - notes that resurface (mind-change, on-this-day, connected)  
   - zero links / junk-only links  
   - broken targets  
   - recently opened / in Recents  
   - then oldest weak quality  

Next open of Home: strip returns only if something still worth doing remains. Library slowly converges without a migration project.

Optional later: Settings → “Refresh all with AI…” = backfill-style cost gate + Batches. Power path, not home.

---

## Intelligence honesty (do not fake smart)

| Offline can do | Offline cannot do |
|----------------|-------------------|
| Detect boilerplate reasons | Know the right missing person |
| Rewrite sticker → better template | True supersession judgment |
| Strip self/junk links | Fix wrong hub choice |
| Flag empty-link atoms for AI | Replace Process parity |

Copy must never claim “AI refreshed your whole brain” after a free polish. Prefer “Cleaned up older link wording” vs “Refiled with the same AI as filing.”

If free polish is the whole pass: land copy says so. Trust > magic.

---

## Hard constraints (constitution-aligned)

- Body sacred.  
- User-initiated API. No auto refile on vault open.  
- Process queue always outranks refresh UI.  
- Phone-first batch size; multi-session resume via stamps.  
- Hand-edited notes: v1 overwrite risk stays in confirm; soon `atoms-quality-locked` / “Keep my edits.”  
- No review spreadsheet as default door (mock v3 already settled this).

---

## What we will not ship

- “Update all 800” as the only affordance.  
- Silent multi-dollar Sonnet loops.  
- Local rewrite stamped as full `CURRENT` Process parity.  
- A Settings dashboard of quality debt.  
- Auto-run refresh.

---

## Success looks like

| Signal | Pass |
|--------|------|
| User with 800 atoms | One calm Refresh; done in one sitting for free work + a slice of AI; no homework feeling |
| Cost | Most libraries: $0 for link-sticker era; AI spend only on ranked residue |
| Trust | Body unchanged; hand-edits path exists soon after |
| Graph | Resurface and chips feel sharper on notes people actually meet |
| Copy | Matches what ran (polish vs refile) |

---

## Implementation sketch (for later `ce-plan` — not approved work)

1. **Prose round-trip** — parse atom link region → structured links → polish → `formatLinkProse` (missing today).  
2. **Triage pure module** — classify each atom: good / polishable / refile-candidate / locked.  
3. **Refresh orchestrator** — polish all free → refile top K → stamp correctly.  
4. **Home strip + confirm + land** — copy matrix for polish-only / mixed / refile-only.  
5. **Ranker** — resurface + empty links + broken targets + recents.  
6. **Lock frontmatter** — opt-out of model surfaces.  
7. **Power path** — Settings “Refresh remaining with AI” + Batches + cost modal (reuse backfill).

---

## Open decisions (need product call)

1. **Verb:** keep **Update** or rename to **Refresh**?  
2. **Free polish on Home open** vs only on button? (Recommend: only on button — still “user started it,” zero surprise file churn.)  
3. **Does free polish ever show the strip alone?** (Recommend: yes, if wording is honest and non-guilt.)  
4. **Desktop batch cap** higher than 15? (Recommend: same mental model, slightly higher cap only behind the same confirm.)  
5. **Lock control:** note menu vs frontmatter-only for v1?

---

## One-line summary

**Refresh like Photos cleans a library: free, local, and quiet first; a little AI on what you’ll meet again; never a bill for 800 stickers.**
