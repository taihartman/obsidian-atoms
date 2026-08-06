# Field notes — mailing list (tryatoms.app)

**Product name (user-facing):** Field notes  
**Product:** occasional notes on a second brain in real life (capture that returns, Obsidian + Claude, how others run it). Invite their practice.  
**Voice:** [`docs/voice.md`](../voice.md) — **read before every Broadcast or welcome edit.** Skill: `.agents/skills/atoms-voice/`.  
**Plan:** `docs/plans/2026-08-05-001-feat-tryatoms-mailing-list-plan.md`  
**Endpoint:** `POST https://tryatoms.app/api/subscribe` (Pages Function)  
**Unsubscribe:** `GET /api/unsubscribe?e=&t=` (HMAC; linked from welcome)

## One-time Resend setup

1. Resend dashboard → **Audience / Segments** → create segment **Atoms Notes**.
2. Copy segment id → Pages secret `RESEND_MARKETING_SEGMENT_ID`.
3. Sending domain `mail.tryatoms.app` already verified for Plus.
4. Create From identity (display): `Atoms Notes <notes@mail.tryatoms.app>`  
   (Do **not** use `plus@` — that is magic-link transactional.)
5. Optional: set a real Reply-To inbox later (`ATOMS_NOTES_REPLY_TO`). Until then, welcome does not invite email replies.

## Cloudflare Pages secrets (project `tryatoms`, Production)

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Server-only Resend key (can be same account as Plus; never in static www) |
| `ATOMS_NOTES_FROM` | e.g. `Atoms Notes <notes@mail.tryatoms.app>` |
| `RESEND_MARKETING_SEGMENT_ID` | Segment id |
| `ATOMS_NOTES_POSTAL_ADDRESS` | CAN-SPAM physical address line in welcome |
| `ATOMS_NOTES_UNSUB_SECRET` | HMAC secret for unsubscribe links (random long string) |
| `ATOMS_NOTES_REPLY_TO` | Optional |
| `ATOMS_NOTES_KILL_SWITCH` | Set `1` to pause signups + welcomes (503) without touching Plus |

Dashboard: Cloudflare → Pages → tryatoms → Settings → Environment variables (Production).  
Or Wrangler: `npx wrangler pages secret put NAME --project-name=tryatoms`

## Deploy

CI: `.github/workflows/tryatoms-pages.yml` deploys `www/dist` + `www/functions`.

Manual:

```bash
npm run build:www
( cd www && npx wrangler pages deploy dist --project-name=tryatoms --branch=master )
```

## Ongoing notes (preferred: agent skill)

**You:** feed the idea in chat.  
**Agent:** skill **`field-notes`** → drafts JSON → test send → you approve → broadcast.

```bash
# secrets (example; agent usually loads RESEND from fly)
export RESEND_API_KEY=...
export ATOMS_NOTES_POSTAL_ADDRESS='Taitopia, 1029 Lyell Ave Unit #740, Rochester, NY 14606'
export RESEND_MARKETING_SEGMENT_ID='3b2147b4-a1bf-4225-91a0-e24f6c5868e2'
export ATOMS_NOTES_FROM='Field notes <notes@mail.tryatoms.app>'
export ATOMS_NOTES_REPLY_TO='taihartmandevelopment@gmail.com'

npm run field-notes:test -- --to 'you@gmail.com' --draft docs/field-notes/drafts/….json
npm run field-notes:broadcast -- --draft docs/field-notes/drafts/….json --confirm   # only after explicit yes
```

Manual Resend UI still works if you prefer; voice + HTML rules unchanged.

## Ongoing Broadcasts (manual fallback)

1. Read **`docs/voice.md`** and **`docs/field-notes-email.md`**.
2. Resend → **Broadcasts** → new → audience = **Atoms Notes** segment only (internal name).
3. Content: one concrete real-life beat + optional diagram (PNG on tryatoms) + soft CTA + feature invite.
4. Style: dark card / tint blue (match site). Or use `scripts/field-notes-send.mjs`.
5. Include `{{{RESEND_UNSUBSCRIBE_URL}}}` and postal address.
6. **Test email** on iPhone Mail + Gmail before audience send.
7. Do not send to Plus auth contacts or generic “all contacts” unless they are on this segment via signup.
8. No “use case,” no hype, no em dashes, no guilt language.

## First launch checklist

- [ ] Privacy page live with Atoms Notes section  
- [ ] Secrets set on Production  
- [ ] `curl -X POST https://tryatoms.app/api/subscribe -H 'content-type: application/json' -d '{"email":"you@…"}'`  
- [ ] Welcome arrives; unsubscribe link works  
- [ ] First use-case Broadcast drafted (e.g. wedding text → atom → calendar → recap)  
- [ ] Promote form only after first note is send-ready  

## Pause / kill

- **Pause signups:** `ATOMS_NOTES_KILL_SWITCH=1`  
- **Pause sends:** stop Broadcasts in Resend; do not disable magic-link domain  
- **Cadence fail (KD9):** if no real note in ~3 months, hide/de-emphasize form on next deploy until the next note is ready  

## Never

- Auto-add Plus checkout / magic-link users to the segment  
- Put Resend API key in `www/src` or client JS  
- Blast from `plus@` templates  
