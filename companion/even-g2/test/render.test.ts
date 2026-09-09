import { describe, expect, it } from "vitest";

import { allStableStates } from "../src/app/state";
import { renderGlasses } from "../src/ui/render";
import { paginateUtf8Text } from "../src/ui/paginate";

describe("G2 rendering", () => {
  it("never emits a blank 576 by 288 page for any stable U7 state", () => {
    for (const state of allStableStates()) {
      const page = renderGlasses(state);
      expect(page.width).toBe(576);
      expect(page.height).toBe(288);
      expect(page.text.trim().length + page.items.join("").trim().length).toBeGreaterThan(0);
      expect(page.items.every((item) => new TextEncoder().encode(item).byteLength <= 63)).toBe(true);
    }
  });

  it("paginates exact text without splitting UTF-8 and reconstructs the body", () => {
    const body = `${"café 🌱 記憶\n".repeat(80)}tail  `;
    const pages = paginateUtf8Text(body, 420);
    expect(pages.every((page) => page.length <= 500)).toBe(true);
    expect(pages.join("")).toBe(body);
  });
});
