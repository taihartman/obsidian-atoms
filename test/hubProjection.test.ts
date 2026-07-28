import { describe, expect, it } from "vitest";
import {
  projectHubMarkdown,
  renderGeneratedBlock,
} from "../src/pipeline/hubProjection";
import { GENERATED_CLOSE, GENERATED_OPEN } from "../src/pipeline/hubSections";

describe("renderGeneratedBlock", () => {
  it("groups by hub sections then Unsorted; sorts titles", () => {
    const block = renderGeneratedBlock(
      [
        { title: "Z gift", section: "Gift Ideas" },
        { title: "A gift", section: "Gift Ideas" },
        { title: "loose" },
        { title: "bad sec", section: "Nope" },
      ],
      ["Gift Ideas", "Date Ideas"],
    );
    expect(block).toBe(
      [
        "## Gift Ideas",
        "- [[A gift]]",
        "- [[Z gift]]",
        "## Unsorted",
        "- [[bad sec]]",
        "- [[loose]]",
      ].join("\n"),
    );
  });
});

describe("projectHubMarkdown", () => {
  const sections = ["Gift Ideas"];

  it("appends block when none exists", () => {
    const hub = "# Nichita\n\nHuman intro.\n";
    const r = projectHubMarkdown(
      hub,
      [{ title: "Atom One", section: "Gift Ideas" }],
      sections,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("Human intro.");
    expect(r.content).toContain(GENERATED_OPEN);
    expect(r.content).toContain("- [[Atom One]]");
    expect(r.content).toContain(GENERATED_CLOSE);
  });

  it("preserves prose above and below existing block", () => {
    const above = "# N\n\nHuman above.\n\n";
    const below = "\nHuman below stays.\n";
    const hub =
      above +
      `${GENERATED_OPEN}\n## Gift Ideas\n- [[Old]]\n${GENERATED_CLOSE}` +
      below;
    const r = projectHubMarkdown(
      hub,
      [{ title: "New", section: "Gift Ideas" }],
      sections,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const open = r.content.indexOf(GENERATED_OPEN);
    const close = r.content.indexOf(GENERATED_CLOSE);
    expect(r.content.slice(0, open)).toBe(above);
    expect(r.content.slice(close + GENERATED_CLOSE.length)).toBe(below);
    expect(r.content).toContain("- [[New]]");
  });

  it("unclosed open aborts", () => {
    const hub = `x\n${GENERATED_OPEN}\n## A\n`;
    const r = projectHubMarkdown(hub, [{ title: "t" }], sections);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unclosed-generated-block");
  });

  it("idempotent second pass", () => {
    const hub = "# N\n\nProse\n";
    const entries = [{ title: "A", section: "Gift Ideas" }];
    const r1 = projectHubMarkdown(hub, entries, sections);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = projectHubMarkdown(r1.content, entries, sections);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.content).toBe(r1.content);
  });
});
