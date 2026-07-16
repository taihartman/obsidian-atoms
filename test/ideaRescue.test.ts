import { describe, expect, it } from "vitest";
import {
  isKeepableIdea,
  rescueKeepableIdea,
  shortTitleFromCapture,
} from "../src/pipeline/enrich/ideaRescue";
import type { ClassificationResult } from "../src/shared/types";

const starbucks = `Personal starbucks weekend working session drink order tracker website.
Please create a modern, clean website that will allow me to enter my starbucks drink orders that I order when I go to starbucks on the weekend and work on my app. I think it would be funny to publicly publish the drinks i order to track statistics about these drinks that I am ordering. This website will be live so we need a way to have me enter the drinks.`;

const tetris = `I Tetris combined with chess
I am curious what it would be like if we combined tetris and chess. Create this combination of games to work in the web browser. be creative and create a fully functional combination of these games that will be ready to be played after this prompt.`;

describe("isKeepableIdea", () => {
  it("accepts product pitches", () => {
    expect(isKeepableIdea(starbucks)).toBe(true);
    expect(isKeepableIdea(tetris)).toBe(true);
  });

  it("rejects chores", () => {
    expect(isKeepableIdea("buy milk")).toBe(false);
    expect(isKeepableIdea("email landlord about the lock")).toBe(false);
    expect(isKeepableIdea("schedule dentist")).toBe(false);
  });
});

describe("rescueKeepableIdea", () => {
  it("promotes noise product pitch to atom", () => {
    const noise: ClassificationResult = {
      verdict: "noise",
      title: "",
      tags: [],
      proposed_tags: [],
      links: [],
    };
    const out = rescueKeepableIdea(starbucks, noise, ["App ideas"]);
    expect(out.verdict).toBe("atom");
    expect(out.title.trim().length).toBeGreaterThan(0);
    expect(out.links.some((l) => l.note === "App ideas")).toBe(true);
  });

  it("leaves chores as noise", () => {
    const noise: ClassificationResult = {
      verdict: "noise",
      title: "",
      tags: [],
      proposed_tags: [],
      links: [],
    };
    expect(rescueKeepableIdea("buy milk", noise).verdict).toBe("noise");
  });

  it("does not demote atoms", () => {
    const atom: ClassificationResult = {
      verdict: "atom",
      title: "Existing",
      tags: [],
      proposed_tags: [],
      links: [],
    };
    expect(rescueKeepableIdea(starbucks, atom)).toBe(atom);
  });
});

describe("shortTitleFromCapture", () => {
  it("special-cases common idea shapes", () => {
    expect(shortTitleFromCapture(starbucks)).toMatch(/Starbucks/i);
    expect(shortTitleFromCapture(tetris)).toMatch(/Tetris/i);
  });
});
