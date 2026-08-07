# Play Store assets — Atoms Capture

Assets for the Google Play listing of `app.tryatoms.capture`. Committed here because
the listing is filled in by hand in Play Console and these are the only copies.

| File | Play field | Spec |
|---|---|---|
| `icon-512.png` | App icon | 512×512, no alpha, full bleed (Play applies its own mask) |
| `feature-1024x500.png` | Feature graphic | 1024×500 |
| `screenshots/01-capture-strip.png` | Phone screenshot 1 | 1344×2992 |
| `screenshots/02-home-widget.png` | Phone screenshot 2 | 1344×2992 |
| `screenshots/03-listening.png` | Phone screenshot 3 | 1344×2992 |
| `screenshots/04-setup-hub.png` | Phone screenshot 4 | 1344×2992 |
| `screenshots/05-shade-tile.png` | Phone screenshot 5 (weak, optional) | 1344×2992 |

## The mark

`sentinel-mark.svg` is the ↳ sentinel drawn as geometry, not set as type.

`www/src/favicon.svg` renders `&#8627;` in `ui-monospace, SFMono-Regular, Menlo, monospace`.
Menlo's `U+21B3` ends in a **flat, chopped arrowhead**, so anything falling through to Menlo
renders an arrow that looks clipped. Reproduced on a 2000×2000 canvas with hundreds of pixels
of margin, so it is the glyph, not clipping. The two PNGs above are built from the SVG geometry
and are font-independent.

## Screenshots

Captured from the real app on a Pixel 8 Pro emulator (API 35, 1344×2992) against a seeded
demo vault at `/sdcard/Documents/Demo Vault`, with SystemUI demo mode for a clean status bar.

The full loop was exercised, not staged: text typed into the strip, saved, and verified landing
in `Atoms System/Inbox.md` as `- 2026-08-07T17:07:28-04:00 Ask Dana what she meant about the
onboarding drop-off`.

The earlier POC captures in `docs/qa/screenshots/android-capture-poc/` are **not** usable for
the store: they are shot on a personal home screen with real third-party apps visible, and every
capture field in them is empty.

## Known risk

1344×2992 is 2.226:1. Play caps phone screenshots at 2:1. If the Console rejects them, pad each
to 1496×2992 on its own background colour (lossless) rather than cropping.
