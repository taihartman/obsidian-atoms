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
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  PLUS_PRICING,
  trialFinePrint,
} from "../src/shared/plusPricing";
// build.mjs guards its own execution, so importing it here builds nothing.
import { PAGES } from "../www/build.mjs";

const repoRoot = join(__dirname, "..");
const distDir = join(repoRoot, "www", "dist");

/**
 * Derived from the build's own page list rather than retyped here. These
 * guarantees are structural — they hold for every page the site ships — and a
 * hardcoded list silently stops covering the next page somebody adds, which is
 * exactly how /setup would have shipped untested.
 */
const ALL_PAGES: string[] = PAGES.map((p: string) => `${p}.html`);
const SCRIPTLESS_PAGES = ALL_PAGES.filter((p) => p !== "index.html");

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
    for (const page of ALL_PAGES) {
      expect(dist(page), `unsubstituted token in ${page}`).not.toMatch(
        /\{\{\w+\}\}/,
      );
    }
  });

  it("ships exactly one same-origin script, fingerprinted, nothing inline", () => {
    // The story carousel is the only script we author, and it is same origin.
    //
    // This is a claim about the built artifact, not about the served page.
    // Cloudflare Pages injects the Web Analytics beacon at the edge, so
    // static.cloudflareinsights.com never appears in dist and this count stays
    // at 1. The place that governs the served page is the CSP, locked below.
    const scripts = index.match(/<script[^>]*>/gi) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/src="\/a\/app\.[0-9a-f]{8}\.js"/);
    expect(index).not.toMatch(/<script[^>]*>[^<]/);
    for (const page of SCRIPTLESS_PAGES) {
      expect(dist(page), `script tag in ${page}`).not.toMatch(/<script/i);
    }
  });

  it("uses no inline style attributes, which the CSP silently drops", () => {
    // style-src 'self' has no 'unsafe-inline', so an inline style attribute
    // is not a shortcut, it is dead code: the rule never applies and the only
    // symptom is a console violation nobody reads.
    for (const page of ALL_PAGES) {
      expect(dist(page), `inline style in ${page}`).not.toMatch(/<[^>]+\sstyle="/);
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

/**
 * The CSP is the only thing standing between this site and an injected script,
 * and it is one line in a file nobody opens. Both failure directions are silent
 * in CI and invisible in a browser you are not looking at:
 *
 *   too narrow  → Cloudflare Web Analytics is blocked and collects nothing,
 *                 which is exactly what shipped until #182
 *   too wide    → a stray host or 'unsafe-inline' rides in on an unrelated edit
 *
 * So this locks the whole policy by exact string. Changing the CSP is allowed;
 * changing it *by accident* is not. If you meant it, update the literal.
 */
describe("Content-Security-Policy", () => {
  const EXPECTED_CSP = [
    "default-src 'none'",
    "style-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  /** The policy actually shipped to Cloudflare, read from the built artifact. */
  const csp = (() => {
    const line = dist("_headers")
      .split("\n")
      .find((l) => l.trim().startsWith("Content-Security-Policy:"));
    return line?.replace(/^\s*Content-Security-Policy:\s*/, "").trim() ?? "";
  })();

  it("ships the exact locked policy", () => {
    expect(csp).toBe(EXPECTED_CSP);
  });

  it("admits the analytics beacon by bare origin, never by path", () => {
    // Cloudflare serves the auto-injected beacon from a versioned path,
    // /beacon.min.js/v<hash>, and CSP path matching is exact when the source
    // expression does not end in "/". Cloudflare's own docs suggest
    // "static.cloudflareinsights.com/beacon.min.js", which therefore does NOT
    // match the URL they actually inject. The bare origin is the working form.
    expect(csp).toContain("https://static.cloudflareinsights.com");
    expect(csp).not.toContain("static.cloudflareinsights.com/");
  });

  it("declares connect-src so the beacon POST does not fall back to none", () => {
    // There is no inheritance from a missing directive to something permissive:
    // an absent connect-src falls back to default-src 'none', which blocks the
    // beacon's measurement POST. It must be present and it must be 'self',
    // because auto-injection reports to this site's own /cdn-cgi/rum rather
    // than to cloudflareinsights.com.
    expect(csp).toMatch(/(^|;\s*)connect-src\s+'self'\s*(;|$)/);
  });

  it("never relaxes script or style execution", () => {
    // The widening in #182 was one host. It was not permission to open these.
    for (const escape of ["unsafe-inline", "unsafe-eval", "data:", "*"]) {
      const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? "";
      const styleSrc = csp.match(/style-src[^;]*/)?.[0] ?? "";
      expect(scriptSrc, `script-src allows ${escape}`).not.toContain(escape);
      expect(styleSrc, `style-src allows ${escape}`).not.toContain(escape);
    }
  });
});

describe("navigation", () => {
  it("every in-page anchor points at a section that exists", () => {
    // A nav link to a renamed section fails silently in a browser: the click
    // just does nothing. This is the only thing that catches it.
    const hrefs = [...index.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const id of new Set(hrefs)) {
      expect(index, `no section with id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it("the top bar keeps the buy path one click away from anywhere", () => {
    const bar = index.slice(index.indexOf("<nav"), index.indexOf("</nav>"));
    expect(bar).toContain('href="#pricing"');
    // Catch-up is easy to scroll past on the way to pricing; the bar is its
    // second entrance until it earns a higher position on the page.
    expect(bar).toContain('href="#backfill"');
    expect(bar).toContain("Catch up");
  });

  it("sends the primary call to action to the price, not past it", () => {
    // Regression guard: "Get Atoms" used to jump straight to #install, so the
    // most-clicked link on the page skipped pricing entirely.
    const cta = index.match(/<a class="btn btn--primary" href="#(\w+)">Get Atoms<\/a>/);
    expect(cta?.[1]).toBe("pricing");
  });

  it("puts pricing immediately before install so the price is read first", () => {
    const pricing = index.indexOf('id="pricing"');
    const install = index.indexOf('id="install"');
    expect(pricing).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(pricing);
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

  it("names the BYOK path without calling it free", () => {
    // BYOK costs nothing to us, but Anthropic bills for usage. Saying "free"
    // next to an API key misleads, so the page never does.
    expect(index).toContain("$0");
    expect(index).toContain("to us, ever");
    expect(index).toContain("You pay Anthropic for what you use");
    expect(index).toContain("No subscription needed");
  });

  it("never calls the bring-your-own-key path free", () => {
    // "free" is only allowed where it is literally true: the trial, or
    // describing Obsidian itself (not an Atoms price claim).
    const claims = visible.match(/[^.<>]{0,70}\bfree\b[^.<>]{0,70}/gi) ?? [];
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      const allowed =
        /trial/i.test(c) ||
        /\d+ days? free/i.test(c) ||
        /obsidian/i.test(c);
      expect(allowed, `"free" used outside trial/Obsidian: ${c.trim()}`).toBe(
        true,
      );
    }
  });

  it("explains Obsidian before asking anyone to install anything", () => {
    // The guarantee is that nobody is sent to install something before learning
    // Atoms needs Obsidian and where to get it. This used to be phrased against
    // the word BRAT; the install route changed but the promise did not.
    const install = index.slice(
      index.indexOf('id="install"'),
      index.indexOf('id="privacy-summary"'),
    );
    expect(install).toContain("https://obsidian.md");
    expect(install).toContain("plugin directory");
    expect(install).toContain('href="/setup"');
    expect(index).toContain("New to Obsidian (free)?");

    const guide = flatten(dist("setup.html"));
    expect(guide).toContain("Download Obsidian");
    expect(guide.indexOf("Obsidian")).toBeLessThan(
      guide.indexOf("Install Atoms"),
    );
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

  it("shows the same sentence going in and coming back, in every story", () => {
    // The hero visual argues one thing: what you typed is what comes back,
    // unedited. That argument is carried entirely by the two copies of the
    // sentence being identical, so a copy edit to one of them turns the
    // picture into a lie. Nothing else on the page would catch it.
    const raw = dist("index.html");
    const panels = [...raw.matchAll(/<div class="hero-panel" data-s="(\w+)">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g)];
    expect(panels.length, "hero panels not found").toBe(3);
    for (const [, story, html] of panels) {
      const norm = (s: string | undefined) =>
        s?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const typed = norm(html.match(/<p class="loop-note">([\s\S]*?)<\/p>/)?.[1])
        ?.replace(/^-\s*/, "");
      const returned = norm(html.match(/<blockquote>([\s\S]*?)<\/blockquote>/)?.[1]);
      expect(typed, `${story}: no capture line`).toBeTruthy();
      expect(returned, `${story}: no quoted answer`).toBeTruthy();
      expect(typed, `${story}: capture and quote drifted apart`).toBe(returned);
    }
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

/**
 * The setup page exists because the short version dead-ended new users. These
 * guard the specific facts that made it dead-end, so a future tidy-up cannot
 * quietly drop them again.
 */
describe("setup guide", () => {
  const setup = flatten(dist("setup.html"));

  it("covers the Restricted Mode wall, which is where newcomers actually stop", () => {
    // A fresh vault ships with community plugins blocked. The old copy said
    // "install BRAT from community plugins" while they were off — verified
    // against an empty vault in docs/qa/2026-08-04-setup-walkthrough-findings.md.
    expect(setup).toContain("Restricted Mode");
    expect(setup).toContain("Turn on community plugins");
  });

  it("installs from the plugin directory, with no BRAT left anywhere", () => {
    // Atoms shipped to the community directory, which made the BRAT walkthrough
    // actively misdirecting — it sent every new reader to install a beta-plugin
    // manager they do not need. This guards the whole path, not one string: a
    // partial revert that leaves one BRAT step behind is the same defect.
    expect(setup).not.toMatch(/brat/i);
    expect(index).not.toMatch(/brat/i);
    expect(setup).toContain("Install Atoms");
  });

  it("shows how to actually open Atoms, on both platforms", () => {
    // The guide used to end at "a version number means it is installed", so a
    // reader could finish the page having never seen the product. Desktop has
    // the ribbon (src/plugin/main.ts), mobile has no ribbon at all.
    expect(setup).toContain("Open Atoms");
    expect(setup).toContain("Atoms: Open home");
    expect(setup).toMatch(/no ribbon/i);
    // The first draft said the phone's tab picker sits along the top. The
    // captured frame disproved it — .workspace-drawer-tab-select renders at
    // y=700 of an 844pt viewport. Guard the corrected direction.
    expect(setup).toContain("view picker near the bottom");
  });

  it("publishes the same MCP connector URL the plugin hands out", () => {
    // Drift guard: the page cannot be the only place this address lives, or a
    // service move silently strands every reader following the guide.
    const client = readFileSync(
      join(repoRoot, "src", "platform", "plusClient.ts"),
      "utf8",
    );
    const base = client.match(
      /DEFAULT_PLUS_BASE_URL\s*=\s*"([^"]+)"/,
    )?.[1];
    expect(base, "DEFAULT_PLUS_BASE_URL not found in plusClient.ts").toBeTruthy();
    expect(setup).toContain(`${base}/mcp`);
  });

  it("says plainly that Android has no capture shortcut yet", () => {
    // Honesty beats a recipe we cannot device-verify. If Android capture ever
    // ships, this test should fail and be rewritten, not deleted quietly.
    expect(setup).toContain("no Android equivalent yet");
  });

  it("references only screenshots that actually ship", () => {
    // A broken image in a setup guide reads as an abandoned product.
    const srcs = [...setup.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(
        existsSync(join(distDir, src.replace(/^\//, ""))),
        `missing image ${src}`,
      ).toBe(true);
    }
  });

  it("is reachable from the landing page", () => {
    expect(index).toContain('href="/setup"');
  });
});
