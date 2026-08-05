import { describe, expect, it } from "vitest";
// Imported from the mock by path, not from "obsidian": vitest aliases the module but `tsc`
// does not, so a bare "obsidian" import would typecheck against the real API and never see
// the recorder's `controls`. Code under test still imports "obsidian" and gets this same
// module through the alias.
import {
  PluginSettingTab,
  Setting,
  type ButtonComponent,
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
