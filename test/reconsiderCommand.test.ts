import { beforeEach, describe, expect, it } from "vitest";
// Mock import (not "obsidian"): the Notice recorder is what proves the command ran.
import { Notice, TFile } from "./mocks/obsidian";
import AtomsPlugin from "../src/plugin/main";
import { registerAtomsCommands } from "../src/plugin/commands";
import { missNotice } from "../src/pipeline/reconsider";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../src/shared/types";

const RECONSIDER = "reconsider-capture";

interface Command {
  id: string;
  name: string;
  callback?: () => void;
}

/** A daily whose last capture carries no marker at all. */
const daily = [
  "- buy milk",
  "\t<!--linker:noise-->",
  "- unmarked thought",
  "",
].join("\n");

/**
 * Registers the real command table against a real plugin instance, so a test asserts what
 * the palette actually offers rather than inferring it from the settings screen.
 */
function registered(settings: Partial<LinkerSettings>, view: unknown = null) {
  const plugin = new AtomsPlugin();
  plugin.settings = { ...DEFAULT_SETTINGS, ...settings };
  const commands: Command[] = [];
  Object.assign(plugin, {
    app: { workspace: { getActiveViewOfType: () => view } },
    addCommand: (cmd: Command) => commands.push(cmd),
  });
  registerAtomsCommands(plugin);
  return commands;
}

function invoke(commands: Command[], id: string): void {
  const cmd = commands.find((c) => c.id === id);
  expect(cmd, `command ${id} is not registered`).toBeDefined();
  cmd!.callback?.();
}

describe("Reconsider capture command (R10)", () => {
  beforeEach(() => {
    Notice.messages = [];
  });

  it("is in the palette on a fresh install", () => {
    expect(registered({}).map((c) => c.id)).toContain(RECONSIDER);
  });

  it("is in the palette for a data.json still carrying enableReconsiderCapture: false (KTD8)", async () => {
    // The key was deleted from LinkerSettings; existing profiles keep it and it is inert.
    const stale = { enableReconsiderCapture: false } as Partial<LinkerSettings>;
    const commands = registered(stale);
    expect(commands.map((c) => c.id)).toContain(RECONSIDER);

    // Registration alone is not the contract — invoking it must reach the capture lookup
    // rather than bounce off a flag, so no notice may point back at a setting.
    invoke(commands, RECONSIDER);
    await Promise.resolve();
    expect(Notice.messages).toEqual([missNotice()]);
  });

  it("asks for a skipped capture when the cursor is on a line with no marker", async () => {
    const view = {
      file: new TFile("Daily/2026-08-05.md"),
      editor: { getValue: () => daily, getCursor: () => ({ line: 2 }) },
    };
    const commands = registered({}, view);

    invoke(commands, RECONSIDER);
    await Promise.resolve();
    expect(Notice.messages).toEqual([missNotice()]);
  });
});
