import { describe, expect, it } from "vitest";
import {
  bodyAfterFrontmatter,
  buildAskAtomMarkdown,
  isAskMcpContent,
  planAskOutboxApply,
} from "../src/platform/askOutbox";
import { isGeneratedAtomContent } from "../src/home/atomsHomeData";

describe("askOutbox", () => {
  it("builds ask-mcp FM structured links; no reason prose in body", () => {
    const { content, title } = buildAskAtomMarkdown({
      title: "Periwinkle still",
      body: "Nichita likes periwinkle",
      tags: ["preferences"],
      links: [{ note: "Nichita", reason: "shared favorite seasoning" }],
    });
    expect(title).toBe("Periwinkle still");
    expect(content).toContain("generated-by: ask-mcp");
    expect(content).toContain("atom-links:");
    expect(content).toContain("shared favorite seasoning");
    expect(content).not.toContain("atoms-quality:");
    // Body: capture + bare wikilink only — not "reason ([[Note]])" flattener
    const body = bodyAfterFrontmatter(content);
    expect(body).toContain("Nichita likes periwinkle");
    expect(body).toContain("[[Nichita]]");
    expect(body).not.toMatch(/shared favorite seasoning/);
    expect(isAskMcpContent(content)).toBe(true);
    expect(isGeneratedAtomContent(content)).toBe(true);
  });

  it("plans create when path free", () => {
    const plan = planAskOutboxApply(
      { title: "New thought", body: "hello" },
      "Atoms",
      null,
    );
    expect(plan.action).toBe("create");
    if (plan.action === "create") {
      expect(plan.path).toBe("Atoms/New thought.md");
      expect(plan.content).toContain("hello");
    }
  });

  it("rejects foreign collision", () => {
    const foreign = `---
created: 2026-01-01
source: "[[2026-01-01]]"
generated-by: linker
tags: []
---
other body
`;
    const plan = planAskOutboxApply(
      { title: "Same", body: "mine" },
      "Atoms",
      foreign,
    );
    expect(plan.action).toBe("reject");
  });

  it("idempotent when same ask-mcp body exists", () => {
    const built = buildAskAtomMarkdown({
      title: "Same",
      body: "mine body",
    });
    const plan = planAskOutboxApply(
      { title: "Same", body: "mine body" },
      "Atoms",
      built.content,
    );
    expect(plan.action).toBe("applied_idempotent");
  });

  it("continue link prose on child", () => {
    const { content } = buildAskAtomMarkdown({
      title: "Joke version",
      body: "It was a joke",
      links: [
        {
          note: "Andrew loves High School Musical",
          reason: "revises [[Andrew loves High School Musical]]",
        },
      ],
    });
    const body = bodyAfterFrontmatter(content);
    expect(body).toContain("It was a joke");
    expect(body).toContain("[[Andrew loves High School Musical]]");
  });
});
