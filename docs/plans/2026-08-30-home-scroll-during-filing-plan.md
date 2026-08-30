# Home keeps its place while notes file

Lane: debug. Issue #611.

## Bug

Scroll down Atoms home while captures are filing. Each write rebuilds the view and dumps `.atoms-home-scroll` to the top. The wait card says you can keep browsing.

## Cause

`render()` does `root.empty()`, which destroys the scroller. Manual Process patches the progress card in place. Auto-run never sets `busy` and never calls `beginHomeRun`, so each vault create/modify schedules a 400ms `refresh()`. Classify is slower than 400ms, so that is once per capture. The timer also does not re-check `busy` when it fires.

## Fix

1. Remember scroll per screen (`main` vs `open`), restore after `render()` on the same screen. A new screen starts at the top. Back to main restores. Same lesson as #533.
2. Skip vault-driven refresh while `busy` **or** auto-run is in flight. Re-check in the timer.
3. Leave the in-place Process progress patch alone. Auto-run stays silent (no progress strip).

## Tests

`test/atomsHomeView.test.ts` via `renderedHomeView`:

- Repeated `render()` on main keeps `scrollTop`
- Opening a detail starts at 0; Back restores main
- `beginRun` keeps scroll
- Vault change while `busy` or auto-run in flight does not `refresh`
- A timer armed before `busy` does not `refresh` after

## Out of scope

Progress copy, land-peak layout, Ask-mirror refresh after the run, teaching auto-run to drive the Process strip.

## Hot files

`src/home/atomsHomeView.ts`, `src/home/homeScroll.ts`, `test/atomsHomeView.test.ts`, `test/helpers/homeView.ts`

#579 is Blocked on the same view file (header shell). This change wraps `empty()` and the vault debounce only.
