import { describe, expect, it } from "vitest";
import {
  improveClassificationLinks,
  isWeakLinkReason,
  maybeLinkPeopleIndex,
  rewriteWeakLinkReason,
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
