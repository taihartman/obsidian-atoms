# Growth pathway — 2026-08-21

Actionable sequence from the 2026-08-21 marketing research pass. Strategy rationale and competitor evidence live in the session artifact ("Atoms Growth Plan"); the pricing and activation analysis lives in [`docs/research/2026-07-28-168-catch-up-growth-brief.md`](../research/2026-07-28-168-catch-up-growth-brief.md). This file is the checklist.

**Owner tags:** `[Tai]` human-only (accounts, dashboards, outreach, judgment calls) · `[Agent]` claimable agent work (each needs its own Issue + STATUS row + draft PR) · `[Either]`.

**Voice:** every outbound word follows [`docs/voice.md`](../voice.md). Drafts for the beats below are in [`drafts/`](drafts/). Pricing sentences stay SSOT (`plus-pricing.json`); never invent trial or price claims in a post.

---

## Phase 0 — Plumbing (this week)

Goal: stop flying blind and stop leaking installs before any announcement.

- [ ] `[Tai]` **Verify Cloudflare Web Analytics is receiving data.** #183 (2026-07-29) fixed the CSP so the beacon is allowed; the beacon itself arrives by Cloudflare edge injection, not a script tag in `www/src`. Check the Cloudflare dashboard: if tryatoms.app shows visits since 2026-07-29, done. If empty, enable auto-injection for the zone (or paste the snippet, which then needs `connect-src` review). The growth brief calls this a blocker for any pricing or campaign learning (§7).
- [ ] `[Tai]` **Record baselines** in this file or a sheet: directory downloads (obsidianstats.com/plugins/atoms), Field notes list size (Resend), Plus subscribers and trials (Stripe), tryatoms weekly visits. One row now; one row per week after each beat. Without the "before", launch week teaches nothing.
- [ ] `[Agent]` **Directory search position.** In-app search for "atoms" ranks Bonds by Zak first; `/setup` admits it ("Atoms is the second one"). Two levers, one claim: (a) manifest `description` rewrite to front-load the words people search ("atomic notes", "second brain", "daily notes") — needs a version bump per CLAUDE.md, so ride it on the next release; (b) README first screen is the directory listing page and currently opens with text plus an agents note — move one hero screenshot (from `docs/media/readme/`) above the fold and push the coding-agents line below Install. File as its own Issue.
- [ ] `[Agent]` **Privacy page "What leaves your machine" on tryatoms.** Draft in [`drafts/what-leaves-your-machine.md`](drafts/what-leaves-your-machine.md). Ship as a www-only PR after Tai edits. This page is the link we drop in every skeptical thread (HN, Reddit) instead of arguing.

## Phase 1 — Activation (weeks 2–6)

Goal: the first magic moment arrives in minutes, and the two unfiled distribution channels get filed.

- [ ] `[Either]` **Free catch-up half of #168.** The growth brief's plan: point the trial's included 150 filings backwards at the existing backlog, recent-first, full count shown up front, sample-then-proceed as the trust gate. This is product work with its own plan + doc-review lane; do not start from this file. Guard the brief's own warning: a bad catch-up at peak trust is worse than none, so link-quality credibility (2026-08-17 ideation: link "why" must quote the other note) gates the marketing push, not the code merge.
- [ ] `[Tai]` **File the Claude connectors directory submission.** Runbook: [`docs/runbooks/atoms-ask-connectors-directory.md`](../runbooks/atoms-ask-connectors-directory.md). Open items are small (privacy URL, public docs URL, listing icon). An agent can prep the assets; the submission form is yours.
- [ ] `[Tai]` **Produce the 60-second clip.** Screen capture on the demo vault (`npm run seed:demo`): messy daily note → Process → atoms, markers, graph. Honest per the dogfood rule: label it as the synthetic demo vault. This one asset serves the forum post, Reddit, creators, and the site.

## Phase 2 — Launch week (weeks 7–8, after Phase 1 lands)

Goal: the one coordinated announcement Atoms has never had. All three posts in the same week so the download burst compounds into directory ranking and obsidianstats trending.

- [ ] `[Tai]` **Forum: Share & showcase thread.** Draft: [`drafts/forum-share-showcase.md`](drafts/forum-share-showcase.md). Keep the thread alive afterwards as the de-facto changelog (the Relay pattern).
- [ ] `[Tai]` **r/ObsidianMD show-and-tell.** Draft: [`drafts/reddit-show-and-tell.md`](drafts/reddit-show-and-tell.md). Check current sidebar rules before posting. Post as yourself, first person, screenshots inline, reply to every comment for 48h.
- [ ] `[Tai]` **Discord mention** in the appropriate plugin channel, linking the forum thread. Low-key, one message.
- [ ] `[Tai]` **Field note #3: the Android app.** Atoms Capture is live on Google Play (#561) and unannounced. Skeleton: [`drafts/field-note-android.md`](drafts/field-note-android.md) — it needs your real beat; the skeleton marks where. Send via the `field-notes` skill flow (test send, then approve).
- [ ] `[Either]` **Watch and log.** obsidianstats after the burst, forum/Reddit replies, install delta vs baseline. Log in this file.

## Phase 3 — Reach (weeks 9–12)

Goal: borrow audiences that already trust someone else.

- [ ] `[Tai]` **Creator outreach, six names, one email each:** Nick Milo (LYT), Nicole van der Hoeven, Sébastien Dubois (annual plugin list), FromSergio, Danny Hatcher, Obsidian Rocks. Template: [`drafts/creator-outreach.md`](drafts/creator-outreach.md). Offer: seeded demo vault, free Plus (mint a code via `plus-promo` skill; codes redeem through Subscribe, never Start trial), and the workflow story. Ask for honesty, not coverage.
- [ ] `[Tai]` **Ness Labs "Tools for Thought" pitch.** Same template, adapted; their interview format featured Napkin, and the anti-guilt-queue framing fits. This one is a written interview, not a video.
- [ ] `[Tai]` **Show HN**, only after catch-up is live and the privacy page exists. Framing draft: [`drafts/show-hn.md`](drafts/show-hn.md). Data-ownership first, AI second. One shot; be present in comments all day.
- [ ] `[Either]` **Field note #4** from whichever beat resonated (connector listing or catch-up).

## December

- [ ] `[Tai]` **Gems of the Year nomination push:** one Field note + one line in the forum thread asking happy users to nominate Atoms. Free, official, community-normal.
- [ ] `[Either]` Revisit the annual-plan framing from the growth brief (catch-up included in annual) once catch-up has shipped.

---

## Standing rules (from the research; do not relitigate per post)

- No paid ads. No hype voice. No overclaim: never "files itself" unqualified, never "whole vault", never "zero-knowledge" (tripwires from `docs/plans/2026-07-28-002-audit-tryatoms-page-vs-product.md`).
- Every public thread gets the privacy page link, not a paragraph of defense.
- BYOK and free resurfacing stay forever; say so early in every announcement. It is the community's one accepted monetization shape.
- No invented user stories, ever. Real practice or silence (voice.md pillar 5).
- Pricing or license changes are announced loudly, never slipped (Smart Connections backlash precedent).

## Scoreboard (check weekly once Phase 0 lands)

| Signal | Source | Baseline (fill in) | Notes |
|---|---|---|---|
| Directory downloads | obsidianstats.com | | burst + post-burst floor |
| tryatoms visits | Cloudflare | | |
| Field notes list | Resend | | signups per beat; replies per note |
| Plus trials / paid / annual share | Stripe | | annual share is the money metric per growth brief |
| "atoms" search rank in-app | manual check | 2nd (behind Bonds) | target: 1st |
