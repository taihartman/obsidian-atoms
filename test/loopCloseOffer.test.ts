import { describe, expect, it } from "vitest";
import {
  applyRedeemsLink,
  collectLoopCloseOffers,
  loopClosePairId,
} from "../src/plugin/openLoops";

const loopAtom = (over: Partial<{ path: string; body: string; created: string }> = {}) => {
  const body =
    over.body ??
    "My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive";
  return {
    path: over.path ?? "Atoms/Car at 73042 miles, needs a return to QGS automotive.md",
    title: (over.path ?? "Atoms/Car at 73042 miles, needs a return to QGS automotive.md")
      .replace(/^Atoms\//, "")
      .replace(/\.md$/, ""),
    content: `---
created: ${over.created ?? "2026-08-18T10:42:56"}
source: "[[2026-08-18]]"
generated-by: linker
atoms-quality: 8
atoms-loop: active
atoms-loop-source: inferred
---

${body}
`,
  };
};

const readingAtom = (over: Partial<{ path: string; body: string; created: string; links: string }> = {}) => {
  const path = over.path ?? "Atoms/Car odometer reads 73089 miles.md";
  return {
    path,
    title: path.replace(/^Atoms\//, "").replace(/\.md$/, ""),
    content: `---
created: ${over.created ?? "2026-08-20T20:22:26"}
source: "[[2026-08-20]]"
generated-by: linker
atoms-quality: 8
---

${over.body ?? "My car is at 73089 miles"}
${over.links ? `\n${over.links}\n` : ""}`,
  };
};

describe("collectLoopCloseOffers", () => {
  it("offers the live pair: open car loop meets a newer car reading", () => {
    const offers = collectLoopCloseOffers([loopAtom(), readingAtom()]);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.loopBody).toContain("QGS automotive");
    expect(offers[0]!.readingBody).toBe("My car is at 73089 miles");
  });

  it("a told pair never re-offers", () => {
    const loop = loopAtom();
    const reading = readingAtom();
    const offers = collectLoopCloseOffers([loop, reading], {
      told: [loopClosePairId(loop.path, reading.path)],
    });
    expect(offers).toEqual([]);
  });

  it("a reading that already redeems the loop closes the question", () => {
    const loop = loopAtom();
    const reading = readingAtom({
      links: `- redeems [[${loop.title}]]`,
    });
    expect(collectLoopCloseOffers([loop, reading])).toEqual([]);
  });

  it("an older reading never answers a newer loop", () => {
    const offers = collectLoopCloseOffers([
      loopAtom({ created: "2026-08-21T09:00:00" }),
      readingAtom({ created: "2026-08-20T20:22:26" }),
    ]);
    expect(offers).toEqual([]);
  });

  it("an unrelated open loop never pairs with a car reading", () => {
    const offers = collectLoopCloseOffers([
      loopAtom({
        path: "Atoms/Newsletter idea share routine.md",
        body: "I will share my Claude cowork routine in the newsletter",
      }),
      readingAtom(),
    ]);
    expect(offers).toEqual([]);
  });

  it("a weight reading never answers a car loop", () => {
    const offers = collectLoopCloseOffers([
      loopAtom(),
      readingAtom({
        path: "Atoms/Weighed in at 178.md",
        body: "Weighed in at 178 this morning",
      }),
    ]);
    expect(offers).toEqual([]);
  });

  it("newest reading offers first when several qualify", () => {
    const offers = collectLoopCloseOffers([
      loopAtom(),
      readingAtom(),
      readingAtom({
        path: "Atoms/Car odometer reads 73120 miles.md",
        body: "My car is at 73120 miles",
        created: "2026-08-22T09:00:00",
      }),
    ]);
    expect(offers[0]!.readingBody).toBe("My car is at 73120 miles");
    expect(offers).toHaveLength(2);
  });
});

describe("applyRedeemsLink", () => {
  const content = `---
created: 2026-08-20T20:22:26
generated-by: linker
atoms-quality: 9
---

My car is at 73089 miles

- new reading in the [[Car at 73042 miles]] series
`;

  it("upgrades an existing series link's reason to redeems in place", () => {
    const next = applyRedeemsLink(content, "Car at 73042 miles");
    expect(next).toBeTruthy();
    expect(next!).toContain("redeems [[Car at 73042 miles]]");
    expect(next!).not.toContain("new reading in the [[Car at 73042 miles]] series");
  });

  it("appends the redeems link when no link to the loop exists", () => {
    const bare = content.replace(
      "\n- new reading in the [[Car at 73042 miles]] series\n",
      "",
    );
    const next = applyRedeemsLink(bare, "Car at 73042 miles");
    expect(next).toBeTruthy();
    expect(next!).toContain("redeems [[Car at 73042 miles]]");
  });

  it("already-redeems content changes nothing", () => {
    const done = content.replace(
      "new reading in the [[Car at 73042 miles]] series",
      "redeems [[Car at 73042 miles]]",
    );
    expect(applyRedeemsLink(done, "Car at 73042 miles")).toBe(null);
  });
});
