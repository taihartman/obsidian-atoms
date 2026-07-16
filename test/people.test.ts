import { describe, expect, it } from "vitest";
import {
  captureMentionsKey,
  discoverPersonHubs,
  enrichPersonLinks,
  frontmatterHasPersonTag,
  isPersonLikeBasename,
  meetsPersonHubThreshold,
  pathHasBoostSegment,
  pathHasAllowlistSegment,
  pathInDenylistFolder,
  personHubMissAfterEnrich,
  PERSON_HUB_TOP_N,
  scorePersonHubCandidate,
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

describe("path boost / denylist", () => {
  it("boosts Social / People / Personal notes paths", () => {
    expect(pathHasBoostSegment("Personal notes/Social/Alex.md")).toBe(true);
    expect(pathHasBoostSegment("Personal notes/Tin.md")).toBe(true);
    expect(pathHasBoostSegment("People/Alex.md")).toBe(true);
    expect(pathHasAllowlistSegment("People/Alex.md")).toBe(true); // deprecated alias
  });

  it("denies Projects / Quick Notes / Atoms folders", () => {
    expect(pathInDenylistFolder("Projects/Cooking.md")).toBe(true);
    expect(pathInDenylistFolder("Quick Notes/foo.md")).toBe(true);
    expect(pathInDenylistFolder("Atoms/Claim.md")).toBe(true);
    expect(pathInDenylistFolder("Personal notes/Social/Alex.md")).toBe(false);
  });

  it("denies any dot-prefixed folder segment (vault configDir and hidden dirs)", () => {
    expect(pathInDenylistFolder(".obsidian/plugins/foo.md")).toBe(true);
    expect(pathInDenylistFolder(".config/notes/Alex.md")).toBe(true);
    expect(pathInDenylistFolder("Personal notes/.stash/Alex.md")).toBe(true);
  });
});

describe("isPersonLikeBasename", () => {
  it("accepts ordinary person names", () => {
    expect(isPersonLikeBasename("Alex")).toBe(true);
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

describe("scorePersonHubCandidate / threshold", () => {
  it("ranks Social/People highly; Personal notes only mild", () => {
    const social = scorePersonHubCandidate({
      path: "Personal notes/Social/Alex.md",
      title: "Alex",
      hasPersonTag: false,
    });
    const bookList = scorePersonHubCandidate({
      path: "Personal notes/Book list.md",
      title: "Book list",
      hasPersonTag: false,
    });
    expect(social).toBeGreaterThan(bookList);
    expect(
      meetsPersonHubThreshold({
        score: bookList,
        path: "Personal notes/Book list.md",
        hasPersonTag: false,
      }),
    ).toBe(false);
  });

  it("requires #person or high path for bare root one-word titles", () => {
    const cooking = scorePersonHubCandidate({
      path: "Cooking/Cooking.md",
      title: "Cooking",
      hasPersonTag: false,
    });
    expect(
      meetsPersonHubThreshold({
        score: cooking,
        path: "Cooking/Cooking.md",
        hasPersonTag: false,
      }),
    ).toBe(false);

    const rootAlex = scorePersonHubCandidate({
      path: "Alex.md",
      title: "Alex",
      hasPersonTag: false,
    });
    expect(
      meetsPersonHubThreshold({
        score: rootAlex,
        path: "Alex.md",
        hasPersonTag: false,
      }),
    ).toBe(false);
    expect(
      meetsPersonHubThreshold({
        score: rootAlex + 5,
        path: "Alex.md",
        hasPersonTag: true,
      }),
    ).toBe(true);
  });
});

describe("frontmatterHasPersonTag", () => {
  it("reads string and array tags", () => {
    expect(
      frontmatterHasPersonTag({ frontmatter: { tags: ["person", "x"] } }),
    ).toBe(true);
    expect(frontmatterHasPersonTag({ frontmatter: { tags: "person" } })).toBe(
      true,
    );
    expect(frontmatterHasPersonTag({ frontmatter: { tags: ["idea"] } })).toBe(
      false,
    );
  });
});

describe("discoverPersonHubs", () => {
  it("picks Social/People people; drops Personal notes topic pages", () => {
    const hubs = discoverPersonHubs([
      { path: "Personal notes/Social/Alex.md", cache: null },
      { path: "Personal notes/Tin.md", cache: null },
      { path: "Personal notes/Social/People.md", cache: null },
      { path: "Personal notes/Book list.md", cache: null },
      { path: "Personal notes/Movie list.md", cache: null },
      { path: "Projects/Cooking.md", cache: null },
      { path: "Quick Notes/Scratch.md", cache: null },
      { path: "Cooking/Cooking.md", cache: null },
    ]);
    const titles = hubs.map((h) => h.canonicalTitle);
    expect(titles).toContain("Alex");
    expect(titles).toContain("Tin");
    expect(titles).not.toContain("People");
    expect(titles).not.toContain("Book list");
    expect(titles).not.toContain("Movie list");
    expect(titles).not.toContain("Cooking");
    expect(titles).not.toContain("Scratch");
  });

  it("includes root person only when tagged #person", () => {
    const bare = discoverPersonHubs([{ path: "Alex.md", cache: null }]);
    expect(bare).toHaveLength(0);

    const tagged = discoverPersonHubs([
      {
        path: "Alex.md",
        cache: { frontmatter: { tags: ["person"] } },
      },
    ]);
    expect(tagged.map((h) => h.canonicalTitle)).toEqual(["Alex"]);
  });

  it("includes People/ hub notes without Personal notes free pass", () => {
    const hubs = discoverPersonHubs([
      { path: "People/Jordan.md", cache: null },
      { path: "People/Riley.md", cache: null },
    ]);
    expect(hubs.map((h) => h.canonicalTitle).sort()).toEqual([
      "Jordan",
      "Riley",
    ]);
  });

  it("includes frontmatter aliases as match keys, not as separate hubs", () => {
    const hubs = discoverPersonHubs([
      {
        path: "Personal notes/Social/Alex.md",
        cache: { frontmatter: { aliases: ["Al", "Lex"] } },
      },
    ]);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.canonicalTitle).toBe("Alex");
    expect(hubs[0]!.matchKeys.map((k) => k.toLowerCase())).toEqual(
      expect.arrayContaining(["alex", "al", "lex"]),
    );
  });

  it("returns empty for empty vault", () => {
    expect(discoverPersonHubs([])).toEqual([]);
  });

  it("caps at PERSON_HUB_TOP_N by score", () => {
    const files = [];
    for (let i = 0; i < PERSON_HUB_TOP_N + 15; i++) {
      files.push({
        path: `People/Person${String(i).padStart(3, "0")}.md`,
        cache: null,
      });
    }
    // Also sprinkle lower-score Personal notes single-word names
    for (let i = 0; i < 10; i++) {
      files.push({
        path: `Personal notes/Extra${i}.md`,
        cache: null,
      });
    }
    const hubs = discoverPersonHubs(files);
    expect(hubs.length).toBeLessThanOrEqual(PERSON_HUB_TOP_N);
    // People/ should dominate over mild Personal notes
    expect(hubs.every((h) => h.path.startsWith("People/"))).toBe(true);
  });
});

describe("captureMentionsKey", () => {
  it("matches case-insensitive whole tokens and possessives", () => {
    expect(captureMentionsKey("Alex likes periwinkle", "Alex")).toBe(true);
    expect(captureMentionsKey("alex likes periwinkle", "Alex")).toBe(true);
    expect(captureMentionsKey("Alex’s pajamas", "Alex")).toBe(true);
    expect(captureMentionsKey("Alex's pajamas", "Alex")).toBe(true);
  });

  it("does not match substrings inside longer words", () => {
    expect(captureMentionsKey("Continents shift slowly", "Tin")).toBe(false);
    expect(captureMentionsKey("maximum effort", "Max")).toBe(false);
  });
});

describe("enrichPersonLinks", () => {
  const hubs = [
    {
      canonicalTitle: "Alex",
      matchKeys: ["Alex", "Al"],
      path: "Personal notes/Social/Alex.md",
    },
  ];

  it("injects link + person when model omits them on a person-shaped atom", () => {
    const result = enrichPersonLinks(
      "Alex likes periwinkle pajamas",
      atom({ title: "Alex prefers periwinkle", tags: ["preferences"] }),
      hubs,
    );
    expect(result.links.some((l) => l.note === "Alex")).toBe(true);
    expect(result.tags.map((t) => t.toLowerCase())).toContain("person");
    expect(result.verdict).toBe("atom");
    expect(result.title).toBe("Alex prefers periwinkle");
  });

  it("matches alias Al → canonical Alex", () => {
    const result = enrichPersonLinks(
      "Al likes soft pajamas",
      atom({ title: "Al prefers soft pajamas", tags: ["preferences"] }),
      hubs,
    );
    expect(result.links.find((l) => l.note === "Alex")).toBeTruthy();
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
      enrichPersonLinks("buy Alex flowers", task, hubs).links,
    ).toHaveLength(0);
  });

  it("does not duplicate existing hub link", () => {
    const result = enrichPersonLinks(
      "Alex likes teal",
      atom({
        title: "Alex prefers teal",
        tags: ["person", "preferences"],
        links: [{ note: "Alex", reason: "preference about [[Alex]]" }],
      }),
      hubs,
    );
    expect(result.links.filter((l) => l.note === "Alex")).toHaveLength(1);
  });

  it("skips bare name co-occurrence without person-shaped signal", () => {
    const result = enrichPersonLinks(
      "Meeting notes with Alex tomorrow at 3",
      atom({ title: "Meeting notes dump", tags: ["observation"] }),
      hubs,
    );
    expect(result.links).toHaveLength(0);
  });

  it("is identity when hubs empty", () => {
    const input = atom({ title: "Something", tags: ["idea"] });
    expect(enrichPersonLinks("Alex likes x", input, [])).toBe(input);
  });
});

describe("personHubMissAfterEnrich", () => {
  const hubs = [
    {
      canonicalTitle: "Alex",
      matchKeys: ["Alex"],
      path: "People/Alex.md",
    },
  ];

  it("true for person-shaped atom with no hub link", () => {
    expect(
      personHubMissAfterEnrich(
        "Alex likes teal",
        atom({ title: "Alex prefers teal", tags: ["preferences"] }),
        [],
      ),
    ).toBe(true);
  });

  it("false after repair links hub", () => {
    const repaired = enrichPersonLinks(
      "Alex likes teal",
      atom({ title: "Alex prefers teal", tags: ["preferences"] }),
      hubs,
    );
    expect(personHubMissAfterEnrich("Alex likes teal", repaired, hubs)).toBe(
      false,
    );
  });

  it("false for noise", () => {
    expect(
      personHubMissAfterEnrich(
        "buy milk",
        {
          verdict: "noise",
          title: "",
          tags: [],
          proposed_tags: [],
          links: [],
        },
        hubs,
      ),
    ).toBe(false);
  });
});
