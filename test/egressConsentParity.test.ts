/**
 * U5 — the guard that keeps #315 from recurring.
 *
 * The bug was never that the two surfaces wrote different acks; they always wrote the same one.
 * It was that they said different *words* over it, so a "both write the same key" assertion
 * would have been green for the whole life of the bug. What this file asserts instead is what
 * each surface actually renders — home's sheet against Settings' sheet, read back off the DOM
 * rather than compared through the factory both happen to call today. A future call site that
 * bypasses `egressConsentSpec` and assembles its own pair is exactly the drift that shipped
 * once, and only a rendered comparison catches it.
 *
 * Parity alone is not enough: `EGRESS_DISCLOSURE` was completely unguarded before this file, so
 * it could be emptied to `""` and two blank sheets would still "match". The clause assertions
 * below are what makes gutting the copy red as well as diverging it.
 *
 * Home's half goes through `raiseHomeConsent` (test/helpers/homeView.ts) — the same two-field
 * prototype stub `test/homeEgressConsent.test.ts` drives, which is what makes this a comparison
 * of the two real surfaces rather than of two harnesses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./mocks/obsidian";
import { dismissSheet, flip, pressSheet, settingTab, sheet } from "./helpers/settingsTab";
import { EGRESS_ACK_TITLE, EGRESS_DISCLOSURE } from "../src/settings/consent";
import {
  EGRESS_ACK_VERSION,
  enableAutomaticFiling,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
} from "../src/platform/autorun";
import { raiseHomeConsent } from "./helpers/homeView";

afterEach(() => {
  for (const open of [...Modal.open]) open.close();
});

const AUTO_RUN_ROW = "File automatically when Obsidian opens";
/** The sheet renders the disclosure as one sentence under this lead-in. */
const DISCLOSURE_PREFIX = "I understand: ";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The heading and the disclosure the open sheet actually put on screen. */
function renderedConsent(): { title: string; disclosure: string } {
  const open = sheet();
  const title = open.contentEl.querySelector("h2")?.textContent ?? "";
  const para = Array.from(open.contentEl.querySelectorAll("p")).find((el) =>
    (el.textContent ?? "").startsWith(DISCLOSURE_PREFIX),
  );
  if (!para) throw new Error("open sheet renders no disclosure paragraph");
  return { title, disclosure: (para.textContent ?? "").slice(DISCLOSURE_PREFIX.length) };
}

/**
 * Home's consent, raised the way a tap on the filing card raises it. `local` is the device-local
 * store the accept lands in: `enableAutomaticFilingFromHome` is `enableAutomaticFiling(save)`
 * plus a notice and a leaf refresh, and the writes are the whole of what this file asserts.
 */
function homeConsent(): Map<string, unknown> {
  const local = new Map<string, unknown>();
  raiseHomeConsent(() => enableAutomaticFiling((k, v) => local.set(k, v)));
  return local;
}

/** Settings' consent, raised the way the auto-run toggle raises it. */
async function settingsConsent(): Promise<Map<string, unknown>> {
  const { tab, local } = settingTab();
  tab.display();
  flip(tab, AUTO_RUN_ROW);
  await flush();
  return local;
}

/**
 * The four clauses, each pinned by its own substance rather than by the whole string.
 *
 * A single `toBe(EGRESS_DISCLOSURE)` would go red on a comma, and a length check would pass on
 * four clauses of filler. These fail on the edit that actually costs the reader something:
 * dropping a risk, or dropping a scope limit.
 */
function expectFourClauses(disclosure: string): void {
  expect(disclosure).toContain(
    "(1) Atoms sends my vault title graph and each capture to the Anthropic API over TLS, unattended",
  );
  expect(disclosure).toContain(
    '(2) tapping "Sync everything now" classifies even when automatic filing is turned off',
  );
  expect(disclosure).toContain("(3) today’s daily note is never auto-touched");
  expect(disclosure).toContain("(4) this setting stays on this device only");
}

describe("egress consent — the two surfaces", () => {
  it("render the same title and the same disclosure", async () => {
    homeConsent();
    const home = renderedConsent();
    dismissSheet();

    await settingsConsent();
    const settings = renderedConsent();

    expect(home).toEqual(settings);
    // Named separately so a failure says which surface drifted, not merely that they differ.
    expect(home.title).toBe(EGRESS_ACK_TITLE);
    expect(home.disclosure).toBe(EGRESS_DISCLOSURE);
  });

  it("both still disclose all four clauses", async () => {
    homeConsent();
    expectFourClauses(renderedConsent().disclosure);
    dismissSheet();

    await settingsConsent();
    expectFourClauses(renderedConsent().disclosure);
  });
});

/**
 * Every wording this build has ever asked for consent against, keyed by the stamp devices store.
 *
 * This is the half of U6 that makes the stamp mean anything. Version-stamping the ack only helps
 * if changing the words forces the version to move — otherwise a future edit ships new text under
 * the old stamp and every existing device silently keeps a consent record for wording it never
 * saw, which is #315 again. Exact strings, not substrings: a softened clause is the edit that
 * matters, and `expectFourClauses` above deliberately tolerates rewording.
 *
 * **To change the disclosure:** bump `EGRESS_ACK_VERSION` and add its text here. Never edit an
 * existing entry — it is the record of what those devices actually agreed to.
 */
const FROZEN_CONSENT: Readonly<Record<string, { title: string; disclosure: string }>> = {
  "2026-08-06": {
    title: "What Atoms sends to Anthropic",
    disclosure:
      '(1) Atoms sends my vault title graph and each capture to the Anthropic API over TLS, unattended — when Obsidian opens and when it returns to the foreground; (2) tapping "Sync everything now" classifies even when automatic filing is turned off; (3) today’s daily note is never auto-touched; (4) this setting stays on this device only.',
  },
};

describe("egress consent — the ack version", () => {
  it("names the wording currently shipped", () => {
    const frozen = FROZEN_CONSENT[EGRESS_ACK_VERSION];
    expect(
      frozen,
      `EGRESS_ACK_VERSION "${EGRESS_ACK_VERSION}" has no frozen wording — add its text to FROZEN_CONSENT`,
    ).toBeDefined();
    expect(EGRESS_ACK_TITLE).toBe(frozen.title);
    expect(EGRESS_DISCLOSURE).toBe(frozen.disclosure);
  });
});

describe("egress consent — what an accept writes", () => {
  it("leaves the same device-local state from home as from Settings", async () => {
    const fromHome = homeConsent();
    pressSheet("I understand");
    await flush();

    const fromSettings = await settingsConsent();
    pressSheet("I understand");
    await flush();

    // The plan expected an asymmetry here — home enabling filing, Settings recording consent
    // alone. There is none: the Settings toggle is itself an enable, so both accepts write the
    // ack *and* the enabled flag. Asserted as equality so that if either side ever grows a
    // third write, the other has to account for it.
    expect(Object.fromEntries(fromHome)).toEqual({
      // The ack records the disclosure it was granted against, not a bare `true` — U6/KTD4.
      [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
      [LS_AUTO_RUN_ENABLED]: true,
    });
    expect(Object.fromEntries(fromSettings)).toEqual(Object.fromEntries(fromHome));
  });

  it("writes neither key when home's sheet is declined", () => {
    const local = homeConsent();
    pressSheet("Cancel");
    expect(local.size).toBe(0);
  });

  it("writes neither key when home's sheet is dismissed", () => {
    const local = homeConsent();
    dismissSheet();
    expect(local.size).toBe(0);
  });
});
