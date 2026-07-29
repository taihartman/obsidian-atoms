# Chrono corpus story bible

Life of **Marcus Webb**, 34 → 37. Backend engineer at Northline (logistics software, Strip District office, Pittsburgh). Lives with partner **Elise Kwan** in a rented duplex half on **Oakwood Ave** in Bloomfield until mid-2024, then buys a narrow brick house on **Vine Street** in Lawrenceville. Captures are thumbed into a phone; this bible is the shared cast, names, threads, and collisions for agents E/F/G/H.

Span: 2023-01-01 → 2025-12-31. Do not invent new hub title strings outside the **Cast** table. Reuse them byte-for-byte in `linksToExisting`.

---

## 1. Cast

Exact `linksToExisting` title strings. People, places, projects, and a few recurring fixtures.

| Title string | What it is |
|---|---|
| Elise Kwan | Partner. Graphic designer at a studio in East Liberty. Moves with him to Vine. |
| Jules Webb | Younger sister. ICU nurse at UPMC. Blunt. Lives in Squirrel Hill. |
| Robert Webb | Dad. Retired millwright. Lives alone in Beaver Falls after the divorce years ago. |
| Priya Deshmukh | Manager at Northline. Direct. Owns the quarterly roadmap fights. |
| Tomás Okonkwo | Teammate / tech lead on the dispatch stack. Pair partner early 2023. |
| Wei Chen | Junior on the migration. Starts March 2023. Quiet, sharp. |
| Noah Berg | Best friend since CMU. Plays bass. Hosts Thursday jam in his Garfield basement. |
| Samira Haddad | Elise's older sister. Real-estate agent. Helps with the Vine purchase. |
| Dr. Patel | Dad's oncologist at Allegheny General. Name appears in medical-adjacent notes. |
| The duplex on Oakwood | Rented half-duplex, Bloomfield. Second-floor kitchen, shared porch. Left Aug 2024. |
| The place on Vine | Bought July 2024, move-in August. Narrow brick, Lawrenceville. Becomes home. |
| Northline | Employer. Logistics SaaS. Strip District office + hybrid. |
| Project Relay | Internal rewrite of the dispatch matching service. Marcus's main work 2023–mid-2024. |
| The kitchen | Renovation of the Vine kitchen, late 2024 into 2025. Not Oakwood. |
| Thursday jam | Noah's basement session. Loose band, no name that sticks. |
| Allegheny General | Hospital where dad is treated. |
| Beaver Falls | Dad's town / house. Weekend drives up. |
| The half marathon | Pittsburgh half, May 2024 attempt; training thread spans 2023–2024. |
| Deposit account | Joint high-yield at a local credit union. Not the apartment deposit. |

Hubs that are **places/projects** still get title-cased strings as above. Agents must not invent "Vine St" / "vine street" / "Relay v2" as alternate hub titles — those go in capture body only (see Alias table).

---

## 2. Alias table

Vocabulary drift for the same referent. Capture body uses the name active in that month. Hub titles stay fixed when a hub is linked; body language drifts so linked pairs can share **zero** content words.

| Referent (hub if any) | Name sequence (body language) | Approx. takeover |
|---|---|---|
| The place on Vine | "the lawrenceville listing" → "the vine place" / "vine" → "the new place" → "home" / "upstairs" / "our place" | listing talk Mar–Jun 2024; close Jul 2024; move Aug 2024; "home"/"upstairs" from ~Oct 2024 |
| The duplex on Oakwood | "oakwood" / "the duplex" → "the old place" → almost never named after move | through Jul 2024; "old place" Aug–Oct 2024 only |
| Project Relay | "relay" / "the rewrite" → "v2" / "the matching thing" → "the thing i've been on since spring" → "old relay" (post-ship, residual bugs) | kickoff Jan 2023; "v2" common mid-2023; ship language ~Jun 2024; residual H2 2024 |
| Elise Kwan | "elise" → "she" / "her" (deixis-heavy stretches) → still "elise" when stressed or introducing context | continuous; heavy pronoun use in short captures 2024–2025 |
| Robert Webb | "dad" → "he" (after diagnosis era) → "robert" only in logistics (appointments, forms) | diagnosis Mar 2023; "he" dominates clinical updates |
| Jules Webb | "jules" / "sis" → "she" when the prior capture already fixed the sister | continuous |
| The kitchen | "the gut" / "demo week" → "the counters" / "the backsplash fight" → "downstairs" (once living there) | demo Oct 2024; install Nov–Dec 2024; residual 2025 |
| Thursday jam | "noah's" / "basement thursday" → "jam" → "band night" → "we still do thursdays" | continuous low frequency |
| The half marathon | "the half" / "training" → "may race" → "the race i bailed on" / "that may thing" | train 2023–Apr 2024; race May 2024; aftermath naming |
| Deposit account | "the hy savings" / "credit union pot" → "the deposit" (ambiguous — see collisions) | opened early 2023 |
| Apartment / house cash hold | "security deposit" / "oakwood deposit" → "the deposit back" | refund fight around move 2024 |
| Tomás Okonkwo | "tomás" / "tomas" (no accent in phone) → "he" on the team | continuous |
| Priya Deshmukh | "priya" → "her" in roadmap rants | continuous |
| Wei Chen | "wei" / "the new kid" → "wei" only | from Mar 2023 |
| Noah Berg | "noah" → "him" on music nights | continuous |
| Dr. Patel | "patel" / "the oncologist" → "her" in dad updates | from Mar 2023 |
| Northline | "work" / "northline" / "the office" → "strip" (office days) | continuous |
| Sleep / caffeine loop (no hub) | "sleep thing" → "the 3am thing" → "not the coffee" / "it again" | flares 2023 and 2025 |

**Rule for agents:** when writing a reach-back pair meant to score as vocabulary drift, the later capture should use a **later** alias and avoid repeating the earlier capture's content nouns. Drift because something happened (move, ship, diagnosis, bail on race), not to be cute.

---

## 3. Timeline skeleton

24 threads. Six per file. Every file still spans 2023–2025; ownership is of the *thread*, not a time slice.

### Legend

- **Dark 8m+** = quiet stretch ≥ 8 months, then resume  
- **Ends** = last real mention; never again  
- **All-years** = low-frequency entire span  

### File E (prefix `E`)

| Thread | Start | Quiet | Resume | End | Notes |
|---|---|---|---|---|---|
| `relay-rewrite` | 2023-01 | 2024-07–2024-12 (post-ship lull) | 2025-01 residual on-call / regret | soft end 2025-03 | Main work arc. Ships ~2024-06. Dark stretch is real disengagement then residual bugs. **Dark ~6m then residual — pair with long quiet via sparse 2024 H2.** Prefer long reach-backs from 2025 residual → 2023 kickoff. |
| `dads-diagnosis` | 2023-03 | 2023-11–2024-08 | 2024-09 scan scare | ongoing low through 2025 | Mar 2023 diagnosis; treatment spring–fall 2023; long quiet; scare resume. **Dark 8m+.** |
| `elise-and-the-move` | 2023-02 (stay-or-buy talks) | — | — | 2024-09 post-move settle | Looking, offer, close, move. Peaks 2024-03–08. |
| `sleep-caffeine` | 2023-01 | 2023-09–2025-02 | 2025-03 | ongoing 2025 | Flares early; long dark; returns. **Dark 8m+.** **All-years** at very low rate if a few 2024 one-offs appear — prefer true dark then return. |
| `oakwood-landlord` | 2023-01 | — | — | 2024-10 | Heat, deposit, repairs, final walkthrough. **Ends** after deposit resolution. Never again. |
| `strip-office-days` | 2023-01 | — | — | — | Hybrid guilt, parking, who is actually in. **All-years** low frequency. |

### File F (prefix `F`)

| Thread | Start | Quiet | Resume | End | Notes |
|---|---|---|---|---|---|
| `kitchen-reno` | 2024-09 planning | — | — | 2025-06 punch list done | Demo, wrong gauge wire, backsplash fight, living on a hot plate. |
| `half-marathon` | 2023-04 training | 2024-06–2025-12 | never serious resume | 2024-05 race week (bailed) | Trains 2023 into 2024; bails race weekend; occasional bitter one-liner then **Ends** as a living project (may appear once as memory in another thread via contradiction only inside this thread before end). Last capture by 2024-07. |
| `thursday-jam` | 2023-01 | 2024-02–2024-11 | 2024-12 | — | Noah's basement. Life gets busy mid-move; returns. **Dark 8m+.** |
| `jules-boundary` | 2023-02 | 2023-12–2024-10 | 2024-11 holiday blowup aftermath | 2025-04 soft | Sister dynamics around dad care load. Long quiet mid. **Dark 8m+.** |
| `priya-roadmap` | 2023-01 | — | — | — | 1:1s, date pressure, "is june real". Runs whole employment span. **All-years** low-medium. |
| `credit-union-pot` | 2023-02 | 2024-01–2024-11 | 2024-12 house cash crunch memory / refinance thoughts | sparse 2025 | Savings goals vs house. Quiet mid. |

### File G (prefix `G`)

| Thread | Start | Quiet | Resume | End | Notes |
|---|---|---|---|---|---|
| `vine-house-body` | 2024-08 move-in | — | — | — | Boiler, mice, neighbor's leaf blower, upstairs creak. Continues through 2025. |
| `wei-mentoring` | 2023-03 | 2024-04–2025-01 | 2025-02 wei almost quits | 2025-06 | Onboarding → pride → neglect → repair. **Dark 8m+.** |
| `tomas-pairing` | 2023-01 | — | — | 2023-09 | Intense pairing on Relay early; Tomás rotates off. **Ends.** Never again as a living thread. |
| `beaver-falls-drives` | 2023-03 | 2024-01–2024-08 | 2024-09 | — | Weekend drives to dad. Tied to diagnosis but distinct (car, silence, the house smell). |
| `elise-studio-stress` | 2023-05 | 2024-03–2024-12 | 2025-01 | — | Her client / studio politics bleeding into evenings. Dark during house chaos. |
| `dispatch-oncall` | 2023-06 | — | — | — | Pages, bad deploys, "not my service but i'm up". Continues at low rate all three years. **All-years.** |

### File H (prefix `H`)

| Thread | Start | Quiet | Resume | End | Notes |
|---|---|---|---|---|---|
| `deposit-fight` | 2024-07 | — | — | 2024-11 | Oakwood security deposit withheld / partial return. Short brutal arc. Distinct from credit-union "deposit". |
| `samira-house-hunt` | 2024-03 | — | — | 2024-08 | Open houses, under-ask, inspection. Ends at close. |
| `band-song-that-died` | 2023-06 | 2023-11–2025-03 | 2025-04 one revisit | 2025-05 | They almost finish a song; abandon it; one later "we were right to kill it". **Dark 8m+** then brief resume then **Ends**. |
| `running-again` | 2025-04 | — | — | — | Not the half — casual loops after kitchen settles. New thread, no hub required. |
| `northline-reorg` | 2024-10 | — | — | 2025-08 | Rumors, skip-level, whether to stay. |
| `grocery-and-chores` | 2023-01 | — | — | — | Not a thought-thread for atoms — mostly **noise** carrier (milk, dentist, parking). Keep as thread label for chore captures so noise isn't fake-labeled as real threads. **All-years** noise home. |

### Dark / end / all-years checklist

| Requirement | Threads |
|---|---|
| Dark ≥ 8 months then resume | `dads-diagnosis`, `sleep-caffeine`, `thursday-jam`, `jules-boundary`, `wei-mentoring`, `band-song-that-died` (≥4) |
| End, never again | `oakwood-landlord`, `tomas-pairing` (also `half-marathon` and `deposit-fight` / `samira-house-hunt` as short closed arcs — prefer hard silence after end date) |
| All three years, low frequency | `strip-office-days`, `priya-roadmap`, `dispatch-oncall` (+ `grocery-and-chores` as noise spine) |

---

## 4. Collision list

Shared vocabulary across **unrelated** threads. Captures that share these words across the pair of threads must **not** be linked to each other. They are precision tests.

| Shared word / phrase | Thread A | Thread B | Note |
|---|---|---|---|
| `run` / `running` / `ran` | `half-marathon`, `running-again` | `relay-rewrite`, `dispatch-oncall` | Race training vs "run the migration" / "run the deploy". |
| `the deposit` / `deposit` | `deposit-fight`, `oakwood-landlord` | `credit-union-pot` | Flat security deposit vs bank/savings "deposit". |
| `home` / `the place` | `elise-and-the-move`, `vine-house-body` | `beaver-falls-drives` | Vine/Oakwood "home" vs dad's place feeling like "going home". |
| `she was right` / `she` | `elise-and-the-move`, `elise-studio-stress` | `jules-boundary`, `dads-diagnosis` (Jules or Patel) | Bare "she" is deixis within a thread — do not cross-link on gender alone. |
| `page` / `paged` | `dispatch-oncall` | `samira-house-hunt` | On-call page vs "sign the page" / paperwork page (use sparingly on B). |
| `counter` / `counters` | `kitchen-reno` | `priya-roadmap`, `relay-rewrite` | Kitchen counters vs "push back" / "counter the estimate" / counterargument. |
| `ship` / `shipping` | `relay-rewrite` | `elise-studio-stress` | Ship the service vs client shipping a deck / campaign. |
| `quiet` | `dads-diagnosis`, `beaver-falls-drives` | `thursday-jam`, `strip-office-days` | Hospital/car quiet vs empty office or no-show jam. |
| `wrong` | any contradiction pair inside one thread | do not bridge threads | "turns out i was wrong" stays inside its thread's answer key. |
| `bad night again` | `sleep-caffeine` | `thursday-jam` or `dispatch-oncall` | Near-duplicate shape: sleep vs late gig vs on-call night. **Not linked.** |
| `finally` | `kitchen-reno`, `elise-and-the-move` | `relay-rewrite` | Short capture collision — different finallys. |
| `may` | `half-marathon` (May race) | calendar noise / `priya-roadmap` ("may date") | Month vs modal; keep body ambiguous on purpose sometimes. |

---

## 5. Life spine (for authors, not a thread list)

Compressed plot so agents do not invent conflicting major events.

- **2023 Q1:** Relay kickoff under Priya; Tomás pairing heavy; sleep/coffee mess; Elise raises "are we staying in the duplex forever"; dad diagnosis March — everything tilts.  
- **2023 Q2–Q3:** Treatment drives to Beaver Falls; Jules takes more hospital hours and resents Marcus's distance; Wei joins; half-marathon training starts badly; jam still happens most Thursdays.  
- **2023 Q4:** Dad stable-ish; Tomás rotates off Relay; Marcus promises Elise they'll look at buying "next year"; training continues on paper.  
- **2024 Q1–Q2:** House hunt with Samira; Relay slip dates; Priya pressure; race week May — he doesn't start (injury or freeze — pick one and stick: **IT band + dread**); deposit savings raided for earnest money.  
- **2024 Q3:** Close on Vine July; move August; Oakwood deposit fight; kitchen still unusable plan.  
- **2024 Q4:** Kitchen demo; reorg rumors; jam goes dark; dad quiet period ends with a scare.  
- **2025:** Residual Relay regret; kitchen punch list; Wei almost leaves; Marcus runs again casually; northline stay-or-go; sleep thing returns; band song one last autopsy.

Personality for register: dry, slightly mean to himself, loyal, avoids phone calls, types fragments during walks back from the Strip garage.

---

## 6. Authoring constraints (reminders)

- `linksToEarlier` only within your file; honest semantic links only.  
- `linksToExisting` only from the Cast title strings above.  
- Hit brief §4 quotas (drift, deixis, collisions, contradictions, short+linked, hub/orphan ~50/50, noise 20%, near-dupes).  
- Mean length 95–125; ≥15% under 50 chars; ≤3% over 200; nothing over 260.  
- Burst dates; interleaved threads; no tidy self-narration.

---

## 7. File ownership summary

| File | Threads |
|---|---|
| E | `relay-rewrite`, `dads-diagnosis`, `elise-and-the-move`, `sleep-caffeine`, `oakwood-landlord`, `strip-office-days` |
| F | `kitchen-reno`, `half-marathon`, `thursday-jam`, `jules-boundary`, `priya-roadmap`, `credit-union-pot` |
| G | `vine-house-body`, `wei-mentoring`, `tomas-pairing`, `beaver-falls-drives`, `elise-studio-stress`, `dispatch-oncall` |
| H | `deposit-fight`, `samira-house-hunt`, `band-song-that-died`, `running-again`, `northline-reorg`, `grocery-and-chores` |
