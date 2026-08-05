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
 * The sign-in handoff's confirmation (#240 U10, R4).
 *
 * Carries the **server-verified** account email and nothing else: the token and
 * the device verifier stay inside `platform/`, so no surface that renders text
 * can render either of them (R11). Declared beside `ConfirmVerdict` rather than
 * folded into `ConfirmRequest` — a dialog that names atom counts and a dialog
 * that names an account answer different questions, and the two unions have no
 * shared field to discriminate usefully.
 */
export type SignInConfirmRequest = {
  kind: "plus-signin";
  email: string;
};

/** The gesture that releases a sign-in exchange. */
export interface SignInConfirmHost {
  confirmSignIn(request: SignInConfirmRequest): Promise<ConfirmVerdict>;
}

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

/**
 * The subset a *dialog* can carry. `no-server-count` is absent by
 * construction: the modal is posed only after this pass established a fresh
 * count, and a run that could not get one refuses outright rather than asking
 * an irreversible question whose answer cannot be informed. Narrowing it here
 * is what keeps that a property of the code instead of a promise about it.
 */
export type MirrorDeletionAskReason = Exclude<
  MirrorDeletionRefusal,
  "no-server-count"
>;

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
   * Never null: no count, no question.
   */
  lastKnownServerCount: number;
  /** Why the gate refused, so the copy can be true rather than generic. */
  reason: MirrorDeletionAskReason;
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
