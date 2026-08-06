/**
 * Opt-in recorder for what a render actually put on screen, in render order.
 *
 * The DOM-backed `obsidian` mock lets a test read a rendered tree back, but some claims are
 * about *sequence* across surfaces a tree does not linearise usefully — "the disclosure appears
 * above both buttons", "this description follows that row name". Those read off a flat list.
 *
 * Off by default: a test that never calls {@link captureObsidianUi} costs nothing, and the
 * recorder never becomes a second source of truth about the DOM.
 *
 * Lives in its own module rather than in `obsidian.ts` because `domAugmentations.ts` also
 * reports into it, and `obsidian.ts` imports *that* — a cycle if the state lived either side.
 */
export type UiCapture = {
  /** Every string rendered into the panel, in render order. */
  strings: string[];
  buttons: { text: string; click: () => unknown }[];
  /** Every text field built, in order. Real inputs, so `dataset` and `value` read back as-is. */
  inputs: HTMLInputElement[];
  notices: string[];
};

let capture: UiCapture | null = null;

export function captureObsidianUi(): UiCapture {
  capture = { strings: [], buttons: [], inputs: [], notices: [] };
  return capture;
}

export function stopCapturingObsidianUi(): void {
  capture = null;
}

/** The recording in progress, or `null` when nothing is recording. */
export function activeCapture(): UiCapture | null {
  return capture;
}

/** Record one rendered string. Non-strings are ignored, so `DocumentFragment` names are skipped. */
export function noteUiString(value: unknown): void {
  if (capture && typeof value === "string") capture.strings.push(value);
}
