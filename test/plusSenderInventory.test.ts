/**
 * #508 U7 — re-derive the Plus sender inventory from source.
 *
 * Neutering a guard proves the tests you already have are load-bearing. It
 * cannot catch a sender nobody listed, and that is how both #500 misses
 * happened: the claim was "every base resolution is accounted for", the claim
 * was made by reading, and the reading came up short. This plan's own first
 * table missed two.
 *
 * So the count is a test rather than a sentence. A twenty-fourth Plus sender
 * fails here instead of depending on a reviewer noticing it, and whoever adds it
 * has to say in this file which side of the line it falls on.
 *
 * Deliberately keyed by file and count, not by `file:line`: line numbers move
 * whenever anything above them does, and a census that fails on every unrelated
 * edit is a census people delete.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = "src";

/**
 * The idiom that turns the configured field into a base to talk to. Every Plus
 * request in the plugin starts at one of these, which is what makes counting
 * them a complete inventory rather than a sample.
 */
const RESOLUTION = /\|\|\s*DEFAULT_PLUS_BASE_URL/g;

/**
 * Every file that resolves a Plus base, how many times, and what those
 * resolutions carry. Change a count only together with the reason.
 *
 * "content" means capture text, atom bodies, vault paths or free text from the
 * vault, and every one of those is gated on the issuer (#508). "token" means the
 * request carries the session token and nothing from the vault; those are out of
 * scope and still reach whatever base resolves.
 */
const CENSUS: ReadonlyArray<{ file: string; count: number; carries: string }> = [
  {
    file: "src/platform/classifyAuth.ts",
    count: 1,
    carries:
      "content — the classify snapshot for Process, Preview, Update and auto-run. Gated here and backstopped in classify.ts.",
  },
  {
    file: "src/platform/filingAuth.ts",
    count: 1,
    carries: "token — the audit line that names where a session came from.",
  },
  {
    file: "src/platform/plusClient.ts",
    count: 1,
    carries: "token — the client's own default when a caller passes nothing.",
  },
  {
    file: "src/platform/plusResume.ts",
    count: 1,
    carries: "token — checkout resume polling.",
  },
  {
    file: "src/platform/plusSignIn.ts",
    count: 1,
    carries:
      "token — the magic-link exchange. There is no session yet, so there is nothing to compare a base against; the vault name it sends is recorded as accepted out of scope in the plan.",
  },
  {
    file: "src/plugin/askCoordinator.ts",
    count: 2,
    carries:
      "content — the mirror config (atom bodies, vault paths, the whole path list) and the outbox ack (plan.reason, free text). Both gated, both backstopped in plusClient.",
  },
  {
    file: "src/plugin/main.ts",
    count: 2,
    carries:
      "token — entitlement refresh and the account probe. Neither carries anything from the vault.",
  },
  {
    file: "src/settings/settings.ts",
    count: 14,
    carries:
      "one content site, thirteen token sites. The content one is the Connect destination, which publishes an origin for a third party to OAuth against and then pairs the session token to it; it is gated against the stamp. The rest are billing, entitlement, sign-out and pairing.",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("#508 — the Plus sender inventory is a test, not a claim", () => {
  it("no file resolves a Plus base without being in the census", () => {
    const found = new Map<string, number>();
    for (const path of walk(SRC_ROOT)) {
      const hits = readFileSync(path, "utf8").match(RESOLUTION)?.length ?? 0;
      if (hits) found.set(path.split("\\").join("/"), hits);
    }

    const expected = new Map(CENSUS.map((c) => [c.file, c.count]));
    // Compared as whole objects so a failure prints both sides at once: which
    // file appeared, which one moved, and by how much.
    expect(Object.fromEntries([...found].sort())).toEqual(
      Object.fromEntries([...expected].sort()),
    );
  });

  it("the census still adds up to the 23 resolutions the plan enumerated", () => {
    expect(CENSUS.reduce((n, c) => n + c.count, 0)).toBe(23);
  });

  it("every census entry says what its resolutions carry", () => {
    for (const c of CENSUS) {
      expect(c.carries, c.file).toMatch(/content|token/);
      expect(c.carries.length, c.file).toBeGreaterThan(30);
    }
  });
});

/**
 * The other half of the same idea, one layer down. `PlusMirrorConfig` is the
 * config type that carries a proven issuer, and the calls that take it are
 * exactly the calls that post vault content. A new content-bearing endpoint that
 * takes a plain `PlusClientConfig` would have no backstop, so pin the set.
 */
describe("#508 — the content-bearing Plus calls all demand a verified base", () => {
  const CONTENT_BEARING = ["askMirrorUpsert", "askMirrorDelete", "askMirrorReconcile"];

  it("exactly the registered calls take a PlusMirrorConfig", () => {
    const source = readFileSync("src/platform/plusClient.ts", "utf8");
    const found = [
      ...source.matchAll(
        /export async function (\w+)\(\s*cfg: PlusMirrorConfig,/g,
      ),
    ].map((m) => m[1]);
    expect(found.sort()).toEqual([...CONTENT_BEARING].sort());
  });

  it("each of them refuses before building a request", () => {
    const source = readFileSync("src/platform/plusClient.ts", "utf8");
    // One refusal per registered call. A new one that forgot the backstop would
    // still typecheck, because the config field alone enforces nothing.
    const refusals = source.match(/refuseUnverifiedBase\(cfg\)/g)?.length ?? 0;
    expect(refusals).toBe(CONTENT_BEARING.length);
  });
});
