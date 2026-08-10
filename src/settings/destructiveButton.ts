import type { ButtonComponent } from "obsidian";

/**
 * `setDestructive()` only exists from Obsidian 1.13, but the manifest supports
 * 1.11.4. Calling it on an older installer threw mid-render and killed the whole
 * Atoms settings tab for anyone with a stored Plus session — every control below
 * "Wipe cloud copy" simply vanished. Prefer it where present, fall back to the
 * deprecated-but-still-shipping warning style otherwise.
 *
 * Lifted out of `settings.ts` for #240 U10 (KTD9): the sign-in confirmation is
 * its own file and needs the same answer, and one convention for one problem
 * beats a second hand-rolled call site.
 */
export function markDestructive(btn: ButtonComponent): ButtonComponent {
  // Bracket access so static community lint does not treat setDestructive
  // (1.13+) as an unconditional API use against minAppVersion 1.11.4.
  const maybe = btn as ButtonComponent & Record<string, unknown>;
  const fn = maybe["setDestructive"];
  if (typeof fn === "function") {
    return (fn as () => ButtonComponent).call(btn);
  }
  // Pre-1.13 floor: mod-warning chrome without deprecated setWarning().
  btn.buttonEl.addClass("mod-warning");
  return btn;
}
