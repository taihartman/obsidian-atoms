# feat: Capture URI — create-if-missing, silent append

**Issue:** #51  
**Lane:** light  
**Version:** 0.6.10

## Understanding

Capture shortcuts fail when today’s daily does not exist. Mac shell already creates; Obsidian/iOS append actions often do not.

## Approach

1. Pure helpers: normalize text, format `- bullet`, compute append chunk (trailing-newline safe).
2. `ensureTodaysDaily(app)` — create via Daily Notes API if missing; **never** open editor.
3. `appendCaptureToTodaysDaily(app, text)` — ensure + append.
4. Protocol: `obsidian://atoms-capture?vault=…&text=…` (alias `data=`).
5. Docs + bump `CAPTURE_SHORTCUT_VERSION` recipe.

## Blast radius

- `src/pipeline/daily.ts`, new `captureAppend.ts`, `main.ts` protocol register
- `docs/capture-shortcut.md`, tests, version 0.6.10
- No classify/process/today-auto-run change

## Done when

- Missing daily → create + append, no `openFile`
- Existing daily → append only
- Empty text / Daily Notes off → Notice, no write
- Unit tests for pure helpers; build + test green
