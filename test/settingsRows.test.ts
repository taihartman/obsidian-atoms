import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actionRow,
  backRow,
  destinationRow,
  destructiveRow,
  settingRow,
  statusRow,
} from "../src/settings/rows";
import { AtomsSettingTab, type SettingsRoute } from "../src/settings/settings";
import { destinationNames, open, settingTab } from "./helpers/settingsTab";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import type { PlusSession } from "../src/platform/filingAuth";
// Imported from the mock by path, not from "obsidian": vitest aliases the module but `tsc`
// does not, so a bare "obsidian" import would typecheck against the real API and never see
// the recorder's `controls`. Code under test still imports "obsidian" and gets this same
// module through the alias.
import {
  PluginSettingTab,
  Setting,
  type ButtonComponent,
  type TextComponent,
  type ToggleComponent,
} from "./mocks/obsidian";

/**
 * Harness self-test. Everything the row-grammar units assert — a row's name, its description,
 * which control sits at its right edge, and in what order controls were added — is read back
 * off rendered output, so this file proves the harness can see those things before any row
 * grammar depends on it.
 */
describe("settings rendering harness", () => {
  it("exposes a row's name, description, and the controls added to it", () => {
    const container = document.createElement("div");

    const row = new Setting(container)
      .setName("Process today's daily note")
      .setDesc("Off by default so mid-day capture stays quiet.")
      .addToggle((toggle: ToggleComponent) => toggle.setValue(true))
      .addButton((button: ButtonComponent) => button.setButtonText("Process").setCta());

    expect(row.name).toBe("Process today's daily note");
    expect(row.desc).toBe("Off by default so mid-day capture stays quiet.");
    expect(row.controls.map((control) => control.kind)).toEqual(["toggle", "button"]);
    expect(container.querySelectorAll(".setting-item")).toHaveLength(1);
  });

  it("renders the right-edge control into controlEl in order", () => {
    const row = new Setting()
      .setName("Delete every atom")
      .addExtraButton((extra) => extra.setIcon("help").setTooltip("What this does"))
      .addButton((button) => button.setButtonText("Delete").setDestructive());

    const rightmost = row.controls.at(-1);
    expect(rightmost?.kind).toBe("button");
    expect(row.controlEl.lastElementChild?.tagName).toBe("BUTTON");
    expect(row.controlEl.lastElementChild?.textContent).toBe("Delete");
    expect(row.controlEl.lastElementChild?.classList.contains("mod-destructive")).toBe(true);
  });

  it("fires a button's onClick when the rendered button is clicked", () => {
    let clicked = 0;
    const row = new Setting().addButton((button) =>
      button.setButtonText("Sync now").onClick(() => {
        clicked += 1;
      }),
    );

    (row.controlEl.querySelector("button") as HTMLButtonElement).click();
    expect(clicked).toBe(1);
  });

  it("gives a settings tab a real containerEl to render into", () => {
    class Tab extends PluginSettingTab {
      override display(): void {
        this.containerEl.empty();
        new Setting(this.containerEl).setName("Atoms folder");
      }
    }

    const tab = new Tab({}, {});
    tab.display();
    tab.display(); // redisplay must not stack rows

    expect(tab.containerEl.querySelectorAll(".setting-item")).toHaveLength(1);
    expect(tab.containerEl.querySelector(".setting-item-name")?.textContent).toBe("Atoms folder");
  });
});

/** The rendered right edge of the only row in `container`. */
function controlEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".setting-item-control");
  if (!(el instanceof HTMLElement)) throw new Error("no row rendered into container");
  return el;
}

function row(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".setting-item");
  if (!(el instanceof HTMLElement)) throw new Error("no row rendered into container");
  return el;
}

describe("row grammar", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("settingRow renders exactly its one toggle and no button", () => {
    let stored: boolean | null = null;
    let captured: ToggleComponent | null = null;
    settingRow(container, {
      name: "Process today's daily note",
      desc: "Off by default so mid-day capture stays quiet.",
      control: {
        kind: "toggle",
        configure: (toggle) => {
          // The builder hands back nothing, so the component is captured here — and cast to the
          // recorder's type for the `toggle()` / `fill()` test affordances `tsc` cannot see.
          captured = toggle as unknown as ToggleComponent;
          captured.setValue(false).onChange((value) => {
            stored = value;
          });
        },
      },
    });

    expect(row(container).querySelector(".setting-item-name")?.textContent).toBe(
      "Process today's daily note",
    );
    expect(controlEl(container).children).toHaveLength(1);
    expect(controlEl(container).querySelector("button")).toBeNull();

    captured!.toggle();
    expect(stored).toBe(true);
  });

  it("settingRow accepts a text input as its one control", () => {
    let typed = "";
    let captured: TextComponent | null = null;
    settingRow(container, {
      name: "Atoms folder",
      control: {
        kind: "text",
        configure: (text) => {
          captured = text as unknown as TextComponent;
          captured.setValue("Atoms").onChange((value) => {
            typed = value;
          });
        },
      },
    });

    expect(controlEl(container).querySelector("input")?.value).toBe("Atoms");
    expect(controlEl(container).children).toHaveLength(1);

    captured!.fill("Notes");
    expect(typed).toBe("Notes");
    expect(controlEl(container).querySelector("input")?.value).toBe("Notes");
  });

  it("destinationRow renders a chevron and opens on click, with no toggle", () => {
    let opened = 0;
    destinationRow(container, {
      name: "Connect",
      desc: "Key, model, and connection checks.",
      onOpen: () => {
        opened += 1;
      },
    });

    const chevron = controlEl(container).querySelector("[data-icon]");
    expect(chevron?.getAttribute("data-icon")).toBe("chevron-right");
    expect(controlEl(container).querySelector(".checkbox-container")).toBeNull();

    row(container).click();
    expect(opened).toBe(1);

    // Clicking the chevron itself is the same one open, not a second.
    (chevron as HTMLElement).click();
    expect(opened).toBe(2);
  });

  it("backRow points the other way and returns on click, with no toggle", () => {
    let went = 0;
    backRow(container, {
      name: "Account",
      onBack: () => {
        went += 1;
      },
    });

    const chevron = controlEl(container).querySelector("[data-icon]");
    expect(chevron?.getAttribute("data-icon")).toBe("chevron-left");
    expect(row(container).classList.contains("atoms-setting-back")).toBe(true);
    expect(controlEl(container).querySelector(".checkbox-container")).toBeNull();
    expect(controlEl(container).querySelector("button.mod-cta")).toBeNull();

    row(container).click();
    expect(went).toBe(1);
  });

  it("actionRow renders an accent button and no toggle", () => {
    let ran = 0;
    actionRow(container, {
      name: "Process unprocessed captures",
      label: "Process",
      onClick: () => {
        ran += 1;
      },
    });

    const button = controlEl(container).querySelector("button");
    expect(button?.textContent).toBe("Process");
    expect(button?.classList.contains("mod-cta")).toBe(true);
    expect(button?.classList.contains("mod-destructive")).toBe(false);
    expect(controlEl(container).querySelector(".checkbox-container")).toBeNull();
    expect(controlEl(container).children).toHaveLength(1);

    button!.click();
    expect(ran).toBe(1);
  });

  it("destructiveRow applies the destructive style and never an accent one", () => {
    let wiped = 0;
    destructiveRow(container, {
      name: "Wipe cloud copy",
      desc: "Deletes every atom this device mirrored.",
      label: "Wipe",
      onClick: () => {
        wiped += 1;
      },
    });

    const button = controlEl(container).querySelector("button");
    expect(button?.textContent).toBe("Wipe");
    // markDestructive() prefers setDestructive() and falls back to setWarning().
    expect(
      button?.classList.contains("mod-destructive") || button?.classList.contains("mod-warning"),
    ).toBe(true);
    expect(button?.classList.contains("mod-cta")).toBe(false);
    expect(controlEl(container).children).toHaveLength(1);

    button!.click();
    expect(wiped).toBe(1);
  });

  it("statusRow renders muted trailing text and no interactive control", () => {
    statusRow(container, { name: "Last sync", value: "3 minutes ago" });

    expect(row(container).querySelector(".setting-item-name")?.textContent).toBe("Last sync");
    expect(row(container).querySelector(".setting-item-description")?.textContent).toBe("");
    expect(controlEl(container).textContent).toBe("3 minutes ago");
    expect(controlEl(container).firstElementChild?.classList.contains("atoms-setting-status")).toBe(
      true,
    );
    expect(controlEl(container).querySelector("button, input, select, .checkbox-container")).toBeNull();
  });

  it("no builder hands back a chainable a caller could add a second affordance to", () => {
    const returns = [
      settingRow(container, {
        name: "A",
        control: { kind: "toggle", configure: () => {} },
      }),
      destinationRow(container, { name: "B", onOpen: () => {} }),
      backRow(container, { name: "B2", onBack: () => {} }),
      actionRow(container, { name: "C", label: "Go", onClick: () => {} }),
      destructiveRow(container, { name: "D", label: "Wipe", onClick: () => {} }),
      statusRow(container, { name: "E", value: "ok" }),
    ];

    expect(returns).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  /**
   * A double-tap on a network-backed row used to send two sign-in emails. The builder owns the
   * guard rather than the caller: an `onClick` that returns a promise disables its own button
   * until that promise settles, so no caller has to be handed a `ButtonComponent` to get it.
   */
  describe.each([
    ["actionRow", actionRow],
    ["destructiveRow", destructiveRow],
  ] as const)("%s in-flight guard", (_name, build) => {
    it.each(["resolve", "reject"] as const)(
      "disables the button until a promised click %ss",
      async (settle) => {
        let finish!: () => void;
        const pending = new Promise<void>((resolve, reject) => {
          finish = settle === "resolve" ? resolve : () => reject(new Error("boom"));
        });
        build(container, { name: "Refresh status", label: "Refresh status", onClick: () => pending });
        const button = container.querySelector("button");
        if (!(button instanceof HTMLButtonElement)) throw new Error("no button rendered");

        expect(button.disabled).toBe(false);
        button.click();
        expect(button.disabled).toBe(true);
        // A second tap while in flight reaches nothing: the button is disabled.
        button.click();

        finish();
        await pending.catch(() => {});
        await Promise.resolve();
        await Promise.resolve();
        // Re-enabled even when the action rejected — a failed request must not kill the row.
        expect(button.disabled).toBe(false);
      },
    );

    it("leaves a synchronous click alone", () => {
      build(container, { name: "Open", label: "Open", onClick: () => {} });
      const button = container.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) throw new Error("no button rendered");

      button.click();
      expect(button.disabled).toBe(false);
    });
  });
});

function backRowEl(tab: AtomsSettingTab): HTMLElement | null {
  const el = tab.containerEl.querySelector(".atoms-setting-back");
  return el instanceof HTMLElement ? el : null;
}

/** The version line is rendered by the main screen and by nothing else. */
function onMainScreen(tab: AtomsSettingTab): boolean {
  return Array.from(tab.containerEl.querySelectorAll("p")).some((p) =>
    p.textContent?.startsWith("Version 9.9.9"),
  );
}

/**
 * Entry-row name paired with the title of the screen it opens. They match everywhere except
 * Account, whose entry row is named for the account's state (U3), and Tag vocabulary, whose entry
 * row carries the active count (U4) — both screens keep their own title.
 */
/**
 * In rendered order. Connect sits where the Ask plumbing used to, which is above the vocabulary
 * entry — the plan's final table wants those two the other way round, but that is a section
 * ordering pass, not this unit's.
 */
const DESTINATIONS: Array<[entry: string, title: string]> = [
  ["Set up automatic filing", "Account"],
  ["Connect Claude or ChatGPT", "Connect Claude or ChatGPT"],
  [`Tag vocabulary — ${DEFAULT_SETTINGS.activeVocabulary.length} active`, "Tag vocabulary"],
  ["Advanced", "Advanced"],
];

/**
 * A Plus session, because U6 moved the Ask plumbing behind the Connect entry row and the Ask
 * section — that row included — renders only when the device has one.
 */
const SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "user@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
};

describe("destination shell", () => {
  it("opens on the main screen, listing every destination", () => {
    const { tab } = settingTab({ session: SESSION });
    tab.display();

    expect(onMainScreen(tab)).toBe(true);
    expect(backRowEl(tab)).toBeNull();
    expect(destinationNames(tab)).toEqual(DESTINATIONS.map(([entry]) => entry));
  });

  it.each(DESTINATIONS)("enters %s and comes back to the main screen", (entry, title) => {
    const { tab } = settingTab({ session: SESSION });
    tab.display();

    open(tab, entry);
    expect(onMainScreen(tab)).toBe(false);
    // The back row leads the destination, so the user never has to scroll to leave.
    const back = backRowEl(tab);
    expect(back).not.toBeNull();
    expect(back?.querySelector(".setting-item-name")?.textContent).toBe(title);
    expect(tab.containerEl.firstElementChild).toBe(back);

    back!.click();
    expect(onMainScreen(tab)).toBe(true);
    expect(backRowEl(tab)).toBeNull();
  });

  it("lands on the main screen again after the tab is closed and reopened", () => {
    const { tab } = settingTab();
    tab.display();
    open(tab, "Advanced");
    expect(onMainScreen(tab)).toBe(false);

    tab.hide();
    tab.display();

    expect(onMainScreen(tab)).toBe(true);
    expect(backRowEl(tab)).toBeNull();
  });

  it("renders a route change from the top instead of restoring the old scroll position", () => {
    const { tab, scroller } = settingTab();
    tab.display();
    scroller.scrollTop = 420;

    open(tab, "Set up automatic filing");
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = 260;
    backRowEl(tab)!.click();
    expect(scroller.scrollTop).toBe(0);
  });

  it("closes the route union so a new route cannot be added without a branch", () => {
    const main: SettingsRoute = "main";
    expect(main).toBe("main");

    // The compile error this expects is the whole guard: `display()` switches on
    // `SettingsRoute` and closes with `const _exhaustive: never = route`, so a value added to
    // the union without a matching branch fails `typecheck:test` and `npm run build`.
    // @ts-expect-error — "billing" is not a route.
    const notARoute: SettingsRoute = "billing";
    expect(notARoute).toBe("billing");
  });
});

/**
 * A signature only constrains rows built *through* a builder. `settings.ts` still holds direct
 * `new Setting(` sites, so the guard is a ratchet rather than a flat ban: the count may fall,
 * never rise.
 *
 * U6 was the last destination unit and took it from 27 to 18. Zero is not reachable from here:
 * `settingHeading()` builds a heading rather than a row, two modals build their own button bars,
 * and the API key row's control is a `SecretComponent`, which `SettingControl` has no member for.
 * The rest belong to the clusters U7–U9 still own — lower it as they land.
 */
const DIRECT_SETTING_BUDGET = 15;

describe("row-grammar repository guard", () => {
  it("settings.ts does not grow new direct `new Setting(` sites", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/settings/settings.ts"),
      "utf8",
    );
    const direct = source.match(/new Setting\(/g)?.length ?? 0;

    expect(
      direct,
      `settings.ts constructs Setting directly ${direct} times (budget ${DIRECT_SETTING_BUDGET}). ` +
        "Build rows through src/settings/rows.ts; lower DIRECT_SETTING_BUDGET as sites migrate.",
    ).toBeLessThanOrEqual(DIRECT_SETTING_BUDGET);
  });

  it("rows.ts is the one place that constructs Setting", () => {
    const source = readFileSync(path.resolve(__dirname, "../src/settings/rows.ts"), "utf8");
    expect(source.match(/new Setting\(/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
