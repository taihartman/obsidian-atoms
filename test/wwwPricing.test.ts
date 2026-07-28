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

/** Copy as a visitor sees it: no HTML comments, no note-to-self text. */
const visible = index.replace(/<!--[\s\S]*?-->/g, " ");

describe("www build output", () => {
  it("has no unsubstituted template tokens", () => {
    for (const page of ["index.html", "privacy.html", "terms.html"]) {
      expect(dist(page)).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it("ships exactly one same-origin script, fingerprinted, nothing inline", () => {
    // The story carousel is the only script on the site. Same origin, no
    // third parties, and the CSP in _headers allows only 'self'.
    const scripts = index.match(/<script[^>]*>/gi) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/src="\/a\/app\.[0-9a-f]{8}\.js"/);
    expect(index).not.toMatch(/<script[^>]*>[^<]/);
    for (const page of ["privacy.html", "terms.html"]) {
      expect(dist(page)).not.toMatch(/<script/i);
    }
  });

  it("assets are content-fingerprinted so deploys cannot serve stale CSS", () => {
    // Regression guard: on 2026-07-28 a deploy served new HTML with an
    // hour-cached old stylesheet and the story switcher fell apart.
    expect(index).toMatch(/href="\/a\/styles\.[0-9a-f]{8}\.css"/);
    expect(index).not.toContain('href="/styles.css"');
  });

  it("renders the default story without JavaScript", () => {
    expect(index).toContain('data-story="rel"');
  });

  it("all three storylines carry the full coordinated arc", () => {
    // Every swapped surface exists in each story, so switching never
    // strands a section in the wrong world.
    const rel = ["gift ideas for Sam?", "Sam loves yellow tulips", "Add Sam?"];
    const work = [
      "before the Priya pitch?",
      "Priya's budget freezes in November",
      "Add Priya?",
      "Also about Priya",
      "keep the slides big",
      "The invoice email? It becomes nothing",
    ];
    const self = [
      "why do my afternoons keep falling apart?",
      "Skipping lunch wrecks my afternoons",
      "Also about Energy",
      "Six notes about Running",
      "The dentist? It becomes nothing",
    ];
    for (const s of [...rel, ...work, ...self]) {
      expect(index).toContain(s);
    }
  });

  it("teases the graph honestly, in the product's own words", () => {
    // "Open atom graph" ships; the section may show it but not oversell it.
    expect(index).toContain("A little web of your life");
    expect(index).toContain("not the whole vault");
    // One constellation per story, so the graph follows the switcher.
    const graphs = index.match(/class="graph-fig"/g) ?? [];
    expect(graphs).toHaveLength(3);
    // Deep, not a demo star: a years-in library is mostly anonymous dots.
    const soft = index.match(/graph-node--soft/g) ?? [];
    expect(soft.length).toBeGreaterThan(60);
  });

  it("answers what happens when you stop paying", () => {
    expect(index).toContain("Leaving is easy");
    expect(index).toContain("Cancel Plus or uninstall the plugin");
  });

  it("scopes catch-up to BYOK until Plus supports it", () => {
    // Backfill calls requireApiKey(); Plus catch-up is issue #168. Until it
    // ships, the page must not imply a subscription covers a catch-up.
    expect(index).toContain("Bring the notes you already have");
    expect(index).toContain("runs on your own Anthropic API key");
    expect(visible).not.toMatch(/Plus[^.<]{0,60}catch-up/i);
    expect(visible).not.toMatch(/catch-up[^.<]{0,60}included with Plus/i);
  });

  it("names the three scenarios in the story nav", () => {
    for (const label of ["Relationships", "Work", "Journaling"]) {
      expect(index).toContain(`>${label}</button>`);
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

  it("qualifies automatic filing as a choice, never a default", () => {
    // Auto-run is opt-in, device-local, past days only. The heading avoids
    // time-of-day claims and the body carries the "let it" qualifier.
    expect(index).toContain("Come back and it is sorted");
    expect(index).toContain("Let it happen on its own");
    expect(index.toLowerCase()).not.toContain("files itself");
    expect(index.toLowerCase()).not.toContain("while you sleep");
    expect(index.toLowerCase()).not.toContain("overnight");
  });

  it("never uses reminder language as a chat trigger", () => {
    // The write-back mock must read as note-taking. "remember:" or "remind"
    // as a trigger contradicts the page's own not-a-reminders-app position.
    expect(index.toLowerCase()).not.toContain("remember:");
    expect(index.toLowerCase()).not.toContain("remind me");
  });

  it("shows the graph inferring, not just matching", () => {
    // The hero question never mentions flowers; the link walk finds them.
    expect(index).toContain("gift ideas for Sam?");
    expect(index).toContain("followed links from Sam");
    expect(index).toContain("because both point at Sam");
  });

  it("shows the person hub invite with a placeholder name", () => {
    expect(index).toContain("Add Sam?");
    expect(index).toContain("stays quiet for two weeks");
  });

  it("claims mind change in the product's own words", () => {
    expect(index).toContain(
      "It is the second brain that shows you when you changed your mind.",
    );
  });

  it("sells preview before write", () => {
    expect(index).toContain("See it before it writes");
    expect(index).toContain("Nothing touches your vault until you say so");
  });

  it("never ships engineering vocabulary", () => {
    for (const page of ["index.html", "privacy.html", "terms.html"]) {
      expect(flatten(dist(page)).toLowerCase()).not.toContain("constellation");
    }
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
