import { StartUpPageCreateResult } from "@evenrealities/even_hub_sdk";
import { describe, expect, it, vi } from "vitest";

import { allStableStates } from "../src/app/state";
import { EvenGlassesRenderer, renderGlasses } from "../src/ui/render";
import { paginateUtf8Text } from "../src/ui/paginate";

describe("G2 rendering", () => {
  it("shows the exact local transcript before save", () => {
    const view = renderGlasses({
      screen: "confirmation",
      title: "A thought from the walk",
      transcript: "Remember the blue flowers by the east trail.",
      selectedIndex: 0,
    });
    expect(view.text).toContain("Remember the blue flowers by the east trail.");
    expect(view.items).toEqual(["Save", "Try again"]);
  });

  it("adds a selectable Return row after populated answer, match, and recent sources", () => {
    expect(renderGlasses({ screen: "answer", answer: "Friday", sources: [{ id: "a", title: "Launch" }], selectedIndex: 0 }).items).toEqual(["Launch", "Return"]);
    expect(renderGlasses({ screen: "closest-matches", matches: [{ id: "a", title: "Launch" }], selectedIndex: 0 }).items).toEqual(["Launch", "Return"]);
    expect(renderGlasses({ screen: "recent", items: [{ id: "a", title: "Launch" }], selectedIndex: 0, coverageComplete: true }).items).toEqual(["Launch", "Return"]);
  });

  it("never emits a blank 576 by 288 page for any stable U7 state", () => {
    for (const state of allStableStates()) {
      const page = renderGlasses(state);
      expect(page.width).toBe(576);
      expect(page.height).toBe(288);
      expect(page.text.trim().length + page.items.join("").trim().length).toBeGreaterThan(0);
      expect(page.items.every((item) => new TextEncoder().encode(item).byteLength <= 63)).toBe(true);
    }
  });

  it("paginates exact text without splitting UTF-8 and reconstructs the body", () => {
    const body = `${"café 🌱 記憶\n".repeat(80)}tail  `;
    const pages = paginateUtf8Text(body, 420);
    expect(pages.every((page) => page.length <= 500)).toBe(true);
    expect(pages.join("")).toBe(body);
  });

  it("serializes concurrent bridge renders so the newest state is displayed last", async () => {
    let releaseStartup!: () => void;
    const calls: string[] = [];
    const bridge = {
      createStartUpPageContainer: vi.fn(async (value: { textObject?: Array<{ content?: string }> }) => {
        calls.push(`start:${value.textObject?.[0]?.content ?? ""}`);
        await new Promise<void>((resolve) => { releaseStartup = resolve; });
        return StartUpPageCreateResult.success;
      }),
      rebuildPageContainer: vi.fn(async (value: { textObject?: Array<{ content?: string }> }) => {
        calls.push(`rebuild:${value.textObject?.[0]?.content ?? ""}`);
        return true;
      }),
    };
    const renderer = new EvenGlassesRenderer(bridge as never);
    const first = renderer.render({ screen: "checking", selectedIndex: 0 });
    const second = renderer.render({ screen: "root", selectedIndex: 0 });

    await Promise.resolve();
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1);
    expect(bridge.rebuildPageContainer).not.toHaveBeenCalled();
    releaseStartup();
    await Promise.all([first, second]);
    expect(calls).toEqual(["start:Checking device", "rebuild:Atoms"]);
  });
});
