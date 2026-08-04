/**
 * Best-effort background work that must never surface as a caller failure.
 *
 * Lives in `shared/` because `settings/` fires the same shape and must not
 * import a value out of `plugin/`. Hand-rolling `void p.catch(() => {})` at each
 * site is how one of them eventually forgets the `catch` and turns a mirror
 * hiccup into an unhandled rejection in a caller that already committed its
 * vault write.
 */

/** Process/Update must never fail because mirror/outbox failed. */
export function fireAndForgetAsk(task: Promise<unknown>): void {
  void task.catch(() => {
    /* best-effort — vault write already committed */
  });
}
