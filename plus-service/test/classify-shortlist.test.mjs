/**
 * U7 — the service must not discard the ranking the device sent.
 *
 * The device scores every note against the capture and sends the shortlist best-first.
 * Anything the service drops is a note the subscriber can no longer link to, silently.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { boundContext, buildClassifyPayload } from "../src/anthropic.mjs";

/** Titles whose received (ranked) order is deliberately the reverse of alphabetical. */
function rankedTitles(n) {
  return Array.from({ length: n }, (_, i) =>
    `Note ${String(n - i).padStart(4, "0")}`,
  );
}

/** Join context content blocks (stable + titles) the way the model reads them. */
function contextText(payload) {
  const parts = payload.messages[0].content;
  return Array.isArray(parts) ? parts.map((p) => p.text ?? "").join("") : "";
}

/** The "### Note titles" block of a built payload, as the model would read it. */
function promptTitles(payload) {
  const text = contextText(payload);
  const block = text.split("### Note titles\n")[1] ?? "";
  return block
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

describe("U7 shortlist ranking survives the Plus proxy", () => {
  beforeEach(() => {
    delete process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES;
    delete process.env.ATOMS_PLUS_MAX_LEGACY_CONTEXT_TITLES;
  });
  afterEach(() => {
    delete process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES;
    delete process.env.ATOMS_PLUS_MAX_LEGACY_CONTEXT_TITLES;
  });

  it("keeps all 400 ranked titles, in the order received", () => {
    const titles = rankedTitles(400);
    const built = buildClassifyPayload({
      capture: "walked the block and fixed the sleep thing",
      context: { titles, ranked: true, k: 400, tags: [], vocabulary: [] },
    });
    assert.equal(built.ok, true);
    assert.deepEqual(promptTitles(built.payload), titles);
  });

  it("caps by received rank, never alphabetically", () => {
    process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES = "5";
    const titles = rankedTitles(50);
    const ctx = boundContext({ titles, ranked: true });
    assert.deepEqual(ctx.titles, titles.slice(0, 5));

    // The regression this unit exists to kill: alphabetical survivors.
    const alphabetical = [...titles].sort((a, b) => a.localeCompare(b)).slice(0, 5);
    assert.notDeepEqual(ctx.titles, alphabetical);
    // "Note 0001" is the best alphabetically and the worst by rank — it must be gone.
    assert.equal(ctx.titles.includes("Note 0001"), false);
  });

  it("a legacy unranked client keeps its old 40-title behaviour", () => {
    const titles = rankedTitles(400);
    const ctx = boundContext({ titles });
    assert.equal(ctx.titles.length, 40);
    assert.deepEqual(ctx.titles, titles.slice(0, 40));
    assert.equal(ctx.ranked, false);
  });

  it("honours a device that asks for a smaller k", () => {
    const titles = rankedTitles(400);
    const ctx = boundContext({ titles, ranked: true, k: 12 });
    assert.deepEqual(ctx.titles, titles.slice(0, 12));
  });

  it("cap stays configurable via ATOMS_PLUS_MAX_CONTEXT_TITLES", () => {
    process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES = "7";
    const ctx = boundContext({ titles: rankedTitles(400), ranked: true, k: 400 });
    assert.equal(ctx.titles.length, 7);
    // A device may not ask for more than the service allows.
    process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES = "3";
    assert.equal(boundContext({ titles: rankedTitles(9), ranked: true, k: 9 }).titles.length, 3);
  });
});

describe("U7 R6 — the Plus request carries titles only", () => {
  it("rejects a body-bearing context key", () => {
    for (const key of ["bodies", "noteBodies", "contents", "excerpts"]) {
      const r = buildClassifyPayload({
        capture: "ok",
        context: { titles: ["Sleep"], [key]: ["the whole note body text"] },
      });
      assert.equal(r.ok, false, `${key} should be rejected`);
      assert.equal(r.status, 400);
    }
  });

  it("rejects multi-line text smuggled through titles", () => {
    const r = buildClassifyPayload({
      capture: "ok",
      context: { titles: ["Sleep", "Notes\n\nI slept badly last night because"] },
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("rejects a single-line title longer than any real filename", () => {
    const r = buildClassifyPayload({
      capture: "ok",
      context: { titles: ["Sleep", "x".repeat(256)] },
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("accepts a legitimately long title at the boundary", () => {
    const longTitle = "Why the ".repeat(30).trim(); // 239 chars — a real, if silly, filename
    assert.ok(longTitle.length < 256);
    const r = buildClassifyPayload({
      capture: "ok",
      context: { titles: ["Sleep", longTitle], ranked: true },
    });
    assert.equal(r.ok, true);
    assert.ok(promptTitles(r.payload).includes(longTitle));
  });

  it("a full 400-title ranked request is not rejected as oversized", () => {
    const titles = Array.from({ length: 400 }, (_, i) => `${"Long title ".repeat(20)}${i}`.trim());
    const r = buildClassifyPayload({
      capture: "x".repeat(4000),
      context: { titles, ranked: true, k: 400, tags: [], vocabulary: [] },
      // Old clients echo the whole prompt back in messagesRequest; it is ignored but counted.
      messagesRequest: { model: "ignored", messages: [{ role: "user", content: titles.join("\n") }] },
    });
    assert.equal(r.ok, true);
    assert.equal(promptTitles(r.payload).length, 400);
  });
});

describe("U7 shortlist + expansion + cache split", () => {
  beforeEach(() => {
    delete process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES;
    delete process.env.ATOMS_PLUS_MAX_LEGACY_CONTEXT_TITLES;
  });
  afterEach(() => {
    delete process.env.ATOMS_PLUS_MAX_CONTEXT_TITLES;
    delete process.env.ATOMS_PLUS_MAX_LEGACY_CONTEXT_TITLES;
  });

  it("keeps expansion titles past scored k when stats.returned says so", () => {
    // Device scored 400 and appended 32 expansion slots → 432 titles, best-first then reached.
    const titles = rankedTitles(432);
    const ctx = boundContext({
      titles,
      ranked: true,
      k: 400,
      stats: { k: 400, returned: 432, expanded: 32 },
    });
    assert.equal(ctx.titles.length, 432);
    assert.deepEqual(ctx.titles, titles);
  });

  it("cache_control sits only on the stable prefix, not the titles block", () => {
    const built = buildClassifyPayload({
      capture: "walked the block",
      context: {
        titles: rankedTitles(3),
        ranked: true,
        k: 3,
        tags: ["sleep"],
        vocabulary: ["habit"],
      },
    });
    assert.equal(built.ok, true);
    const blocks = built.payload.messages[0].content;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].cache_control?.type, "ephemeral");
    assert.equal(blocks[1].cache_control, undefined);
    assert.match(blocks[0].text, /### Active vocabulary/);
    assert.doesNotMatch(blocks[0].text, /### Note titles/);
    assert.match(blocks[1].text, /### Note titles/);
  });
});
