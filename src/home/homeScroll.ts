/**
 * Scroll identity for Atoms home. `render()` empties the scroller, so position
 * has to be remembered per screen and put back: the same rule Settings uses.
 *
 * Vault-driven refresh is for idle browsing. A filing pass already owns the
 * next paint (Process patches in place; auto-run finishes with one refresh).
 */

export const HOME_VAULT_REFRESH_MS = 400;

/**
 * One key per screen. A second in-home detail must not inherit the first's
 * scroll: the same rule Settings uses for destinations (#533).
 */
export function homeScrollScreen(homeOpen: unknown): string {
  if (!homeOpen || typeof homeOpen !== "object") return "main";
  const open = homeOpen as {
    kind?: unknown;
    path?: unknown;
    label?: unknown;
    thenPath?: unknown;
    nowPath?: unknown;
  };
  if (open.kind === "atom" && typeof open.path === "string") {
    return `open:atom:${open.path}`;
  }
  if (open.kind === "entity-siblings" && typeof open.label === "string") {
    return `open:entity:${open.label}`;
  }
  if (
    open.kind === "mind-change-pair" &&
    typeof open.thenPath === "string" &&
    typeof open.nowPath === "string"
  ) {
    return `open:pair:${open.thenPath}:${open.nowPath}`;
  }
  return "main";
}

export function shouldSkipHomeVaultRefresh(opts: {
  busy: boolean;
  autoRunInFlight: boolean;
}): boolean {
  return opts.busy || opts.autoRunInFlight;
}
