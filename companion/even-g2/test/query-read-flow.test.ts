import { describe, expect, it } from "vitest";
import { QueryFlow } from "../src/app/queryFlow";
import { ReadFlow } from "../src/app/readFlow";

describe("G2 query and read flows", () => {
  it("keeps answer first and opens cited sources by opaque ID", async () => {
    const query = new QueryFlow({
      query: async () => ({ state: "answered", answer: "The launch is Friday.", sources: [{ id: "atm_one", title: "Launch" }] }),
    });
    expect(await query.ask("When is launch?")).toEqual({ state: "answered", answer: "The launch is Friday.", sources: [{ id: "atm_one", title: "Launch" }] });
    expect(query.openSource(0)).toBe("atm_one");
  });

  it("preserves exact body pages and restores the recent selection", async () => {
    const api = {
      recent: async () => ({ items: [{ id: "atm_one", title: "Launch" }, { id: "atm_two", title: "Other" }], next_offset: null, coverage_complete: false }),
      fetch: async (_id: string, offset: number) => offset === 0
        ? { text: "café ", position: { offset: 0, next_offset: 6 } }
        : { text: "Friday", position: { offset: 6, next_offset: null } },
    };
    const read = new ReadFlow(api);
    await read.loadRecent();
    read.select(1);
    read.select(0);
    expect((await read.openSelected()).text).toBe("café ");
    expect((await read.nextPage()).text).toBe("Friday");
    expect(read.backToList().selectedIndex).toBe(0);
    expect(read.backToList().coverageComplete).toBe(false);
  });
});
