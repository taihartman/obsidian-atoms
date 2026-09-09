export function singleFlight<Args extends unknown[], Result>(
  operation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let active: Promise<Result> | null = null;
  return (...args: Args) => {
    if (active) return active;
    const started = operation(...args);
    active = started;
    void started.finally(() => {
      if (active === started) active = null;
    }).catch(() => {
      // The caller owns the original rejection; this branch only observes cleanup.
    });
    return started;
  };
}
