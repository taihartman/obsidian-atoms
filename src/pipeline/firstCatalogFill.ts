/**
 * First catalog fill: one hub-list preview on calm Home, then listing stays on.
 */

export const LS_TOGETHER_FIRST_FILL = "atoms-together-first-fill-v1";

export type FirstFillAction = "noop" | "offer" | "stamp-empty";

/**
 * When to open the existing hub-list preview as the listing on-ramp.
 * Empty plan with no accepted hubs waits (invite-first vaults). Empty plan
 * with hubs present stamps done and does not open a modal.
 */
export function decideFirstFill(opts: {
  firstFillDone: boolean;
  listingOn: boolean;
  acceptedHubCount: number;
  previewHasRows: boolean;
}): FirstFillAction {
  if (opts.firstFillDone) return "noop";
  if (opts.listingOn) return "noop";
  if (opts.previewHasRows) return "offer";
  if (opts.acceptedHubCount > 0) return "stamp-empty";
  return "noop";
}

export function readFirstFillDone(load: (key: string) => unknown): boolean {
  return load(LS_TOGETHER_FIRST_FILL) === "1";
}

export function writeFirstFillDone(
  save: (key: string, value: unknown) => void,
): void {
  save(LS_TOGETHER_FIRST_FILL, "1");
}
