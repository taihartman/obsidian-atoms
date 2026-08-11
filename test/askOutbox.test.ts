import { describe, expect, it } from "vitest";
import {
  bodyAfterFrontmatter,
  buildAskAtomMarkdown,
  isAskMcpContent,
  planAskOutboxApply,
} from "../src/platform/askOutbox";
import { isGeneratedAtomContent } from "../src/home/atomsHomeData";

describe("askOutbox", () => {
  it("marks open_loop agent flag as user source", () => {
    const { content } = buildAskAtomMarkdown({
      title: "Newsletter idea",
      body: "I will share my routine later.",
      openLoop: true,
    });
    expect(content).toContain("atoms-loop: active");
    expect(content).toContain("atoms-loop-source: user");
  });

  it("redeems child gets redeems prose and optional close answer", () => {
    const { content } = buildAskAtomMarkdown({
      title: "Cowork routine for atoms",
      body: "Here is the full routine…",
      parent: "Newsletter idea",
      relation: "redeems",
      closeAnswer: "write the substance from my head",
    });
    expect(content).toContain("relation: redeems");
    expect(content).toContain("redeems [[Newsletter idea]]");
    expect(content).toContain("atoms-loop-close-answer:");
  });

  it("builds Process-parity body: capture + link prose; no atom-links FM", () => {
    const { content, title } = buildAskAtomMarkdown({
      title: "Periwinkle still",
      body: "Nichita likes periwinkle",
      tags: ["preferences"],
      links: [{ note: "Nichita", reason: "shared favorite seasoning" }],
    });
    expect(title).toBe("Periwinkle still");
    expect(content).toContain("generated-by: ask-mcp");
    expect(content).not.toContain("atom-links:");
    expect(content).not.toContain("atoms-quality:");
    const body = bodyAfterFrontmatter(content);
    expect(body).toContain("Nichita likes periwinkle");
    expect(body).toMatch(/shared favorite seasoning \(\[\[Nichita\]\]\)/);
    // no bare-wikilink dump after prose
    expect(body.trimEnd()).not.toMatch(/\n\[\[Nichita\]\]\s*$/);
    expect(isAskMcpContent(content)).toBe(true);
    expect(isGeneratedAtomContent(content)).toBe(true);
  });

  it("defaults created to local wall clock (not day-only)", () => {
    const { content } = buildAskAtomMarkdown({
      title: "Timed ask",
      body: "just now",
    });
    expect(content).toMatch(
      /^created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m,
    );
    const stamped = buildAskAtomMarkdown({
      title: "Timed ask",
      body: "just now",
      created: "2026-07-27T10:29:05",
    });
    expect(stamped.content).toMatch(/^created: 2026-07-27T10:29:05$/m);
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
    expect(body).toMatch(/revises \[\[Andrew loves High School Musical\]\]/);
  });
});
