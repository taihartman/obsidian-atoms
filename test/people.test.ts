import { describe, expect, it } from "vitest";
import {
  captureMentionsKey,
  discoverPersonHubs,
  enrichPersonLinks,
  isPersonLikeBasename,
  pathHasAllowlistSegment,
  pathInDenylistFolder,
} from "../src/people";
import type { ClassificationResult } from "../src/types";

function atom(
  partial: Partial<ClassificationResult> & { title: string },
): ClassificationResult {
  return {
    verdict: "atom",
    title: partial.title,
    tags: partial.tags ?? [],
    proposed_tags: partial.proposed_tags ?? [],
    links: partial.links ?? [],
  };
}

describe("path allowlist / denylist", () => {
  it("allows Social / People / Personal notes paths", () => {
    expect(pathHasAllowlistSegment("Personal notes/Social/Nichita.md")).toBe(
      true,
    );
    expect(pathHasAllowlistSegment("Personal notes/Tin.md")).toBe(true);
    expect(pathHasAllowlistSegment("People/Alex.md")).toBe(true);
  });

  it("denies Projects / Quick Notes / Atoms folders", () => {
    expect(pathInDenylistFolder("Projects/Cooking.md")).toBe(true);
    expect(pathInDenylistFolder("Quick Notes/foo.md")).toBe(true);
    expect(pathInDenylistFolder("Atoms/Claim.md")).toBe(true);
    expect(pathInDenylistFolder("Personal notes/Social/Nichita.md")).toBe(
      false,
    );
  });
});

describe("isPersonLikeBasename", () => {
  it("accepts ordinary person names", () => {
    expect(isPersonLikeBasename("Nichita")).toBe(true);
    expect(isPersonLikeBasename("Tin")).toBe(true);
    expect(isPersonLikeBasename("Mary Jane")).toBe(true);
  });

  it("rejects denylist titles and dates", () => {
    expect(isPersonLikeBasename("People")).toBe(false);
    expect(isPersonLikeBasename("Social")).toBe(false);
    expect(isPersonLikeBasename("2026-07-14")).toBe(false);
    expect(isPersonLikeBasename("API")).toBe(false);
  });
});

describe("discoverPersonHubs", () => {
  it("picks Nichita and Tin under allowlisted paths", () => {
    const hubs = discoverPersonHubs([
      { path: "Personal notes/Social/Nichita.md", cache: null },
      { path: "Personal notes/Tin.md", cache: null },
      { path: "Personal notes/Social/People.md", cache: null },
      { path: "Projects/Cooking.md", cache: null },
      { path: "Quick Notes/Scratch.md", cache: null },
      { path: "RootOnly/Cooking.md", cache: null },
    ]);
    const titles = hubs.map((h) => h.canonicalTitle);
    expect(titles).toContain("Nichita");
    expect(titles).toContain("Tin");
    expect(titles).not.toContain("People");
    expect(titles).not.toContain("Cooking");
    expect(titles).not.toContain("Scratch");
  });

  it("includes frontmatter aliases as match keys, not as separate hubs", () => {
    const hubs = discoverPersonHubs([
      {
        path: "Personal notes/Social/Nichita.md",
        cache: { frontmatter: { aliases: ["Nic", "Nichi"] } },
      },
    ]);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.canonicalTitle).toBe("Nichita");
    expect(hubs[0]!.matchKeys.map((k) => k.toLowerCase())).toEqual(
      expect.arrayContaining(["nichita", "nic", "nichi"]),
    );
  });

  it("returns empty for empty vault", () => {
    expect(discoverPersonHubs([])).toEqual([]);
  });
});

describe("captureMentionsKey", () => {
  it("matches case-insensitive whole tokens and possessives", () => {
    expect(captureMentionsKey("Nichita likes periwinkle", "Nichita")).toBe(
      true,
    );
    expect(captureMentionsKey("nichita likes periwinkle", "Nichita")).toBe(
      true,
    );
    expect(captureMentionsKey("Nichita’s pajamas", "Nichita")).toBe(true);
    expect(captureMentionsKey("Nichita's pajamas", "Nichita")).toBe(true);
  });

  it("does not match substrings inside longer words", () => {
    expect(captureMentionsKey("Continents shift slowly", "Tin")).toBe(false);
    expect(captureMentionsKey("maximum effort", "Max")).toBe(false);
  });
});

describe("enrichPersonLinks", () => {
  const hubs = [
    {
      canonicalTitle: "Nichita",
      matchKeys: ["Nichita", "Nic"],
      path: "Personal notes/Social/Nichita.md",
    },
  ];

  it("injects link + person when model omits them on a person-shaped atom", () => {
    const result = enrichPersonLinks(
      "Nichita likes periwinkle pajamas",
      atom({ title: "Nichita prefers periwinkle", tags: ["preferences"] }),
      hubs,
    );
    expect(result.links.some((l) => l.note === "Nichita")).toBe(true);
    expect(result.tags.map((t) => t.toLowerCase())).toContain("person");
    expect(result.verdict).toBe("atom");
    expect(result.title).toBe("Nichita prefers periwinkle");
  });

  it("matches alias Nic → canonical Nichita", () => {
    const result = enrichPersonLinks(
      "Nic likes soft pajamas",
      atom({ title: "Nic prefers soft pajamas", tags: ["preferences"] }),
      hubs,
    );
    expect(result.links.find((l) => l.note === "Nichita")).toBeTruthy();
  });

  it("does not repair task or noise", () => {
    const task: ClassificationResult = {
      verdict: "task",
      title: "",
      tags: [],
      proposed_tags: [],
      links: [],
    };
    expect(
      enrichPersonLinks("buy Nichita flowers", task, hubs).links,
    ).toHaveLength(0);
  });

  it("does not duplicate existing hub link", () => {
    const result = enrichPersonLinks(
      "Nichita likes teal",
      atom({
        title: "Nichita prefers teal",
        tags: ["person", "preferences"],
        links: [{ note: "Nichita", reason: "preference about [[Nichita]]" }],
      }),
      hubs,
    );
    expect(result.links.filter((l) => l.note === "Nichita")).toHaveLength(1);
  });

  it("skips bare name co-occurrence without person-shaped signal", () => {
    const result = enrichPersonLinks(
      "Meeting notes with Nichita tomorrow at 3",
      atom({ title: "Meeting notes dump", tags: ["observation"] }),
      hubs,
    );
    expect(result.links).toHaveLength(0);
  });

  it("is identity when hubs empty", () => {
    const input = atom({ title: "Something", tags: ["idea"] });
    expect(enrichPersonLinks("Nichita likes x", input, [])).toBe(input);
  });
});
