# Atoms Notes — mailing list (tryatoms.app)

**Product:** rare use-case notes (capture→recall→deepen).  
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

## Ongoing Broadcasts

1. Resend → **Broadcasts** → new → audience = **Atoms Notes** segment only.
2. Content: one real use-case story + soft CTA (tryatoms / setup / Plus).
3. Include `{{{RESEND_UNSUBSCRIBE_URL}}}` and postal address.
4. **Test email** to yourself first.
5. Do not send to Plus auth contacts or generic “all contacts” unless they are on this segment via signup.

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
