/**
 * The public page must never drift from the pricing SSOT, and must never
 * contradict what the plugin itself tells users.
 *
 * This asserts both directions:
 *   1. www/dist (what actually ships) matches plus-pricing.json
 *   2. locked sentences match src/shared/plusPricing.ts verbatim
 *
 * A price change without `npm run build:www` fails here, not on tryatoms.app.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  PLUS_PRICING,
  trialFinePrint,
} from "../src/shared/plusPricing";

const repoRoot = join(__dirname, "..");
const distDir = join(repoRoot, "www", "dist");

function dist(page: string): string {
  return readFileSync(join(distDir, page), "utf8");
}

/**
 * Prose assertions run against a whitespace-normalized copy, because the
 * source is wrapped for readability and a sentence can straddle a line break.
 */
function flatten(html: string): string {
  return html.replace(/\s+/g, " ");
}

const index = flatten(dist("index.html"));
const terms = flatten(dist("terms.html"));

describe("www build output", () => {
  it("has no unsubstituted template tokens", () => {
    for (const page of ["index.html", "privacy.html", "terms.html"]) {
      expect(dist(page)).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it("ships no inline or external script", () => {
    for (const page of ["index.html", "privacy.html", "terms.html"]) {
      expect(dist(page)).not.toMatch(/<script/i);
    }
  });
});

describe("pricing matches the SSOT", () => {
  it("states the monthly price on the pricing page", () => {
    expect(index).toContain(`$${PLUS_PRICING.monthlyUsd}`);
    expect(terms).toContain(`$${PLUS_PRICING.monthlyUsd}`);
  });

  it("states the yearly price and its discount note", () => {
    expect(index).toContain(`$${PLUS_PRICING.yearlyUsd}`);
    expect(index).toContain(PLUS_PRICING.yearlyDiscountNote);
  });

  it("states the top up price and filing count", () => {
    expect(index).toContain(`$${PLUS_PRICING.topUpUsd}`);
    expect(index).toContain(String(PLUS_PRICING.topUpFilings));
    expect(terms).toContain(`$${PLUS_PRICING.topUpUsd}`);
  });

  it("states the included filings per period", () => {
    expect(index).toContain(String(PLUS_PRICING.includedFilingsPerPeriod));
    expect(terms).toContain(String(PLUS_PRICING.includedFilingsPerPeriod));
  });

  it("states the trial length", () => {
    expect(index).toContain(String(PLUS_PRICING.trialDays));
    expect(terms).toContain(String(PLUS_PRICING.trialDays));
  });
});

describe("honesty floor", () => {
  it("carries the plugin's own trial fine print verbatim", () => {
    // Locked: this is the sentence that discloses the card requirement.
    expect(index).toContain(trialFinePrint());
  });

  it("discloses that the trial requires a card", () => {
    expect(index.toLowerCase()).toContain("card required for trial");
    expect(terms.toLowerCase()).toContain("payment method is required");
  });

  it("discloses that filings do not roll over", () => {
    expect(PLUS_PRICING.rollover).toBe(false);
    expect(index.toLowerCase()).toContain("do not roll over");
    expect(terms.toLowerCase()).toContain("do not carry over");
  });

  it("names the free path and who you pay on it", () => {
    expect(index).toContain("Free");
    expect(index).toContain("You pay Anthropic directly");
  });

  it("says Atoms is an Obsidian plugin above the fold", () => {
    const hero = index.slice(0, index.indexOf('id="how"'));
    expect(hero).toContain("An Obsidian plugin");
  });

  it("states that processing sends capture text to Anthropic", () => {
    expect(index).toContain("Processing sends capture text to Anthropic");
    expect(index).toContain("We do not train on your notes");
  });

  it("states that the Ask mirror is opt in and one directional", () => {
    expect(index.toLowerCase()).toContain("one direction only");
    expect(index.toLowerCase()).toContain("opt in");
  });

  it("documents the MCP connector URL exactly once", () => {
    const hits = index.match(/https:\/\/plus\.tryatoms\.app\/mcp/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("uses no em dashes in page copy", () => {
    for (const page of ["index.html", "privacy.html", "terms.html"]) {
      expect(dist(page)).not.toContain("—");
    }
  });
});

/**
 * The page leads on recall, which is the easiest place to overclaim. Ask
 * search is literal keyword and tag scoring, writes from chat are queued, and
 * resurfacing only happens with the app open. Each of those is load bearing.
 */
describe("recall claims stay within what ships", () => {
  it("says search is keyword and tag matching, not semantic", () => {
    expect(index).toContain("not a semantic");
    expect(index).toContain("by title, tags, and text");
  });

  it("never claims semantic or AI powered search", () => {
    const forbidden = [
      "semantic search",
      "understands what you mean",
      "natural language search",
      "vector",
      "embedding",
    ];
    for (const phrase of forbidden) {
      expect(index.toLowerCase()).not.toContain(phrase);
    }
  });

  it("discloses that writes from chat are queued, not instant", () => {
    expect(index).toContain("queues a new note");
    expect(index).toContain("next time Obsidian is open");
  });

  it("says a revision creates a new atom rather than overwriting", () => {
    expect(index).toContain("It never overwrites you");
  });

  it("scopes Ask to the notes Atoms filed, never the whole vault", () => {
    expect(index).toContain(
      "Your daily notes and the rest of your vault are never sent",
    );
  });

  it("frames the scope as the reason recall works, not as a shortfall", () => {
    // Selling this as a limitation undersells the filing, which is the moat.
    expect(index).toContain("It reads the library, not the pile");
  });

  it("promises the capture shortcut only where it ships", () => {
    expect(index).toContain("shortcut on your iPhone");
    // Android capture is "later" per the constitution. Do not promise it.
    expect(index).not.toMatch(/Android[^<]{0,40}(shortcut|capture)/i);
    expect(index).not.toMatch(/(shortcut|capture)[^<]{0,40}Android/i);
  });

  it("never promises notifications, reminders, or a review queue", () => {
    // None of this ships. The words may appear, but only in a denial, so
    // assert on the affirmative constructions that would be the actual lie.
    const forbidden = [
      "we'll remind you",
      "we will remind you",
      "get notified",
      "reminds you",
      "sends you a reminder",
      "push notification",
      "spaced repetition",
      "daily review",
    ];
    for (const phrase of forbidden) {
      expect(index.toLowerCase()).not.toContain(phrase);
    }
  });

  it("states the denials that make the pull-only model honest", () => {
    expect(index).toContain("no reminders");
    expect(index).toContain("no review queue");
    expect(index).toContain("nothing is ever due");
  });

  it("says resurfacing is pull only", () => {
    expect(index).toContain("If you do not open Atoms, nothing happens.");
  });
});
