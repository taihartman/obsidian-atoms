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

/**
 * Which threshold withheld the deletion. Declared here rather than in
 * `platform/askMirror.ts` because the confirmation contract carries it: the
 * dialog authorising an irreversible delete has to state the true reason, and
 * `shared/` is the one place both sides may import from.
 */
export type MirrorDeletionRefusal =
  | "scan-incomplete"
  | "no-server-count"
  | "server-count-tripwire"
  | "baseline-unreadable";

/** Ask mirror deletion — the concrete counts the modal must name. */
export type ConfirmRequest = {
  kind: "ask-mirror-deletion";
  /** Paths this device holds hash evidence for. */
  evidenceCount: number;
  /** Paths the vault scan just found. */
  scannedCount: number;
  /**
   * Server row count as of *this* pass — refreshed immediately before the ask,
   * never the stored value, which on the at-risk device is old by definition.
   * Null only when the count could not be established at all.
   */
  lastKnownServerCount: number | null;
  /** Why the gate refused, so the copy can be true rather than generic. */
  reason: MirrorDeletionRefusal;
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
