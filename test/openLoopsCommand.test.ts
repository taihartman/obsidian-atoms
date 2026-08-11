import { describe, expect, it } from "vitest";
import {
  applyOpenLoopFm,
  collectRedeemedParentKeys,
  isOpenNowContent,
  isProposalCandidate,
} from "../src/plugin/openLoops";
import { OPEN_LOOP_KEY, OPEN_LOOP_SOURCE_KEY } from "../src/shared/openLoop";

const intention = `---
created: 2026-08-05
generated-by: linker
tags:
  - idea
---

I will share my Claude cowork routine in the newsletter.
`;

const marked = `---
created: 2026-08-05
generated-by: linker
tags: []
${OPEN_LOOP_KEY}: active
${OPEN_LOOP_SOURCE_KEY}: inferred
---

I will share my Claude cowork routine in the newsletter.
`;

const userReject = `---
created: 2026-08-05
generated-by: linker
tags: []
${OPEN_LOOP_KEY}: not_a_loop
${OPEN_LOOP_SOURCE_KEY}: user
---

I will share my Claude cowork routine in the newsletter.
`;

describe("openLoops helpers", () => {
  it("isOpenNowContent true for active without redeems", () => {
    expect(isOpenNowContent(marked, false)).toBe(true);
  });

  it("isOpenNowContent false when inbound redeem exists", () => {
    expect(isOpenNowContent(marked, true)).toBe(false);
  });

  it("isOpenNowContent false for user not_a_loop", () => {
    expect(isOpenNowContent(userReject, false)).toBe(false);
  });

  it("collectRedeemedParentKeys reads child redeems edges", () => {
    const child = `---
tags: []
---

substance

redeems [[Newsletter idea]]
`;
    const keys = collectRedeemedParentKeys([
      { title: "Full routine", content: child },
      { title: "Newsletter idea", content: marked },
    ]);
    expect(keys.has("newsletter idea")).toBe(true);
  });

  it("proposal candidate when unmarked intention", () => {
    expect(
      isProposalCandidate(intention, "Newsletter idea share routine"),
    ).toBe(true);
  });

  it("proposal skips user sticky", () => {
    expect(isProposalCandidate(userReject, "Newsletter idea")).toBe(false);
  });

  it("applyOpenLoopFm writes user terminal", () => {
    const next = applyOpenLoopFm(intention, {
      state: "not_a_loop",
      source: "user",
    });
    expect(next).toContain(`${OPEN_LOOP_KEY}: not_a_loop`);
    expect(next).toContain(`${OPEN_LOOP_SOURCE_KEY}: user`);
    expect(isOpenNowContent(next)).toBe(false);
  });
});
