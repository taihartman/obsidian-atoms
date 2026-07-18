# Android emulator QA — entity orbits (AtomsMobileQA)

**Date:** 2026-07-18 · **Plugin:** 0.6.25 · **Fixture:** `/sdcard/Documents/AtomsMobileQA` (reused, not recreated)

## Preflight
- Emulator `emulator-5554` ✅  
- Fixture vault AtomsMobileQA ✅ (no `pm clear`)  
- Plugin pushed in place ✅  
- No hub at start ✅  

## Flow (mobile only)
1. Open vault → **Atoms** home (`workspace` / ribbon)  
2. Saw **Make Yosemite Packing?** (3 notes)  
3. Tapped **Create** → hub `Yosemite Packing.md` written  
4. Home showed **Together · Yosemite Packing**  
5. **Open** → atom with **Also about Yosemite Packing · 2**  
6. Tap strip → sibling list (2 peers + body note)

## Screenshots
- `docs/qa/screenshots/entity-orbits-mobile/43-make-yosemite-invite.png`  
- `docs/qa/screenshots/entity-orbits-mobile/44-together-after-create.png`  
- `docs/qa/screenshots/entity-orbits-mobile/45-also-about-open.png`  
- `docs/qa/screenshots/entity-orbits-mobile/46-sibling-list.png`  

## Verdict
**Pass** on Android emulator for invite → Create → Together → Also about → siblings.
