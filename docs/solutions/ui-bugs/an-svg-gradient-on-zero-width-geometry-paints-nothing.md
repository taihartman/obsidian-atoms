---
title: An SVG gradient on zero-width geometry paints nothing
date: 2026-08-07
category: ui-bugs
module: www/src/email
problem_type: ui_bug
component: documentation
symptoms:
  - "An entire group of stroked lines disappears from the rendered PNG"
  - "The SVG source is valid and the elements are present; no parser error"
  - "Removing the gradient and using a flat colour brings the artwork back"
root_cause: wrong_api
resolution_type: code_fix
severity: low
tags: [svg, gradient, object-bounding-box, rendering, silent-failure, email-illustration]
---

# An SVG gradient on zero-width geometry paints nothing

## Problem

A waveform in `www/src/email/fn-messy-filed.svg` was drawn as ~23 vertical `<line>` elements. Applying a horizontal `linearGradient` to their stroke erased the entire waveform from the rendered PNG. The same gradient on the horizontal rule beneath it erased that too.

## Symptoms

- A whole group vanishes from the raster output while remaining in the source
- No parser error, no console warning — the render "succeeds" and is simply missing content
- Reverting to a flat `stroke="#ff9f0a"` restores it immediately

## What Didn't Work

The first instinct was to suspect the rasterizer, since the pipeline had already been found untrustworthy once (ImageMagick silently falling back to its own MSVG renderer when librsvg is absent). That was the wrong suspect — Chrome was rendering the file exactly as specified.

## Solution

Declare the gradient in user space instead of relying on the default:

```xml
<!-- before: nothing paints -->
<linearGradient id="voiceFade" x1="0" y1="0" x2="1" y2="0">

<!-- after -->
<linearGradient id="voiceFade" gradientUnits="userSpaceOnUse" x1="96" y1="0" x2="420" y2="0">
```

Applies equally to the horizontal rule, whose bounding box has zero *height*:

```xml
<linearGradient id="lineFade" gradientUnits="userSpaceOnUse" x1="400" y1="0" x2="600" y2="0">
```

## Why This Works

`gradientUnits` defaults to `objectBoundingBox`, which expresses gradient coordinates as fractions of the element's bounding box. A vertical line has a bounding box of zero width; a horizontal rule has zero height. The SVG specification says an element with a degenerate bounding box is **not rendered** when it references a gradient in `objectBoundingBox` units — so the element does not fall back to a flat colour or to the first stop, it disappears entirely.

`userSpaceOnUse` expresses the gradient in the canvas coordinate system, which has no dependence on the element's own box, so degenerate geometry is irrelevant. It also lets one gradient span a whole group consistently — with `objectBoundingBox`, each line would have gotten its own copy of the ramp anyway, which is not what a fading waveform wants.

## Prevention

- Any gradient applied to a `<line>`, or to a stroke on a shape that is flat in one axis, needs `gradientUnits="userSpaceOnUse"`. This includes rules, dividers, tick marks, and axis lines.
- Treat "an element vanished from the raster but is present in the source" as a units problem before suspecting the renderer.
- Look at the rendered output after every SVG change. This was caught only because the PNG set was composited and viewed; a diff of the SVG source looks entirely reasonable.

## Related Issues

- `scripts/render-email-svg.sh` — renders via Chrome precisely because ImageMagick's fallback renderer produces silently wrong output when librsvg is missing
- `docs/field-notes-email.md` — illustration house style and export path
