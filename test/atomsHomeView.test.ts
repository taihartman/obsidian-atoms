import { describe, expect, it } from "vitest";
import {
  renderedHomeView,
  type HomeOpenFixture,
  type RenderedHomeHarness,
} from "./helpers/homeView";

const atomDetail: HomeOpenFixture = {
  kind: "atom",
  path: "Atoms/Detail.md",
  title: "Atom detail",
  body: "The detail body",
  lines: [],
  alsoAbout: null,
};

const entityDetail = (backPath: string | null): HomeOpenFixture => ({
  kind: "entity-siblings",
  backPath,
  label: "Entity siblings",
  siblings: [
    {
      path: "Atoms/Sibling.md",
      title: "Sibling",
      sourceDate: "2026-08-18",
    },
  ],
});

const pairDetail: HomeOpenFixture = {
  kind: "mind-change-pair",
  thenPath: "Atoms/Then.md",
  thenBody: "Then",
  nowPath: "Atoms/Now.md",
  nowTitle: "Mind-change detail",
  nowBody: "Now",
  relation: "revises",
  interactionNoted: true,
};

function expectSharedShell(home: RenderedHomeHarness): void {
  expect({
    headers: home.root.querySelectorAll(".atoms-home-header").length,
    scrolls: home.root.querySelectorAll(".atoms-home-scroll").length,
    title: home.root.querySelector(".atoms-home-title")?.textContent ?? null,
    moreControls: home.root.querySelectorAll('[aria-label="More"]').length,
    todayControls: home.root.querySelectorAll('[aria-label="Open today\'s note"]').length,
    settingsControls: home.root.querySelectorAll('[aria-label="Settings"]').length,
  }).toEqual({
    headers: 1,
    scrolls: 1,
    title: "Atoms",
    moreControls: 1,
    todayControls: 1,
    settingsControls: 1,
  });
}

function pressBack(home: RenderedHomeHarness): void {
  const back = home.root.querySelector(".atoms-home-back");
  expect(back).not.toBeNull();
  (back as HTMLButtonElement).click();
}

describe("AtomsHomeView shared header shell", () => {
  it("renders main home with one header, one scroll region, and all header controls", () => {
    const home = renderedHomeView();

    home.render();
    home.render();

    expectSharedShell(home);
    expect(home.root.querySelector(".atoms-home-back")).toBeNull();
  });

  it.each([
    ["atom", atomDetail, ".atoms-home-open-title", "Atom detail"],
    ["entity siblings", entityDetail(null), ".atoms-home-open-title", "Entity siblings"],
    ["mind-change pair", pairDetail, ".atoms-home-pair-title", "Mind-change detail"],
  ] as const)(
    "keeps the shared shell and active %s detail across repeated renders",
    (_name, detail, detailSelector, detailText) => {
      const home = renderedHomeView();
      home.setOpen(detail);

      home.render();
      home.render();
      home.render();

      expectSharedShell(home);
      expect(home.root.querySelector(detailSelector)?.textContent).toBe(detailText);
      expect(home.root.querySelectorAll(".atoms-home-back")).toHaveLength(1);
    },
  );

  it.each([
    ["atom", atomDetail],
    ["entity siblings opened from home", entityDetail(null)],
    ["mind-change pair", pairDetail],
  ] as const)("returns from %s to main home without duplicate chrome", (_name, detail) => {
    const home = renderedHomeView();
    home.setOpen(detail);
    home.render();

    pressBack(home);

    expectSharedShell(home);
    expect(home.root.querySelector(".atoms-home-back")).toBeNull();
  });

  it("returns nested entity siblings to its originating atom", () => {
    const home = renderedHomeView();
    home.setOpen(entityDetail("Atoms/Origin.md"));
    home.render();

    pressBack(home);

    expect(home.backPaths).toEqual(["Atoms/Origin.md"]);
    expectSharedShell(home);
    expect(home.root.querySelector(".atoms-home-open-title")?.textContent).toBe("Origin atom");
    expect(home.root.querySelectorAll(".atoms-home-back")).toHaveLength(1);
  });
});
