/**
 * The setup guide tells a reader which switch to flip and which button to press, by quoting the
 * exact on-screen wording. Rename one of those in the plugin and the guide keeps confidently
 * naming a control that no longer exists — prose cannot notice, and the reader is the one who
 * finds out.
 *
 * So every quoted label is asserted from both ends:
 *
 *   1. the plugin side, through what the settings tab actually *renders* — never through the
 *      function that produces the string. A producer assertion is #302 with one indirection
 *      added: the helper keeps returning the right label while the row it feeds is handed some
 *      other literal, and the guide names a button nobody can find.
 *   2. the guide side, against the BUILT page in `www/dist` rather than the `.tmpl` source
 *
 * Point 2 is the whole reason this file exists. `package.json` runs `build:www` as `pretest`, so
 * dist is current at test time; asserting the template instead would leave exactly the gap that
 * let #302's guard pass against a string the shipped page never contained. It also means a bare
 * `npx vitest run` — or watch mode — skips `pretest` and reads whatever `www/dist/setup.html` was
 * built last: run this file through `npm test` or the guide half proves nothing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  destinationNames,
  dismissSheet,
  open,
  row,
  rowNames,
  settingTab,
  sheetButtons,
} from "./helpers/settingsTab";
import { labelCaptureShortcutCta } from "../src/settings/captureShortcut";
import type { IssuedBase, PlusSession } from "../src/platform/filingAuth";

/** The guide as a reader reads it: no markup, no line wrapping, so a label may straddle both. */
const guide = readFileSync(
  join(__dirname, "..", "www", "dist", "setup.html"),
  "utf8",
)
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const PLUS_SESSION: PlusSession = {
  sessionToken: "sess_setup",
  email: "user@example.com",
  status: "active",
  periodEnd: "2099-01-01T00:00:00.000Z",
  // #508: stamped with the base an empty `plusBaseUrl` resolves to, which is
  // what a hosted session carries from sign-in onward.
  issuedBase: "https://plus.tryatoms.app" as IssuedBase,
  verifiedBase: "https://plus.tryatoms.app",
};

/** Signed in to Plus, which is the only state that renders the Ask cluster. */
function plusTab() {
  return settingTab({
    session: PLUS_SESSION,
    auth: {
      mode: "plus",
      sessionToken: PLUS_SESSION.sessionToken,
      email: PLUS_SESSION.email,
      status: "active",
      remaining: 12,
      periodEnd: PLUS_SESSION.periodEnd,
    },
  });
}

/** The labels on the buttons of one rendered row. */
function buttonLabels(tab: ReturnType<typeof plusTab>["tab"], name: string): string[] {
  return Array.from(row(tab, name).querySelectorAll("button")).map(
    (el) => el.textContent ?? "",
  );
}

describe("setup guide quotes labels the plugin still renders", () => {
  it("names the Capture Atom install button, now inside the sheet that holds it", () => {
    // Companion stays hidden until App Store; shortcut is the path. U9 moved the CTA off the
    // row and into the procedure sheet, so this asserts it where a user now finds it —
    // asserting the label helper alone would be #302 with one indirection added.
    const { tab } = settingTab();
    tab.display();

    const shortcutLabel = labelCaptureShortcutCta(null);
    expect(shortcutLabel).toBe("Install Capture Atom");
    open(tab, "Capture on your phone");
    expect(sheetButtons()).toContain(shortcutLabel);
    dismissSheet();

    expect(guide.includes("Install Capture Atom"), "guide does not name install CTA").toBe(
      true,
    );
    // Naming the button without naming the row that opens it is not a followable instruction.
    const sentence = guide
      .split(/(?<=\.)\s+/)
      .find((s) => s.includes("Install Capture Atom"));
    expect(sentence, "guide has no install step").toBeDefined();
    expect(sentence).toContain("Capture on your phone");
  });

  it("names the Android Play row and button the plugin renders", () => {
    const { tab } = settingTab();
    tab.display();
    expect(rowNames(tab)).toContain("Atoms Capture");
    open(tab, "Atoms Capture");
    expect(sheetButtons()).toContain("Get Atoms Capture");
    dismissSheet();

    expect(guide.includes("Get Atoms Capture"), "guide does not name Play CTA").toBe(
      true,
    );
    const sentence = guide
      .split(/(?<=\.)\s+/)
      .find((s) => s.includes("Get Atoms Capture"));
    expect(sentence, "guide has no Android install step").toBeDefined();
    expect(sentence).toContain("Atoms Capture");
  });

  it("names the two Ask switches the main screen renders", () => {
    // Owning source: src/settings/settings.ts, renderAskSection.
    const { tab } = plusTab();
    tab.display();

    const rows = rowNames(tab, { headings: false });
    for (const label of ["Ask mirror", "Allow filing from Claude or ChatGPT"]) {
      expect(rows, `no row named ${label}`).toContain(label);
      expect(guide.includes(label), `guide does not name ${label}`).toBe(true);
    }
  });

  it("names the connector row and the pairing button, both now one screen in", () => {
    // Owning source: src/settings/settings.ts, renderConnectDestination. U6 moved these off the
    // main screen, which is why the guide has to say where they went.
    const { tab } = plusTab();
    tab.display();
    expect(destinationNames(tab)).toContain("Connect Claude or ChatGPT");

    open(tab, "Connect Claude or ChatGPT");
    expect(rowNames(tab)).toContain("MCP connector URL");
    expect(buttonLabels(tab, "Link Claude / ChatGPT")).toContain("Get pairing code");

    for (const label of [
      "Connect Claude or ChatGPT",
      "MCP connector URL",
      "Get pairing code",
    ]) {
      expect(guide.includes(label), `guide does not name ${label}`).toBe(true);
    }
  });

  it("sends the reader into the destination the pairing button now lives in", () => {
    // "Press Get pairing code" was true when the button sat on the main screen. After U6 the
    // instruction is only followable if the step also names the destination.
    const sentence = guide
      .split(/(?<=\.)\s+/)
      .find((s) => s.includes("Get pairing code"));
    expect(sentence, "guide has no pairing-code step").toBeDefined();
    expect(sentence).toContain("Connect Claude or ChatGPT");
  });

  it("names the self-host controls the Advanced screen renders, and where they are", () => {
    // Owning source: src/settings/settings.ts, renderAdvancedDestination. U7 renamed both — the
    // URL field lost its "override" and the guide link stopped being "DIY" — so the shipped page
    // has to have moved with them or it names two controls that no longer exist.
    const { tab } = plusTab();
    tab.display();
    open(tab, "Advanced");

    const rows = rowNames(tab);
    for (const label of ["Plus service URL", "Self-host guide"]) {
      expect(rows, `no row named ${label}`).toContain(label);
      expect(guide.includes(label), `guide does not name ${label}`).toBe(true);
    }
    // Two screens in, so naming the control without the route is not a followable instruction.
    const sentence = guide
      .split(/(?<=\.)\s+/)
      .find((s) => s.includes("Plus service URL"));
    expect(sentence, "guide has no self-host step").toBeDefined();
    expect(sentence).toContain("Advanced");
    expect(guide.includes("DIY Ask guide"), "guide still says DIY Ask guide").toBe(false);
  });

  it("has dropped the label this unit retired", () => {
    // The switch is named "Ask mirror" now: a row grammar's toggle already says "enable", so the
    // label does not repeat it. Guard the old wording rather than trusting the edit.
    expect(guide.includes("Enable Ask mirror"), "guide still says Enable Ask mirror").toBe(false);
  });
});
