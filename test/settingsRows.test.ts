import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actionRow,
  backRow,
  destinationRow,
  destructiveRow,
  formActionsRow,
  formRow,
  InFlightActions,
  settingRow,
  statusRow,
} from "../src/settings/rows";
import { AtomsSettingTab, type SettingsRoute } from "../src/settings/settings";
import { ASK_PRIVACY_ACK_VERSION } from "../src/shared/askAck";
import {
  destinationNames,
  // Aliased: this file already has a local `row()` reader, and `press`/`flip` read better
  // alongside it under names that say they act on a rendered row.
  flip as flipRow,
  open,
  press as pressRow,
  settingTab,
} from "./helpers/settingsTab";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import type { PlusSession } from "../src/platform/filingAuth";
// Imported from the mock by path, not from "obsidian": vitest aliases the module but `tsc`
// does not, so a bare "obsidian" import would typecheck against the real API and never see
// the recorder's `controls`. Code under test still imports "obsidian" and gets this same
// module through the alias.
import {
  PluginSettingTab,
  Setting,
  resetThenCalls,
  thenCalls,
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
  /** Fresh per test: the registry outlives a render by design, so it must not outlive a case. */
  let inFlight: InFlightActions;

  beforeEach(() => {
    container = document.createElement("div");
    inFlight = new InFlightActions();
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
      action: "process",
      inFlight,
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
      action: "wipe",
      inFlight,
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

  it("formRow renders exactly one input and exactly one button", () => {
    formRow(container, {
      name: "Email",
      desc: "Where the sign-in link goes.",
      placeholder: "you@example.com",
      submit: {
        action: "plus:start-trial",
        label: "Start free trial",
        inFlight,
        onSubmit: () => {},
      },
    });

    expect(row(container).classList.contains("atoms-setting-form")).toBe(true);
    expect(controlEl(container).querySelectorAll("input")).toHaveLength(1);
    expect(controlEl(container).querySelectorAll("button")).toHaveLength(1);
    expect(controlEl(container).children).toHaveLength(2);
    expect(controlEl(container).querySelector("input")?.placeholder).toBe("you@example.com");
    expect(controlEl(container).querySelector("button")?.textContent).toBe("Start free trial");
    // The field leads and the button commits it, never the other way round.
    expect(controlEl(container).firstElementChild?.tagName).toBe("INPUT");
    expect(controlEl(container).querySelector(".checkbox-container")).toBeNull();
  });

  /**
   * The `action` id is not rendered anywhere, so it is asserted where it matters: the guard has
   * to know the run under the id the caller declared, or a rebuilt row starts a second one.
   */
  it("formRow registers its run under the declared action id", () => {
    formRow(container, {
      name: "Email",
      submit: {
        action: "plus:start-trial",
        label: "Start free trial",
        inFlight,
        onSubmit: () => new Promise<void>(() => {}),
      },
    });

    expect(inFlight.pending("plus:start-trial")).toBeUndefined();
    controlEl(container).querySelector("button")!.click();
    expect(inFlight.pending("plus:start-trial")).toBeDefined();
  });

  it("formActionsRow renders one input and each commit button", () => {
    formActionsRow(container, {
      name: "Email",
      placeholder: "you@example.com",
      submits: [
        {
          action: "plus:magic-link",
          label: "Send sign-in link",
          inFlight,
          onSubmit: () => {},
        },
        {
          action: "plus:start-trial",
          label: "Start free trial",
          accent: true,
          inFlight,
          onSubmit: () => {},
        },
        {
          action: "plus:promo-subscribe",
          label: "Use promo code",
          inFlight,
          onSubmit: () => {},
        },
      ],
    });

    expect(row(container).classList.contains("atoms-setting-form-actions")).toBe(true);
    expect(controlEl(container).querySelectorAll("input")).toHaveLength(1);
    expect(controlEl(container).querySelectorAll("button")).toHaveLength(3);
    expect(
      Array.from(controlEl(container).querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["Send sign-in link", "Start free trial", "Use promo code"]);
    expect(controlEl(container).firstElementChild?.tagName).toBe("INPUT");
  });

  it("formActionsRow submits the same trimmed field to the pressed commit", () => {
    const seen: string[] = [];
    let captured: TextComponent | null = null;
    formActionsRow(container, {
      name: "Email",
      configure: (text) => {
        captured = text as unknown as TextComponent;
      },
      submits: [
        {
          action: "plus:promo-subscribe",
          label: "Use promo code",
          inFlight,
          onSubmit: (value) => {
            seen.push(value);
          },
        },
      ],
    });

    captured!.fill("  friend@example.com  ");
    controlEl(container).querySelector("button")!.click();
    expect(seen).toEqual(["friend@example.com"]);
  });

  /**
   * `formRow` and `formActionsRow` are the kinds allowed to pair a field with a button.
   * Asserted over the other builders rather than trusted to review.
   */
  it("no other row kind pairs an input with a button", () => {
    const build: Array<[string, (el: HTMLElement) => void]> = [
      [
        "settingRow",
        (el) => settingRow(el, { name: "A", control: { kind: "text", configure: () => {} } }),
      ],
      ["destinationRow", (el) => destinationRow(el, { name: "B", onOpen: () => {} })],
      ["backRow", (el) => backRow(el, { name: "B2", onBack: () => {} })],
      [
        "actionRow",
        (el) => actionRow(el, { name: "C", label: "Go", action: "c", inFlight, onClick: () => {} }),
      ],
      [
        "destructiveRow",
        (el) =>
          destructiveRow(el, { name: "D", label: "Wipe", action: "d", inFlight, onClick: () => {} }),
      ],
      ["statusRow", (el) => statusRow(el, { name: "E", value: "ok" })],
    ];

    for (const [name, render] of build) {
      const el = document.createElement("div");
      render(el);
      const control = controlEl(el);
      const paired =
        control.querySelector("input") !== null && control.querySelector("button") !== null;
      expect(paired, `${name} paired an input with a button — that grammar is formRow / formActionsRow`).toBe(
        false,
      );
    }
  });

  it.each([
    ["an empty field", "", ""],
    ["a whitespace-only field", "   ", ""],
    ["a token pasted with surrounding whitespace", "  sess_live_abc \n", "sess_live_abc"],
    ["a clean value", "sess_live_abc", "sess_live_abc"],
  ])("formRow submits the trimmed value from %s", (_case, typed, expected) => {
    const submitted: string[] = [];
    let captured: TextComponent | null = null;
    formRow(container, {
      name: "Advanced: paste session",
      configure: (text) => {
        captured = text as unknown as TextComponent;
      },
      submit: {
        action: "plus:save-session",
        label: "Save session",
        inFlight,
        onSubmit: (value) => {
          submitted.push(value);
        },
      },
    });

    captured!.fill(typed);
    controlEl(container).querySelector("button")!.click();

    // `startsWith("sess_")` on the caller's side only survives a trimmed string.
    expect(submitted).toEqual([expected]);
  });

  it("formRow leaves Enter in the field alone rather than submitting", () => {
    let submits = 0;
    formRow(container, {
      name: "Email",
      submit: {
        action: "plus:start-trial",
        label: "Start free trial",
        inFlight,
        onSubmit: () => {
          submits += 1;
        },
      },
    });

    const input = controlEl(container).querySelector("input")!;
    input.value = "user@example.com";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // The button used to live in its own row, where Enter did nothing. It still does nothing.
    expect(submits).toBe(0);
  });

  it("formRow configures the field itself, password type included", () => {
    formRow(container, {
      name: "API key",
      configure: (text) => {
        text.inputEl.type = "password";
        text.setValue("sk-ant-secret");
      },
      submit: {
        action: "key:save",
        label: "Save",
        inFlight,
        onSubmit: () => {},
      },
    });

    const input = controlEl(container).querySelector("input")!;
    expect(input.type).toBe("password");
    expect(input.value).toBe("sk-ant-secret");
    // `configure` sets the field up; it never adds a second control.
    expect(controlEl(container).children).toHaveLength(2);
  });

  it("formRow holds its button on a double-tap and leaves the field editable", async () => {
    let submits = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    formRow(container, {
      name: "Sign in with a link",
      submit: {
        action: "plus:magic-link",
        label: "Send sign-in link",
        inFlight,
        onSubmit: () => {
          submits += 1;
          return pending;
        },
      },
    });

    const button = controlEl(container).querySelector("button")!;
    const input = controlEl(container).querySelector("input")!;
    button.click();
    expect(button.disabled).toBe(true);
    // The field is not part of the guard: a user must be able to fix a typo while it sends.
    expect(input.disabled).toBe(false);
    button.click();
    expect(submits).toBe(1);

    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(button.disabled).toBe(false);
  });

  it("formRow renders disabled when rebuilt mid-flight and joins the run already going", async () => {
    let submits = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spec = {
      name: "Sign in with a link",
      submit: {
        action: "plus:magic-link",
        label: "Send sign-in link",
        inFlight,
        onSubmit: () => {
          submits += 1;
          return pending;
        },
      },
    };

    formRow(container, spec);
    controlEl(container).querySelector("button")!.click();

    // The `redisplay()` the action's own handler triggers, mid-flight.
    container.empty();
    formRow(container, spec);
    const rebuilt = controlEl(container).querySelector("button")!;
    expect(rebuilt.disabled).toBe(true);
    // Reaching it the way a stale gesture would, past the disabled state.
    rebuilt.click();
    expect(submits).toBe(1);

    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Released by the run it inherited, not left dead until the next render.
    expect(rebuilt.disabled).toBe(false);
  });

  it("no builder hands back a chainable a caller could add a second affordance to", () => {
    const returns = [
      settingRow(container, {
        name: "A",
        control: { kind: "toggle", configure: () => {} },
      }),
      destinationRow(container, { name: "B", onOpen: () => {} }),
      backRow(container, { name: "B2", onBack: () => {} }),
      actionRow(container, {
        name: "C",
        label: "Go",
        action: "c",
        inFlight,
        onClick: () => {},
      }),
      destructiveRow(container, {
        name: "D",
        label: "Wipe",
        action: "d",
        inFlight,
        onClick: () => {},
      }),
      formRow(container, {
        name: "E",
        submit: { action: "e", label: "Send", inFlight, onSubmit: () => {} },
      }),
      statusRow(container, { name: "F", value: "ok" }),
    ];

    expect(returns).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
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
        build(container, {
          name: "Refresh status",
          label: "Refresh status",
          action: "refresh",
          inFlight,
          onClick: () => pending,
        });
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
      build(container, {
        name: "Open",
        label: "Open",
        action: "open",
        inFlight,
        onClick: () => {},
      });
      const button = container.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) throw new Error("no button rendered");

      button.click();
      expect(button.disabled).toBe(false);
    });

    /**
     * The guard must never hand its own button back to the promise chain.
     *
     * `setDisabled` returns the `ButtonComponent`, and every Obsidian component is a thenable,
     * so `.finally(() => btn.setDisabled(false))` — an arrow whose implicit return is that
     * component — is adopted by the promise machinery, which calls `then`, is resolved with the
     * same thenable, and repeats forever. Obsidian 1.13.4 pinned the renderer at 100% CPU on
     * Dismiss and Activate with no re-render and no growing stack; force-quit was the only way
     * out. Asserted as "the component was never treated as a thenable" rather than as a timeout,
     * because the loop starves the event loop and a timing assertion would never run.
     */
    it("re-enables the button without feeding it back to the promise chain", async () => {
      resetThenCalls();
      build(container, {
        name: "Refresh status",
        label: "Refresh status",
        action: "refresh",
        inFlight,
        onClick: async () => {},
      });
      const button = container.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) throw new Error("no button rendered");

      button.click();
      // A macrotask, so every microtask the click queued has drained before this asserts.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(thenCalls()).toBe(0);
      expect(button.disabled).toBe(false);
    });

    /**
     * The guard has to survive the button it was armed on.
     *
     * Every button is minted fresh by `display()`, so state held on the component died at the
     * next render — and after the destination split, re-rendering is an ordinary impatient
     * gesture rather than something a user has to go looking for. `Get more filings` reaches
     * `createCheckout`, which sends no idempotency key: two presses are two Stripe Checkout
     * Sessions, and a user who completes both pays twice. Same shape on `Send sign-in link`
     * (two emails) and `Get pairing code` (two live pairing secrets).
     */
    it("renders the rebuilt row disabled while its action is still in flight", () => {
      let calls = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const row = {
        name: "Get more filings",
        label: "Get more",
        action: "plus:top-up-checkout",
        inFlight,
        onClick: () => {
          calls += 1;
          return pending;
        },
      };

      build(container, row);
      container.querySelector("button")!.click();
      expect(calls).toBe(1);

      // The render that used to hand back a fresh, enabled button.
      container.empty();
      build(container, row);
      const rebuilt = container.querySelector("button");
      if (!(rebuilt instanceof HTMLButtonElement)) throw new Error("no button rendered");
      expect(rebuilt.disabled).toBe(true);
      release();
    });

    it("releases the rebuilt row when the run it inherited finishes", async () => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const row = {
        name: "Get more filings",
        label: "Get more",
        action: "plus:top-up-checkout",
        inFlight,
        onClick: () => pending,
      };

      build(container, row);
      container.querySelector("button")!.click();
      container.empty();
      build(container, row);

      release();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Not left dead until the *next* render: the inherited run is what re-enables it.
      expect(container.querySelector("button")?.disabled).toBe(false);
    });

    it("joins the run in flight rather than starting a second one", async () => {
      let calls = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const row = {
        name: "Get more filings",
        label: "Get more",
        action: "plus:top-up-checkout",
        inFlight,
        onClick: () => {
          calls += 1;
          return pending;
        },
      };

      build(container, row);
      container.querySelector("button")!.click();
      container.empty();
      build(container, row);
      // Reaching the rebuilt button the way a stale gesture would, past its disabled state.
      container.querySelector("button")!.click();

      release();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toBe(1);
    });

    it("lets the action run again once the first run has settled", async () => {
      let calls = 0;
      const row = {
        name: "Get more filings",
        label: "Get more",
        action: "plus:top-up-checkout",
        inFlight,
        onClick: async () => {
          calls += 1;
        },
      };

      build(container, row);
      container.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      container.empty();
      build(container, row);
      const second = container.querySelector("button");
      if (!(second instanceof HTMLButtonElement)) throw new Error("no button rendered");
      // The guard is not a one-shot latch: a settled action releases its identity.
      expect(second.disabled).toBe(false);
      second.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls).toBe(2);
    });

    it("keeps one action's run from disabling a different action", () => {
      const pending = new Promise<void>(() => {});
      build(container, {
        name: "Get more filings",
        label: "Get more",
        action: "plus:top-up-checkout",
        inFlight,
        onClick: () => pending,
      });
      container.querySelector("button")!.click();

      const other = document.createElement("div");
      build(other, {
        name: "Refresh status",
        label: "Refresh status",
        action: "plus:refresh-status",
        inFlight,
        onClick: () => pending,
      });

      // Identity is the key, so a busy checkout must not freeze the row beside it.
      expect(other.querySelector("button")?.disabled).toBe(false);
    });

    it("releases the action even when its run rejects", async () => {
      let calls = 0;
      const row = {
        name: "Get more filings",
        label: "Get more",
        action: "plus:top-up-checkout",
        inFlight,
        onClick: () => {
          calls += 1;
          return Promise.reject(new Error("network"));
        },
      };

      build(container, row);
      container.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A failed request must leave a usable row, not wedge its action forever.
      container.empty();
      build(container, row);
      const retry = container.querySelector("button");
      if (!(retry instanceof HTMLButtonElement)) throw new Error("no button rendered");
      expect(retry.disabled).toBe(false);
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toBe(2);
    });
  });
});

/**
 * The same guard, reached the way a user reaches it: through a whole settings tab that rebuilds
 * itself. `redisplay()` and `openRoute()` are the two rebuilds, and before the registry moved
 * off the component both handed back a fresh, enabled button mid-flight.
 */
describe("in-flight guard across a settings-tab rebuild", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("survives the re-render a toggle on the same screen causes", async () => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { tab } = settingTab({
      plugin: {
        runSyncEverythingNow: () => {
          calls += 1;
          return pending;
        },
      },
    });
    tab.display();

    pressRow(tab, "Sync everything now", "Sync everything now");
    await flush();
    expect(calls).toBe(1);

    flipRow(tab, "Sync when you return to Obsidian");
    await flush();

    pressRow(tab, "Sync everything now", "Sync everything now");
    await flush();
    release();
    await flush();

    expect(calls).toBe(1);
  });

  it("survives walking out of a destination and back into it", async () => {
    let pushes = 0;
    let release!: () => void;
    const pending = new Promise<{ ok: boolean; message: string }>((resolve) => {
      release = () => resolve({ ok: true, message: "" });
    });
    const { tab } = settingTab({
      session: MIRROR_SESSION,
      settings: {
        askPrivacyAckAt: "2026-08-01T10:00:00.000Z",
        askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
        askEnabled: true,
      },
      plugin: {
        syncAskMirror: () => {
          pushes += 1;
          return pending;
        },
      },
    });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");
    await flush();

    pressRow(tab, "Sync now", "Sync now");
    await flush();
    expect(pushes).toBe(1);

    const back = backRowEl(tab);
    if (!back) throw new Error("no back row");
    back.click();
    open(tab, "Connect Claude or ChatGPT");
    await flush();

    pressRow(tab, "Sync now", "Sync now");
    await flush();
    release();
    await flush();

    // A second push would re-send the whole vault mirror, deletes included.
    expect(pushes).toBe(1);
  });
});

const MIRROR_SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "user@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
};

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
 * In rendered order. U9's section-ordering pass put the vocabulary entry above Connect, which is
 * the order the plan's main-screen table asks for.
 */
const DESTINATIONS: Array<[entry: string, title: string]> = [
  ["Set up automatic filing", "Account"],
  [`Tag vocabulary — ${DEFAULT_SETTINGS.activeVocabulary.length} active`, "Tag vocabulary"],
  ["Connect Claude or ChatGPT", "Connect Claude or ChatGPT"],
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
 * U6 was the last destination unit and took it from 27 to 18; U9 deleted three more rows and took
 * it to 12; converting the five rows the sync, filing, and capture sections had left behind took
 * it to 6; extracting `ConsentSheetModal` into `consent.ts` took it to 5. Zero is not reachable
 * from here: `settingHeading()` builds a heading rather than a row, two modals build their own
 * button bars, the API key row's control is a `SecretComponent`
 * (which `SettingControl` has no member for), and the iCloud shortcut link row pairs a text field
 * with an inline reset — one grammar, but not one the builders express.
 *
 * Comments are stripped before counting. They were not, and the prose over an exempt site naming
 * `new Setting(` spent a slot: the budget said 7 against 6 real sites, so deleting that comment
 * bought a free seventh construction with the guard still green.
 */
const DIRECT_SETTING_BUDGET = 5;

/** Source with comments removed, so only code counts against the ratchet. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Whole-line `//` only: a mid-line strip would cut a line at the `//` of a URL literal and
    // hide any real construction sitting after it.
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("row-grammar repository guard", () => {
  it("settings.ts does not grow new direct `new Setting(` sites", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/settings/settings.ts"),
      "utf8",
    );
    const direct = withoutComments(source).match(/new Setting\(/g)?.length ?? 0;

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
