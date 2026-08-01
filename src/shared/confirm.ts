/**
 * Shared user-verdict contract (KTD15).
 *
 * `platform/` modules that need an explicit human gesture take a host with a
 * `confirm` method rather than constructing a Modal themselves: the shared
 * Obsidian mock stubs `Modal` with no children and vitest runs a node
 * environment with no DOM, so a surface-owned confirmation is untestable.
 * The contract lives in `shared/` so `platform/` never imports a `plugin/`
 * type and the two sides cannot drift.
 */

export type ConfirmVerdict = "confirmed" | "declined" | "dismissed";

/** Ask mirror deletion — the concrete counts the modal must name. */
export type ConfirmRequest = {
  kind: "ask-mirror-deletion";
  /** Paths this device holds hash evidence for. */
  evidenceCount: number;
  /** Paths the vault scan just found. */
  scannedCount: number;
  /** Last known server row count, or null when this device never saw one. */
  lastKnownServerCount: number | null;
};

export interface ConfirmHost {
  confirm(request: ConfirmRequest): Promise<ConfirmVerdict>;
}

declare const deletionConfirmationBrand: unique symbol;

/**
 * Opaque proof that a human confirmed a mirror deletion against concrete
 * counts. A boolean has no origin — this type is nominal, and its only
 * constructor lives beside the `confirm` call site in
 * `src/platform/askMirror.ts` and is not exported. Nothing outside that one
 * branch can produce a value of this type.
 */
export type DeletionConfirmation = {
  readonly [deletionConfirmationBrand]: true;
  /** True only when the confirmed scan was genuinely empty. */
  readonly confirmEmpty: boolean;
  readonly scannedCount: number;
  readonly evidenceCount: number;
};
