import { describe, expect, it } from "vitest";
import "./mocks/obsidian";
import {
  unwrapWikilinksForDisplay,
  wikiDisplaySegments,
} from "../src/shared/wikiDisplay";
import { appendWikiDisplay, claimQuote } from "../src/ui/factories";

describe("wikiDisplaySegments", () => {
  it("unwraps a title, an alias, and a heading", () => {
    expect(
      wikiDisplaySegments("new reading in the [[My car]] series"),
    ).toEqual([
      { kind: "text", text: "new reading in the " },
      { kind: "link", text: "My car" },
      { kind: "text", text: " series" },
    ]);
    expect(
      unwrapWikilinksForDisplay("logged against [[My car|the car]]"),
    ).toBe("logged against the car");
    expect(unwrapWikilinksForDisplay("see [[My car#odometer]]")).toBe(
      "see My car",
    );
  });

  it("unwraps every wikilink in one string", () => {
    expect(
      unwrapWikilinksForDisplay(
        "revises [[Old claim]] and continues [[My car]]",
      ),
    ).toBe("revises Old claim and continues My car");
    expect(
      wikiDisplaySegments("revises [[Old claim]] and continues [[My car]]"),
    ).toEqual([
      { kind: "text", text: "revises " },
      { kind: "link", text: "Old claim" },
      { kind: "text", text: " and continues " },
      { kind: "link", text: "My car" },
    ]);
  });

  it("leaves prose without brackets alone", () => {
    expect(wikiDisplaySegments("preference about Alex")).toEqual([
      { kind: "text", text: "preference about Alex" },
    ]);
    expect(unwrapWikilinksForDisplay("")).toBe("");
  });
});

describe("appendWikiDisplay", () => {
  it("paints names, not brackets", () => {
    const root = document.createElement("div");
    appendWikiDisplay(root, "new reading in the [[My car]] series");
    expect(root.textContent).toBe("new reading in the My car series");
    expect(root.textContent).not.toMatch(/\[\[/);
    const wiki = root.querySelector(".atoms-ui-wiki");
    expect(wiki?.textContent).toBe("My car");
  });
});

describe("claimQuote", () => {
  it("unwraps wikilinks in the sidebar quote", () => {
    const root = document.createElement("div");
    claimQuote(root, {
      text: "My car is at 73137 Miles\n\nnew reading in the [[My car]] series.",
    });
    expect(root.textContent).toContain("new reading in the My car series.");
    expect(root.textContent).not.toMatch(/\[\[/);
    expect(root.querySelector(".atoms-ui-wiki")?.textContent).toBe("My car");
  });
});
