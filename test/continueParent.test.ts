import { describe, expect, it } from "vitest";
import {
  buildContinueParentBlock,
  clearContinueParent,
  continueChipLabel,
  ensureContinueDistinctTitle,
  ensureContinueParentLink,
  parseContinueParent,
  readContinueParent,
  writeContinueParent,
} from "../src/platform/continueParent";
import { relationReasonProse } from "../src/shared/relationReason";
import { buildCaptureUserMessage, contextForPlus } from "../src/pipeline/classify";
import { fingerprintPreviewKey } from "../src/platform/previewCache";
import type { ClassificationResult, VaultContext } from "../src/shared/types";

function atom(partial: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    verdict: "atom",
    title: "Child claim",
    tags: [],
    proposed_tags: [],
    links: [],
    people: [],
    ...partial,
  };
}

describe("continueParent store", () => {
  it("roundtrips write/read/clear", () => {
    const mem = new Map<string, unknown>();
    const load = (k: string) => mem.get(k);
    const save = (k: string, v: unknown) => {
      if (v === null || v === undefined) mem.delete(k);
      else mem.set(k, v);
    };
    expect(readContinueParent(load)).toBeNull();
    writeContinueParent(save, {
      title: "Sleep debt is real",
      path: "Atoms/Sleep debt is real.md",
      setAt: 100,
    });
    expect(readContinueParent(load)).toEqual({
      title: "Sleep debt is real",
      path: "Atoms/Sleep debt is real.md",
      setAt: 100,
    });
    clearContinueParent(save);
    expect(readContinueParent(load)).toBeNull();
  });

  it("parse rejects junk", () => {
    expect(parseContinueParent(null)).toBeNull();
    expect(parseContinueParent("{}")).toBeNull();
    expect(parseContinueParent({ title: "  " })).toBeNull();
    expect(parseContinueParent({ title: "Ok" })?.title).toBe("Ok");
  });
});

describe("ensureContinue*", () => {
  it("adds continues link when missing", () => {
    const r = ensureContinueParentLink(atom({ links: [] }), "Parent claim");
    expect(r.links[0]).toEqual({
      note: "Parent claim",
      reason: "continues [[Parent claim]]",
    });
  });

  it("does not duplicate existing parent link", () => {
    const r = ensureContinueParentLink(
      atom({
        links: [{ note: "Parent claim", reason: "revises [[Parent claim]]" }],
      }),
      "Parent claim",
    );
    expect(r.links).toHaveLength(1);
    expect(r.links[0]!.reason).toContain("revises");
  });

  it("forces distinct title when equal to parent", () => {
    const r = ensureContinueDistinctTitle(
      atom({ title: "Parent claim" }),
      "Parent claim",
      new Set(),
    );
    expect(r.title).toBe("Parent claim — continued");
  });

  it("disambiguates when continued title exists", () => {
    const existing = new Set(["Atoms/Parent claim — continued.md"]);
    const r = ensureContinueDistinctTitle(
      atom({ title: "Parent claim" }),
      "Parent claim",
      existing,
    );
    expect(r.title).toBe("Parent claim — continued (2)");
  });

  it("order: distinct title then link", () => {
    let r = atom({ title: "Parent", links: [] });
    r = ensureContinueDistinctTitle(r, "Parent", new Set());
    r = ensureContinueParentLink(r, "Parent");
    expect(r.title).toBe("Parent — continued");
    expect(r.links[0]!.note).toBe("Parent");
  });
});

describe("relationReasonProse", () => {
  it("matches Ask templates", () => {
    expect(relationReasonProse("continues", "A")).toBe("continues [[A]]");
    expect(relationReasonProse("revises", "A")).toBe("revises [[A]]");
    expect(relationReasonProse("contradicts", "A")).toBe("contradicts [[A]]");
    expect(relationReasonProse("adds_detail", "A")).toBe("adds detail to [[A]]");
  });
});

describe("classify continue context", () => {
  it("puts continueParent in Plus context and capture message", () => {
    const ctx: VaultContext = {
      titles: ["Parent"],
      tags: [],
      vocabulary: [],
      personHubs: [],
      personHubDetails: [],
      continueParent: { title: "Parent", path: "Atoms/Parent.md" },
    };
    const plus = contextForPlus(ctx);
    expect(plus.continueParent).toEqual({
      title: "Parent",
      path: "Atoms/Parent.md",
    });
    const msg = buildCaptureUserMessage("more thought", ctx.continueParent);
    expect(msg).toContain("### Continue parent");
    expect(msg).toContain("Title: Parent");
    expect(buildContinueParentBlock({ title: "Parent" })).toContain(
      "### Continue parent",
    );
  });

  it("preview cache key changes with parent", () => {
    const a = fingerprintPreviewKey("body", "m", 8, "none");
    const b = fingerprintPreviewKey("body", "m", 8, "Parent");
    expect(a).not.toBe(b);
  });
});

describe("continueChipLabel", () => {
  it("truncates long titles", () => {
    const long = "x".repeat(50);
    expect(continueChipLabel(long).endsWith("…")).toBe(true);
    expect(continueChipLabel("Short")).toBe("Continuing Short");
  });
});
