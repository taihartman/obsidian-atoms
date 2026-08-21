import { describe, expect, it } from "vitest";
import { looksLikeOpenLoop } from "../src/pipeline/openLoopHeuristic";
import { buildAtomMarkdown } from "../src/pipeline/render";
import {
  buildPolishedAtomMarkdown,
  buildRefreshedAtomMarkdown,
  parseImmutableFrontmatter,
} from "../src/pipeline/refreshAtoms";
import type { ClassificationResult } from "../src/shared/types";
import { OPEN_LOOP_KEY, OPEN_LOOP_SOURCE_KEY } from "../src/shared/openLoop";

const atom = (title: string, tags: string[] = ["idea"]): ClassificationResult => ({
  verdict: "atom",
  title,
  tags,
  proposed_tags: [],
  links: [],
});

describe("looksLikeOpenLoop", () => {
  it("hits the Aug 5 intention shape", () => {
    const body =
      "I have my Claude cowork routine that sort of gives me an update on my atoms from the last day things to act on in such I will share my routine for all the people to use in this newsletter.";
    expect(
      looksLikeOpenLoop(body, "Newsletter idea- share Claude cowork routine"),
    ).toBe(true);
  });

  it("rejects long substantive notes", () => {
    const body = Array(40)
      .fill("We ran the experiment at 400 degrees for 23 minutes and got a chewy crust.")
      .join(" ");
    expect(looksLikeOpenLoop(body, "Pizza dough bake")).toBe(false);
  });

  it("rejects short chores", () => {
    expect(looksLikeOpenLoop("buy milk", "Milk")).toBe(false);
  });

  it("hits the #589 return-intent shape verbatim", () => {
    expect(
      looksLikeOpenLoop(
        "My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive",
        "Car at 73042 miles, needs a return to QGS automotive",
      ),
    ).toBe(true);
  });

  it("hits bring-back and return-to intents", () => {
    expect(
      looksLikeOpenLoop("Bring the car back in once it hits 73100", ""),
    ).toBe(true);
    expect(
      looksLikeOpenLoop("Return the library books to the Main St branch", ""),
    ).toBe(true);
  });

  it("past-tense returns never open a loop", () => {
    expect(
      looksLikeOpenLoop("Took the car in, came back by lunch. All fixed.", ""),
    ).toBe(false);
    expect(
      looksLikeOpenLoop("Come back from vacation feeling rested for once", ""),
    ).toBe(false);
  });

  it("descriptive prose about coming back or returning never opens", () => {
    expect(
      looksLikeOpenLoop("Customers come back to brands that respect them", ""),
    ).toBe(false);
    expect(
      looksLikeOpenLoop("Great ideas come back to you on walks", ""),
    ).toBe(false);
    expect(
      looksLikeOpenLoop(
        "The function should return the value to the caller",
        "",
      ),
    ).toBe(false);
  });

  it("rejects finished short notes with idea/newsletter titles", () => {
    expect(
      looksLikeOpenLoop(
        "Baked at 400F for 23 minutes. Crust was chewy.",
        "Pizza dough idea",
      ),
    ).toBe(false);
    expect(
      looksLikeOpenLoop(
        "Here is the full intro paragraph I wrote for the section.",
        "Newsletter draft section",
      ),
    ).toBe(false);
  });
});

describe("buildAtomMarkdown open loop", () => {
  it("emits inferred active for intention captures", () => {
    const md = buildAtomMarkdown({
      result: atom("Newsletter idea share routine"),
      captureText:
        "I will share my Claude cowork routine for atoms in the newsletter later.",
      created: "2026-08-05",
      sourceDailyPath: "Daily/2026-08-05.md",
    });
    expect(md).toContain(`${OPEN_LOOP_KEY}: active`);
    expect(md).toContain(`${OPEN_LOOP_SOURCE_KEY}: inferred`);
  });

  it("omits loop keys for substance", () => {
    const md = buildAtomMarkdown({
      result: atom("Pizza dough bake notes"),
      captureText:
        "Baked at 400F for 23 minutes. Crust was chewy, sauce needed salt. Next time hydrate 65%.",
      created: "2026-08-05",
      sourceDailyPath: "Daily/2026-08-05.md",
    });
    expect(md).not.toContain(OPEN_LOOP_KEY);
  });
});

describe("refresh preserves open loop FM", () => {
  const old = `---
created: 2026-08-05
source: "[[2026-08-05]]"
generated-by: linker
atoms-quality: 8
quality-updated: 2026-08-05
tags:
  - idea
${OPEN_LOOP_KEY}: not_a_loop
${OPEN_LOOP_SOURCE_KEY}: user
---

I will share my routine later.
`;

  it("parseImmutableFrontmatter reads loop", () => {
    expect(parseImmutableFrontmatter(old).openLoop).toEqual({
      state: "not_a_loop",
      source: "user",
    });
  });

  it("buildRefreshedAtomMarkdown keeps user terminal", () => {
    const md = buildRefreshedAtomMarkdown({
      oldContent: old,
      captureText: "I will share my routine later.",
      result: atom("Newsletter idea"),
      title: "Newsletter idea",
    });
    expect(md).toContain(`${OPEN_LOOP_KEY}: not_a_loop`);
    expect(md).toContain(`${OPEN_LOOP_SOURCE_KEY}: user`);
  });

  it("buildRefreshedAtomMarkdown infers a loop when FM has none (#589 AE6)", () => {
    const noLoop = `---
created: 2026-08-18
source: "[[2026-08-18]]"
generated-by: linker
atoms-quality: 8
quality-updated: 2026-08-18
tags: []
---

My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive
`;
    const md = buildRefreshedAtomMarkdown({
      oldContent: noLoop,
      captureText:
        "My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive",
      result: atom("Car at 73042 miles, needs a return to QGS automotive"),
      title: "Car at 73042 miles, needs a return to QGS automotive",
    });
    expect(md).toContain(`${OPEN_LOOP_KEY}: active`);
    expect(md).toContain(`${OPEN_LOOP_SOURCE_KEY}: inferred`);
  });

  it("refresh never invents a loop for substance", () => {
    const noLoop = `---
created: 2026-08-18
source: "[[2026-08-18]]"
generated-by: linker
atoms-quality: 8
quality-updated: 2026-08-18
tags: []
---

Baked at 400F for 23 minutes. Crust was chewy.
`;
    const md = buildRefreshedAtomMarkdown({
      oldContent: noLoop,
      captureText: "Baked at 400F for 23 minutes. Crust was chewy.",
      result: atom("Pizza crust chews best at 400F for 23 minutes"),
      title: "Pizza crust chews best at 400F for 23 minutes",
    });
    expect(md).not.toContain(OPEN_LOOP_KEY);
  });

  it("buildPolishedAtomMarkdown keeps user terminal", () => {
    const md = buildPolishedAtomMarkdown({
      oldContent: old,
      captureText: "I will share my routine later.",
      result: atom("Newsletter idea"),
      title: "Newsletter idea",
    });
    expect(md).toContain(`${OPEN_LOOP_KEY}: not_a_loop`);
    expect(md).toContain(`${OPEN_LOOP_SOURCE_KEY}: user`);
  });
});
