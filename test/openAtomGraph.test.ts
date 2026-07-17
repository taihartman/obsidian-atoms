import { describe, expect, it, vi } from "vitest";
import { applyGraphSearchFilter } from "../src/graph/openAtomGraph";

describe("applyGraphSearchFilter", () => {
  it("returns false for empty view", () => {
    expect(applyGraphSearchFilter(null, 'path:"Atoms"')).toBe(false);
    expect(applyGraphSearchFilter({}, 'path:"Atoms"')).toBe(false);
  });

  it("applies via dataEngine.setFilter", () => {
    const setFilter = vi.fn();
    const updateSearch = vi.fn();
    const ok = applyGraphSearchFilter(
      { dataEngine: { setFilter, updateSearch } },
      'path:"Atoms/a.md"',
    );
    expect(ok).toBe(true);
    expect(setFilter).toHaveBeenCalledWith('path:"Atoms/a.md"');
    expect(updateSearch).toHaveBeenCalled();
  });

  it("applies via search.setValue", () => {
    const setValue = vi.fn();
    const ok = applyGraphSearchFilter(
      {
        dataEngine: {
          filterOptions: { search: { setValue } },
          updateSearch: vi.fn(),
        },
      },
      'path:"Atoms"',
    );
    expect(ok).toBe(true);
    expect(setValue).toHaveBeenCalledWith('path:"Atoms"');
  });
});
