# Settings screen grounding inventory — obsidian-atoms

Source: `src/settings/settings.ts` (1511 lines). `grep -n '\.setName('` finds 49 call sites total; one of them (line 109) is the generic body of the `settingHeading()` helper itself — it renders section-heading rows, not user-configurable settings, and is invoked at the 11 lines below to produce section names. The remaining **48** call sites are catalogued as settings rows.

Section headings (`settingHeading(containerEl, name)` calls, in file order):

| Line | Section name |
|---|---|
| 158 | Atoms *(top-level tab heading, not a section)* |
| 270 | Atoms Plus |
| 653 | Capture |
| 729 | Your API key (optional) |
| 806 | Auto-run (this device) |
| 892 | Filing *(function is `renderModelSection`, heading text is "Filing")* |
| 988 | Tag vocabulary |
| 1044 | Proposed (approve to activate) *(subsection of Tag vocabulary, rendered only when `proposedTags.length > 0`)* |
| 1076 | Found in your vault *(subsection of Tag vocabulary)* |
| 1115 | Ask (Claude + ChatGPT) |
| 1416 | Advanced |

`DEFAULT_SETTINGS` lives in `src/shared/types.ts:188-220`, typed as `LinkerSettings` (`src/shared/types.ts:132-186`).

## Settings inventory

| Line | Section | `setName` (verbatim) | `setDesc` (verbatim / first sentence) | Settings key | Default + source |
|---|---|---|---|---|---|
| 226 | Atoms Plus *(rendered via `renderPlusRefreshOutcome`, called at line 271 — this row's code lives textually earlier in the file than the "Atoms Plus" heading at line 270 because the private method is defined before `renderPlusSection`; attributed here by render order, not raw line order)* | `view.title` (dynamic — e.g. "Refresh status") | `view.detail` (dynamic, from `plusRefreshPresentation(record)`) | none | Display-only; surfaced only when `plusRefreshRowRecord(this.app)` has a stale/failed refresh record (device-local). |
| 279 | Atoms Plus | "Monthly Limit Reached" | "You've used this month's included AI filings. Your allotment starts over on your next billing date." | none | Display-only; shown only when `auth.mode === "plus" && auth.status === "exhausted"` (plan-tier/entitlement gate). |
| 335 | Atoms Plus | "Refresh status" | "After Checkout or top-up, pull the latest plan from the Plus service." | none | Action button → `refreshPlusEntitlement()`. Only in the exhausted branch. |
| 343 | Atoms Plus | "Account" | `session.email` (dynamic) | none | Display of `PlusSession.email` (device-local via `readPlusSession`). Only if `session?.email`. |
| 347 | Atoms Plus | "Sign out" | "Remove Plus session from this device only." | none | Action button → `clearPlusSession(this.app)`. |
| 373 | Atoms Plus | "Status" | dynamic, e.g. `Active · Trial · 12 filings left` | none | Display of `PlusSession.status`/`remaining`. Only in the active-plan branch. |
| 378 | Atoms Plus | "Account" | `auth.email` (dynamic) | none | Display only. |
| 381 | Atoms Plus | "Plan" | dynamic renewal date, or "Monthly or yearly — see Manage Subscription" | none | Display only. |
| 388 | Atoms Plus | "Manage" | *(no `setDesc` call)* | none | Action button → Manage Subscription (billing portal). |
| 433 | Atoms Plus | "Finish trial setup" | dynamic, e.g. `{email} — complete Stripe checkout (card for 14-day trial). Return here and status updates automatically.` | none | Action button. Only when `hasPlusSetupSession(session) && session?.status === "inactive"`. |
| 450 | Atoms Plus | "Refresh status" | "After checkout, pull the latest plan (or wait for auto-update)." | none | Action button, soft-session branch. |
| 454 | Atoms Plus | "Sign out" | "Remove Plus setup from this device." | none | Action button, soft-session branch. |
| 473 | Atoms Plus | "Skip the API Key" | "Atoms Plus files your captures for you. Or keep using your own key." | none | Action button opens `ATOMS_SITE_URL`. Signed-out branch. |
| 484 | Atoms Plus | "Email" | "Start a free trial (card required). Checkout opens in your browser — then return to Obsidian." | none | Text value is read directly off the DOM (`input[data-plus-email]`), not bound to a `LinkerSettings` field; used once to call `startPlusAccount`. |
| 529 | Atoms Plus | "Sign in on another device" | "Already subscribed? Email a one-time link. Open it, then Refresh status here." | none | Same pattern as 484 — DOM-read value, not persisted. |
| 554 | Atoms Plus | "Advanced: paste session" | "Only if Refresh status does not work after the sign-in link." | none | On save, writes a `PlusSession` to device-local storage via `writePlusSession` (not a `LinkerSettings`/`data.json` field). |
| 662 | Capture | "Daily capture format" | "Write top-level bullets in your daily note: “- thought…”. Today's note is never auto-processed…" | none | Pure informational row — no `addText`/`addToggle`/`addButton` at all. |
| 668 | Capture | "iCloud shortcut link" | "Paste the iCloud share link from Shortcuts (Share → Copy iCloud Link). Syncs with the vault." | `captureShortcutInstallUrl` | Default `""` — `DEFAULT_SETTINGS.captureShortcutInstallUrl` (`src/shared/types.ts:213`). Synced via `data.json`. |
| 683 | Capture | "Capture Atom shortcut" | dynamic — install/update copy with ack state when a URL is set, else "No link yet…" | reads `captureShortcutInstallUrl` | Writes an install-ack to `localStorage` via `writeShortcutAck`, keyed by `CAPTURE_SHORTCUT_VERSION` — device-local, not a `LinkerSettings` field. |
| 719 | Capture | "Open today's daily" | "Jump to (or create) today's Daily Notes file — does not process it." | none | Action button only. |
| 736 | Your API key (optional) | "Anthropic API key" | "SecretStorage on this vault + device only (not synced). Switching vaults or clearing app data … drops the key." | `apiKeySecretId` | Default `""` — `DEFAULT_SETTINGS.apiKeySecretId` (`types.ts:189`). Stores the SecretStorage **id/name** only; the key value itself lives in Obsidian SecretStorage. `API_KEY_SECRET_ID_DEFAULT = "atoms-anthropic-api-key"` (`types.ts:223`) is shown only as an example tip (line 800), not written as a default. |
| 750 | Your API key (optional) | "Test connection" | "Checks whether Obsidian can reach the internet and the Anthropic API from this device." | none | Action button → `plugin.runTestConnection()`. |
| 761 | Your API key (optional) | "Device-local key fallback" | "Only if SecretStorage fails: non-synced local storage (still never data.json)." | `useDeviceLocalKeyFallback` | Default `false` — `DEFAULT_SETTINGS.useDeviceLocalKeyFallback` (`types.ts:212`). Turning off also clears `LOCAL_STORAGE_API_KEY` via `app.saveLocalStorage(…, null)`. |
| 782 | Your API key (optional) | "Device-local API key" | "This device only. Prefer SecretStorage." | none (device-local only) | Reads/writes `app.loadLocalStorage`/`saveLocalStorage(LOCAL_STORAGE_API_KEY)`, `LOCAL_STORAGE_API_KEY = "atoms-device-local-api-key"` (`types.ts:224`). Default `""`. Not part of `LinkerSettings`/`data.json`. **Rendered only when `useDeviceLocalKeyFallback === true`** (gated on another setting). |
| 817 | Auto-run (this device) | "Data egress acknowledgment" | `'I understand Atoms will send my vault title graph and each capture to the Anthropic API over TLS, unattended — when Obsidian opens, when it returns to the foreground, and when I tap "Sync everything now"…'` | device-local `LS_AUTO_RUN_EGRESS_ACK = "atoms-auto-run-egress-ack"` (`src/platform/autorun.ts:7`) | Default `false` (`load(key) === true` check). Not a `LinkerSettings` field. Turning off also force-disables "Auto-run on open" (`writeAutoRunEnabled(save, false)`). |
| 832 | Auto-run (this device) | "Auto-run on open" | dynamic: "When enabled: once per calendar day after layout + metadata are ready…" when acked, else "Enable the acknowledgment above first." | device-local `LS_AUTO_RUN_ENABLED = "atoms-auto-run-enabled"` (`autorun.ts:4`) | Default `false`. **`.setDisabled(!state.egressAcked)`** — gated behind the Data egress acknowledgment toggle. |
| 854 | Auto-run (this device) | "Sync automatically on resume" | "When you return to Obsidian, drain the inbox, apply the Ask outbox, push the mirror, and file if automatic filing is on." | device-local `LS_RESUME_ENABLED = "atoms-resume-enabled-v1"` (`src/platform/resume.ts:31`) via `plugin.getResumeEnabled()`/`setResumeEnabled()` | Default **`true`** — `readResumeEnabled()` (`resume.ts:252-256`) returns `true` unless the stored value is explicitly `false`/`"false"`. Note: this is the only Auto-run toggle that defaults on. |
| 866 | Auto-run (this device) | "Sync everything now" | "Run drain → outbox → mirror → filing now (ignores resume cooldowns)." | none | Action button → `plugin.runSyncEverythingNow()`. |
| 895 | Filing | "Model" | "Anthropic model id. Default: claude-sonnet-5." | `model` | Default `"claude-sonnet-5"` — `DEFAULT_SETTINGS.model` (`types.ts:190`). Blank input also falls back to `"claude-sonnet-5"` inline (`value.trim() || "claude-sonnet-5"`, line 902). |
| 908 | Filing | "Atom folder" | "Flat single folder for atom notes (e.g. Atoms). Paths with .. or subfolders are rejected." | `atomFolder` | Default `"Atoms"` — `DEFAULT_SETTINGS.atomFolder` (`types.ts:191`). Written through `clampAtomFolder()` (`pipeline/render.ts`) on every change. |
| 923 | Filing | "Notes considered per capture" | "How many of your existing notes each capture is compared against before Atoms picks what to link. Raise it to search more of your vault; each capture then costs a little more to file. Default 400." | `shortlistSize` | Default `400` — `DEFAULT_SETTINGS.shortlistSize` (`types.ts:194`, comment: "Mirrors `DEFAULT_SHORTLIST_K`"), matching `DEFAULT_SHORTLIST_K = 400` (`src/pipeline/context.ts:30`). Floor `MIN_SHORTLIST_K = 1` (`context.ts:33`). Clamped via `clampShortlistSize()` on every change and on blur. |
| 945 | Filing | "Also consider linked notes" | "When on, Atoms also considers notes linked from the ones a capture already matched… On by default." | `expandLinkedNotes` | Default `true` — `DEFAULT_SETTINGS.expandLinkedNotes` (`types.ts:195`); UI also inline-defaults via `!== false` check (line 951). |
| 959 | Filing | "Reconsider capture" | "Experimental. Command palette → Reconsider capture: ask again about one skipped line (noise/task marker) under the cursor. Off by default." | `enableReconsiderCapture` | Default `false` — `DEFAULT_SETTINGS.enableReconsiderCapture` (`types.ts:215`). |
| 973 | Filing | "Hub projection" | "When on, Process / Update / backfill write a managed section at the end of person hub notes listing linked atoms under your existing headings… Off by default." | `enableHubProjection` | Default `false` — `DEFAULT_SETTINGS.enableHubProjection` (`types.ts:216`). |
| 1000 | Tag vocabulary | `` `#${tag}` `` (looped, one row per entry in `activeVocabulary`) | "Active — eligible for classification" (static per row) | `activeVocabulary` | Default: 13-item array `["idea","question","observation","reference","decision","person","preferences","relationship","watch","movie","show","media","list"]` — `DEFAULT_SETTINGS.activeVocabulary` (`types.ts:196-210`). Toggling off a row removes that tag via `removeActiveTag()`. |
| 1017 | Tag vocabulary | "Add custom Active tag" | "Lowercase, no # required." | writes `activeVocabulary` via `addCustomActiveTag(normalizeTag(draft))` | Text input itself is unpersisted local component state (`this.customTagDraft`), not a settings field. |
| 1047 | Proposed (approve to activate) | `` `#${tag}` `` (looped, one row per entry in `proposedTags`) | "From classify runs — not applied until approved" (static) | `proposedTags` | Default `[]` — `DEFAULT_SETTINGS.proposedTags` (`types.ts:211`). "Approve" moves the tag into `activeVocabulary` and out of `proposedTags`; "Dismiss" removes it from `proposedTags` only. **Whole subsection conditionally rendered** — only when `proposedTags.length > 0`. |
| 1096 | Found in your vault | `` `#${tag}` `` (looped, top 30 vault tags by usage count, excluding ones already active) | dynamic: `${count} use(s) — tap to promote to Active` | writes `activeVocabulary` via `addCustomActiveTag()` on "Activate" tap | No stored default — source data is live vault tag-usage counts (`aggregateTagsFromFileCaches` over `app.vault.getMarkdownFiles()`), not a setting. |
| 1136 | Ask (Claude + ChatGPT) | "Privacy acknowledgment" | "I understand: (1) only Atoms/ leaves this device; (2) bodies are stored on Atoms Plus servers; (3) the host can decrypt at rest in v1 (not zero-knowledge); (4) when I chat in Claude, Anthropic receives tool results (titles, snippets, bodies); when I chat in ChatGPT, OpenAI receives them; (5) with Allow filing, Claude or ChatGPT can queue new atom bodies to Plus until Obsidian writes them under Atoms/; (6) Wipe deletes the cloud mirror, pending outbox writes, and connector tokens; (7) turning Ask off does not wipe." | `askPrivacyAckAt` | Default `""` — `DEFAULT_SETTINGS.askPrivacyAckAt` (`types.ts:218`); set to `new Date().toISOString()` when acked. Turning off force-disables "Enable Ask mirror" too. |
| 1152 | Ask (Claude + ChatGPT) | "Enable Ask mirror" | "Keep the cloud Atoms/ copy current while Obsidian is open (vault events + Process/Update)." | `askEnabled` | Default `false` — `DEFAULT_SETTINGS.askEnabled` (`types.ts:217`). **`.setDisabled(!ack)`** — gated on Privacy acknowledgment. Turning off also clears `askWriteAckAt`. |
| 1178 | Ask (Claude + ChatGPT) | "Allow filing from Claude or ChatGPT" | "When on, this vault applies create/continue outbox items under your Atoms folder (new files only; never rewrites existing bodies). Requires Ask mirror enabled." | `askWriteAckAt` | Default `""` — `DEFAULT_SETTINGS.askWriteAckAt` (`types.ts:219`). **`.setDisabled(!ack \|\| !askEnabled)`** — gated on both Privacy acknowledgment AND Enable Ask mirror. |
| 1204 | Ask (Claude + ChatGPT) | "MCP connector URL" | "Same URL for both. Claude → Settings → Connectors → Add custom connector. ChatGPT → Settings → Apps & connectors (Developer mode) → add this URL → complete OAuth." | none | Display-only, disabled text field; value derived from `askMcpUrl(base)` where `base = plusBaseUrl \|\| DEFAULT_PLUS_BASE_URL`. |
| 1268 | Ask (Claude + ChatGPT) | "Link Claude / ChatGPT" | "Generate a short pairing code for the connector authorize page… Codes expire quickly and are secrets (do not share)." | none | Action button → `askMcpPair()`. Runtime-checks `askEnabled` on click (Notice if off) — not visually `.setDisabled`. |
| 1310 | Ask (Claude + ChatGPT) | "Sync now" | "Full refresh from this device's Atoms/ (orphans removed on Plus)." | none | Action button → `plugin.syncAskMirror({ force: true })`. |
| 1330 | Ask (Claude + ChatGPT) | "Cloud mirror status" | "Refresh server atom count (what Claude/ChatGPT can see)." | none | Action button → `askMirrorStatus()`; result written to device-local `LS_ASK_MIRROR_*` keys via `saveAskMirrorStatus`, not `LinkerSettings`. |
| 1353 | Ask (Claude + ChatGPT) | "Wipe cloud copy" | "Delete mirrored atoms, pending Ask writes (outbox), and revoke Ask connector tokens for this account. Does not delete vault files." | none directly | Destructive action behind a confirm `Modal`; on confirm calls `askMirrorWipe()` then `clearAskMirrorDeviceState()` (clears device-local Ask keys) and `plugin.saveSettings()` — no `LinkerSettings` field is visibly mutated in this handler. |
| 1401 | Ask (Claude + ChatGPT) | "Self-host Ask" | "Run plus-service yourself + Plus URL override + OAuth MCP. Opens DIY guide." | none | Action button opens external docs URL (`docs/ask-self-host.md` on GitHub). |
| 1424 | Advanced | "Plus service URL override" | dynamic: `` Empty = production ({DEFAULT_PLUS_BASE_URL}). Local: http://127.0.0.1:8787 `` | `plusBaseUrl` | Default `""` — `DEFAULT_SETTINGS.plusBaseUrl` (`types.ts:214`); empty resolves to `DEFAULT_PLUS_BASE_URL = "https://plus.tryatoms.app"` (`src/platform/plusClient.ts:836`) at every use site. |

Total rows: **48** (excludes line 109, the `settingHeading()` helper body, per the note above).

## Observations

**Pure numeric/tuning knobs with no user-visible behavior change (candidates for deletion in favor of a hardcoded value):**
- L923 "Notes considered per capture" (`shortlistSize`) is the only raw numeric input in the whole screen (`text.inputEl.type = "number"`). It changes retrieval breadth and per-capture cost but has no other UI differentiation — default 400, floor 1, reset-on-blank.

**Already conditionally hidden or gated behind a plan tier / another setting being on:**
- The entire "Atoms Plus" section is plan/entitlement-branched: mutually exclusive UI states for `exhausted`, active-plan, soft/inactive session, and signed-out (L279-L616), so effectively every row in that section is state-gated by `auth.mode`/`auth.status`/`session`.
- L782 "Device-local API key" — rendered only when `useDeviceLocalKeyFallback` (L761) is on.
- L832 "Auto-run on open" — `.setDisabled(!state.egressAcked)`, gated on L817 "Data egress acknowledgment".
- L1047 "Proposed" tag rows / subsection — rendered only when `proposedTags.length > 0`.
- L1096 "Found in your vault" tag rows — rendered only for tags not already in `activeVocabulary`, capped at top 30 by usage.
- L1152 "Enable Ask mirror" — `.setDisabled(!ack)`, gated on L1136 "Privacy acknowledgment".
- L1178 "Allow filing from Claude or ChatGPT" — `.setDisabled(!ack || !askEnabled)`, gated on both L1136 and L1152.
- The whole "Ask (Claude + ChatGPT)" section body (everything past the intro paragraph, L1126-1412) renders only when a Plus `session` exists — plan-tier gate on the entire section.
- L1268 "Link Claude / ChatGPT" checks `askEnabled` at click time (Notice fallback) rather than via `.setDisabled`.

**Settings whose name or description references a concept absent from `CONCEPTS.md`:**
- L923 "Notes considered per capture" — underlying mechanism is called "shortlist" in code (`shortlistSize`, `DEFAULT_SHORTLIST_K`, `clampShortlistSize`, `MIN_SHORTLIST_K`), but the term "shortlist" does not appear anywhere in `CONCEPTS.md`.
- L959 "Reconsider capture" — the setting name itself has no corresponding heading or body reference in `CONCEPTS.md` (checked case-insensitively; zero hits).
- L817 "Data egress acknowledgment" — "egress" does not appear in `CONCEPTS.md`. The `### Auto-run` entry (`CONCEPTS.md:48-52`) mentions "privacy ack" in passing but never defines "egress" as a term.
