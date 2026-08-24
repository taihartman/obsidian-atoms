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
  const header = home.root.querySelector(".atoms-home-header");
  const scroll = home.root.querySelector(".atoms-home-scroll");

  expect({
    headers: home.root.querySelectorAll(".atoms-home-header").length,
    scrolls: home.root.querySelectorAll(".atoms-home-scroll").length,
    title: home.root.querySelector(".atoms-home-title")?.textContent ?? null,
    subtitles: home.root.querySelectorAll(".atoms-home-subtitle").length,
    subtitle: home.root.querySelector(".atoms-home-subtitle")?.textContent ?? null,
    moreControls: home.root.querySelectorAll('[aria-label="More"]').length,
    todayControls: home.root.querySelectorAll('[aria-label="Open today\'s note"]').length,
    settingsControls: home.root.querySelectorAll('[aria-label="Settings"]').length,
  }).toEqual({
    headers: 1,
    scrolls: 1,
    title: "Atoms",
    subtitles: 1,
    subtitle: "Capture starts in your daily note",
    moreControls: 1,
    todayControls: 1,
    settingsControls: 1,
  });
  expect(header?.parentElement).toBe(home.root);
  expect(scroll?.parentElement).toBe(home.root);
  expect(header?.nextElementSibling).toBe(scroll);
  expect(scroll?.querySelector(".atoms-home-header")).toBeNull();
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
    "keeps the shared shell and active %s detail across repeated refreshes",
    async (_name, detail, detailSelector, detailText) => {
      const home = renderedHomeView();
      home.setOpen(detail);

      await home.refresh();
      await home.refresh();
      await home.refresh();

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

  it("auto_on leftovers yield the wait card to loop-close", () => {
    const home = renderedHomeView();
    home.setOccupancy({
      unprocessedCount: 22,
      windowUnprocessedCount: 0,
      autoRun: { enabled: true, egressAcked: true, hasKey: true },
      filingAuth: { mode: "byok" },
      loopCloseOffer: {
        loopPath: "Atoms/Car at 73042.md",
        loopTitle: "Car at 73042 miles, needs a return to QGS automotive",
        loopBody: "My miles in my car at 73042",
        readingPath: "Atoms/Car odometer 73089.md",
        readingBody: "My car is at 73089 miles",
      },
    });
    home.render();

    expect(home.root.querySelector(".atoms-home-wait-card")).toBeNull();
    expect(home.root.querySelector(".atoms-home-loop-close")).not.toBeNull();
    expect(home.root.querySelector(".atoms-home-quiet-process")).toBeNull();
  });

  it("returns nested entity siblings to its originating atom", () => {
    const home = renderedHomeView();
    home.setOpen(entityDetail("Atoms/Origin atom.md"));
    home.render();

    pressBack(home);

    expectSharedShell(home);
    expect(home.root.querySelector(".atoms-home-open-title")?.textContent).toBe("Origin atom");
    expect(home.root.querySelector(".atoms-home-open-body")?.textContent).toBe("Origin body");
    expect(home.root.querySelectorAll(".atoms-home-back")).toHaveLength(1);
  });
});
