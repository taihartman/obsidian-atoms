import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `docs/voice.md` § Voice rules: **no em dashes in product-authored copy.** Use a period, a colon
 * or a comma.
 *
 * The www pages have carried this guard for a while (`test/wwwPricing.test.ts`,
 * `test/entityInvite.test.ts`, `test/atomsHomeData.test.ts`); the settings tab never did, and by
 * 2026-08-14 it had accumulated seventeen of them. A rule nobody can fail is a rule that decays,
 * so this is the settings half of the same guard.
 *
 * Comments are stripped first, deliberately. The rule is about copy a user reads, and prose written
 * for the next maintainer is not that — several long explanations in these files use em dashes and
 * should keep them.
 */

/** Every settings source whose strings reach a user. */
const COPY_SOURCES = [
  "src/settings/settings.ts",
  "src/settings/rows.ts",
  "src/settings/captureSheet.ts",
  "src/settings/captureShortcut.ts",
  "src/settings/destructiveButton.ts",
];

/**
 * `src/settings/consent.ts` is deliberately absent.
 *
 * Its three standing disclosure strings carry em dashes and **cannot be reworded** without bumping
 * `EGRESS_ACK_VERSION` (KTD5). The strings name the exact wording a stored acknowledgment was
 * recorded against, so editing the text without the bump leaves every existing device holding a
 * record for text it never saw. That is #315, and it is a data-integrity bug wearing a typography
 * fix. Whoever bumps the version can add the file to the list above in the same change.
 */
const FROZEN_BY_ACK_VERSION = "src/settings/consent.ts";

/** Line comments, block comments and JSDoc. Not copy, so not covered by the rule. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("settings copy follows the voice rules", () => {
  for (const path of COPY_SOURCES) {
    it(`uses no em dashes in ${path}`, () => {
      const copy = stripComments(readFileSync(path, "utf8"));
      const offenders = copy
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => line.includes("—"))
        .map(([n, line]) => `  ${path}:${n}  ${line.trim()}`);

      expect(
        offenders.join("\n"),
        `docs/voice.md bans em dashes in product-authored copy. Use a period, a colon or a comma:\n${offenders.join("\n")}`,
      ).toBe("");
    });
  }

  it("names the consent file it cannot cover, so the gap is deliberate", () => {
    // Guards the exemption itself: if the frozen strings ever lose their em dashes, the file
    // should join COPY_SOURCES rather than sit in an exemption nobody re-reads.
    const consent = stripComments(readFileSync(FROZEN_BY_ACK_VERSION, "utf8"));
    expect(consent).toContain("—");
    expect(COPY_SOURCES).not.toContain(FROZEN_BY_ACK_VERSION);
  });
});
