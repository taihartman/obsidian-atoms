import { describe, expect, it } from "vitest";
import {
  improveClassificationLinks,
  isSelfDuplicateReason,
  isWeakLinkReason,
  maybeLinkPeopleIndex,
  rewriteWeakLinkReason,
  stripSelfReferentialLinks,
  stripSelfWikilinks,
} from "../src/pipeline/enrich/linkQuality";
import type { ClassificationResult } from "../src/shared/types";

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

describe("isWeakLinkReason", () => {
  it("flags preference / media boilerplate", () => {
    expect(isWeakLinkReason("preference about [[Alex]]")).toBe(true);
    expect(isWeakLinkReason("preference or claim about [[Alex]]")).toBe(true);
    expect(isWeakLinkReason("update about [[Alex]]")).toBe(true);
    expect(isWeakLinkReason("media work to watch ([[Arrival]])")).toBe(true);
  });

  it("keeps supersession and substantive reasons", () => {
    expect(isWeakLinkReason("revises [[Old claim]]")).toBe(false);
    expect(
      isWeakLinkReason(
        "concrete aesthetic preference for gifts / clothes ([[Alex]])",
      ),
    ).toBe(false);
  });
});

describe("rewriteWeakLinkReason", () => {
  it("aesthetic cue from periwinkle capture", () => {
    const r = rewriteWeakLinkReason(
      "Alex likes the color periwinkle",
      "Alex",
      "preference about [[Alex]]",
    );
    expect(r.toLowerCase()).toMatch(/aesthetic|gift|colour|color/);
    expect(r).toContain("Alex");
  });

  it("career cue from interview capture", () => {
    const r = rewriteWeakLinkReason(
      "Alex is waiting back to hear about her interview at the hospital",
      "Alex",
    );
    expect(r.toLowerCase()).toMatch(/career|interview|follow-up|status/);
  });
});

describe("improveClassificationLinks", () => {
  it("rewrites weak reasons; leaves strong alone", () => {
    const out = improveClassificationLinks(
      "Alex likes the color periwinkle",
      atom({
        title: "Alex likes periwinkle",
        links: [
          { note: "Alex", reason: "preference about [[Alex]]" },
          { note: "Old claim", reason: "revises [[Old claim]]" },
        ],
      }),
    );
    expect(isWeakLinkReason(out.links[0]!.reason)).toBe(false);
    expect(out.links[1]!.reason).toBe("revises [[Old claim]]");
  });
});

describe("stripSelfReferentialLinks", () => {
  it("drops links whose note equals the atom title", () => {
    const title = "Nichita likes the color periwinkle";
    const out = stripSelfReferentialLinks(
      atom({
        title,
        links: [
          {
            note: title,
            reason: `duplicate of existing note ([[${title}]])`,
          },
          { note: "Nichita", reason: "preference about [[Nichita]]" },
        ],
      }),
    );
    expect(out.links.map((l) => l.note)).toEqual(["Nichita"]);
  });

  it("strips self wikilinks and drops pure self-duplicate reasons", () => {
    const title = "Christian recommended watching My Hero Academia";
    const out = stripSelfReferentialLinks(
      atom({
        title,
        links: [
          {
            note: title,
            reason: `duplicate/same recommendation already logged ([[${title}]])`,
          },
          {
            note: "My Hero Academia",
            reason: `names the show ([[My Hero Academia]]) and duplicates ([[${title}]])`,
          },
        ],
      }),
    );
    expect(out.links.every((l) => l.note !== title)).toBe(true);
    expect(out.links.some((l) => l.note === "My Hero Academia")).toBe(true);
    for (const l of out.links) {
      expect(l.reason.toLowerCase()).not.toContain(title.toLowerCase());
      expect(l.reason).not.toMatch(new RegExp(`\\[\\[${title}\\]\\]`, "i"));
    }
  });

  it("detects self-duplicate reason patterns", () => {
    expect(
      isSelfDuplicateReason(
        "duplicate/reinforces existing note on this exact preference",
        "Nichita loves pajamas",
      ),
    ).toBe(true);
    expect(isSelfDuplicateReason("revises [[Old claim]]", "New claim")).toBe(
      false,
    );
  });

  it("stripSelfWikilinks removes only self targets", () => {
    const r = stripSelfWikilinks(
      "related to [[Self Title]] and [[Other]]",
      "Self Title",
    );
    expect(r).not.toContain("Self Title");
    expect(r).toContain("[[Other]]");
  });
});

describe("maybeLinkPeopleIndex", () => {
  it("adds People when workplace-shaped and no hub", () => {
    const out = maybeLinkPeopleIndex(
      "Ning is the strong dude at CRG who wears a white collared shirt",
      atom({ title: "Ning at CRG", tags: ["person"], links: [] }),
      ["People", "Other"],
      [],
    );
    expect(out.links.some((l) => l.note === "People")).toBe(true);
  });

  it("skips when hub already linked", () => {
    const out = maybeLinkPeopleIndex(
      "Alex likes teal",
      atom({
        title: "Alex likes teal",
        links: [{ note: "Alex", reason: "durable fact about [[Alex]]" }],
      }),
      ["People", "Alex"],
      ["Alex"],
    );
    expect(out.links.some((l) => l.note === "People")).toBe(false);
  });
});
