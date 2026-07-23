import { describe, expect, it } from "vitest";
import {
  collectEntityInvites,
  entityInviteCopy,
  formatEntityHubMarkdown,
  suggestEntityHubLabelFromText,
} from "../src/pipeline/entityInvite";
import {
  rescueEntityListCapture,
  suggestEntityHubLabel,
} from "../src/pipeline/enrich/entityLinks";

describe("suggestEntityHubLabel", () => {
  it("extracts Yosemite packing", () => {
    expect(suggestEntityHubLabel("pack bug spray for Yosemite packing")).toBe(
      "Yosemite packing",
    );
    expect(
      suggestEntityHubLabelFromText("also pack trail mix for Yosemite packing"),
    ).toBe("Yosemite packing");
  });

  it("extracts from trip phrasing", () => {
    expect(suggestEntityHubLabel("pack hat for the Yosemite trip")).toBe(
      "Yosemite packing",
    );
  });

  it("skips soft camping alone", () => {
    expect(suggestEntityHubLabel("pack hat for the camping trip")).toBeNull();
  });
});

describe("rescueEntityListCapture", () => {
  it("promotes packing noise to atom", () => {
    const out = rescueEntityListCapture("pack bug spray for Yosemite packing", {
      verdict: "noise",
      title: "",
      tags: [],
      proposed_tags: [],
      links: [],
    });
    expect(out.verdict).toBe("atom");
    expect(out.title.length).toBeGreaterThan(0);
    expect(out.tags).toContain("list");
  });
});

describe("collectEntityInvites", () => {
  const atom = (path: string, title: string, body: string) => ({
    path,
    title,
    content: `---
generated-by: linker
---
${body}
`,
  });

  it("invites when packing atoms lack hub", () => {
    const atoms = [
      atom(
        "Atoms/a.md",
        "Bug spray",
        "pack bug spray for Yosemite packing",
      ),
      atom(
        "Atoms/b.md",
        "Hat",
        "pack a hat for Yosemite packing",
      ),
    ];
    const invites = collectEntityInvites(atoms, ["Camping", "Alex"], {
      minMembers: 1,
    });
    expect(invites.length).toBeGreaterThanOrEqual(1);
    expect(invites[0]!.label.toLowerCase()).toContain("yosemite");
    expect(invites[0]!.memberPaths.length).toBe(2);
  });

  it("no invite when hub already exists", () => {
    const atoms = [
      atom("Atoms/a.md", "Bug spray", "pack bug spray for Yosemite packing"),
    ];
    const invites = collectEntityInvites(atoms, ["Yosemite packing"], {
      minMembers: 1,
    });
    expect(invites).toHaveLength(0);
  });
});

describe("entityInviteCopy", () => {
  it("has no em dash", () => {
    const c = entityInviteCopy("Yosemite packing", 2);
    expect(c.title).toBe("Make Yosemite packing?");
    expect(c.body).not.toMatch(/—/);
    expect(formatEntityHubMarkdown("Yosemite packing")).toMatch(/^# Yosemite/);
  });
});
