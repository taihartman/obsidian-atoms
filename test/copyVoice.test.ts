import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `docs/voice.md` § Hard rules: **no em dashes in product-authored copy.** Use a period, a colon or
 * a comma.
 *
 * This is the plugin-wide half of that rule. It replaces `test/settingsCopyVoice.test.ts`, which
 * allowlisted five settings files — a shape that cannot scale past the tab it was written for, and
 * that silently leaves every new file uncovered. A rule nobody can fail is a rule that decays, so
 * this one is **default-deny**: every `src/**` file is covered unless the tables below name it, and
 * each exemption has to say what would let it be removed.
 *
 * Still separate, deliberately: `test/wwwPricing.test.ts` guards the built HTML under `www/dist`,
 * which is a different surface with a different build step. Composed-output assertions
 * (`test/entityInvite.test.ts`, `test/atomsHomeData.test.ts`) also stay — they check that a string
 * *assembled at runtime* carries no em dash, which a source scan cannot see.
 *
 * Only string, template and regex literals count. The rule is about copy a user reads, and prose
 * written for the next maintainer is not that, so comments are out of scope by construction.
 */

const SRC_ROOT = "src";
const EM_DASH = "—";

/** Whole files the rule cannot reach, with the reason and the thing that would lift it. */
const EXEMPT_FILES: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: "src/settings/consent.ts",
    reason:
      "Standing disclosure strings pinned to EGRESS_ACK_VERSION (KTD5, #315). They name the exact " +
      "wording a stored acknowledgment was recorded against, so rewording without bumping the " +
      "version leaves every existing device holding a record for text it never saw. That is a " +
      "data-integrity bug wearing a typography fix. Whoever bumps the version can sweep the file " +
      "and delete this entry in the same change.",
  },
];

/**
 * Model-facing blocks inside otherwise-covered files. Region rather than a list of exact lines,
 * because in both cases the whole block is frozen and listing its lines would invite editing them
 * one at a time.
 */
const EXEMPT_REGIONS: ReadonlyArray<{
  file: string;
  start: string;
  end: string;
  /**
   * How many lines the region is expected to cover. The end marker resolves to the *first* later
   * line that ends with it, and markers like `] as const;` legitimately repeat inside one file, so
   * uniqueness cannot be asserted. This can: if the intended terminator moves or disappears, the
   * region silently runs on to the next match and the span changes. Without this the staleness
   * test still passes, because a widened region contains all the em dashes the narrow one did.
   */
  spanLines: number;
  reason: string;
}> = [
  {
    file: "src/pipeline/classify.ts",
    start: "export const CLASSIFICATION_PARITY_PHRASES = [",
    end: "] as const;",
    spanLines: 9,
    reason:
      "The parity freeze itself. Every entry is a phrase that must match plus-service " +
      "classifyTemplate.mjs byte-for-byte; the list exists precisely so the words cannot drift. " +
      "Editing one here without the matching service change and Fly deploy breaks the thing the " +
      "constant is for.",
  },
  {
    file: "src/pipeline/classify.ts",
    start: "export const CLASSIFICATION_SCHEMA = {",
    end: "} as const;",
    spanLines: 75,
    reason:
      "JSON-schema `description` fields, sent to the model as part of the tool definition. Same " +
      "rationale as SYSTEM_PROMPT: model-facing instruction, never rendered to a user.",
  },
  {
    file: "src/pipeline/classify.ts",
    start: "export const SYSTEM_PROMPT = `",
    end: "`;",
    spanLines: 89,
    reason:
      "Prompt text, not product copy — no user reads it. Also frozen in practice: " +
      '"people[] — who is named, and how" is in CLASSIFICATION_PARITY_PHRASES, which must match ' +
      "plus-service classifyTemplate.mjs byte-for-byte, so an edit here is a coordinated repo + " +
      "Fly deploy. Note the prompt still teaches the model an em-dashed atom *title* as a good " +
      "example, and those titles do reach the vault — that is its own issue, not a typography fix.",
  },
  {
    file: "src/pipeline/context.ts",
    start: "export function buildContextPrefixBlock",
    // Deliberately the join, not a bare "}": the end marker matches the first line after the start
    // that ends with it, so "}" would truncate the region at the first nested brace anyone adds.
    end: '].join("\\n");',
    spanLines: 24,
    reason:
      "Feeds the Anthropic prompt-cache stable prefix. Any edit invalidates every cached prefix " +
      "and costs a full re-read on the next run, for text no user sees.",
  },
];

/**
 * One-off lines, keyed on the **exact trimmed source line** rather than a line number so an
 * exemption cannot drift onto a neighbour when the file above it changes.
 */
const EXEMPT_LINES: ReadonlyArray<{ file: string; line: string; reason: string }> = [
  {
    file: "src/home/atomsHomeView.ts",
    line:
      'text: "Filing now runs when you come back to Obsidian, not only on launch. Sync everything ' +
      'now can spend API even if automatic filing is off — same TLS path to Anthropic as before.",',
    reason:
      "The egress catch-up card. Unlike consent.ts this text is pinned by nothing, so rewording it " +
      "turns no test red — which is the problem. Its ack is a bare un-stamped boolean " +
      "(LS_EGRESS_NOTICE, src/platform/resume.ts), and it grants paid egress through " +
      "readEgressPermitted, so a reword leaves already-acked devices holding a grant against text " +
      "they never saw. That is the #315 failure class with no mechanism to catch it. Sweep this " +
      "line in the same change that gives the notice a versioned ack, not before.",
  },
  {
    file: "src/platform/continueParent.ts",
    line: "let next = `${parent} — continued`;",
    reason:
      "This becomes an atom title, and therefore a **filename on disk**. Rewording renames every " +
      "future continued atom and splits it from every one already filed. Needs a dedup and " +
      "collision story of its own, not a copy sweep.",
  },
  {
    file: "src/platform/continueParent.ts",
    line: "next = `${parent} — continued (${n})`;",
    reason: "Collision variant of the filename suffix above; same reason.",
  },
  {
    file: "src/platform/continueParent.ts",
    line: "return { ...result, title: `${parent} — continued (${Date.now()})` };",
    reason: "Last-resort collision variant of the filename suffix above; same reason.",
  },
  {
    file: "src/platform/askMirror.ts",
    line: 'export const ASK_MIRROR_COUNT_UNKNOWN = "—";',
    reason:
      "A placeholder glyph standing for 'no value', the way a table leaves an em dash in an empty " +
      "cell. Be honest about the cost: it is NOT confined to a cell. " +
      "formatAskMirrorServerCount returns it whenever the stored count is missing or blank, and " +
      "it is then interpolated into whole sentences on two surfaces -- " +
      '"Ask mirror: <dash> . sync refused, vault scan incomplete . Sync now to retry" on Atoms ' +
      "home, and the settings status line. That state is reachable, not theoretical: " +
      "clearAskMirrorDeviceState blanks the count on every wipe, and the no-server-count refusal " +
      "means precisely 'this device has never seen the cloud count'. So this is the one place the " +
      "guard's own rule is knowingly bent, and it is exempt on cost, not on principle: the glyph " +
      "is byte-pinned by tests on both surfaces. Retiring it is a copy decision, filed separately.",
  },
  {
    file: "src/platform/askMirror.ts",
    line: "/[\\s.,;:!?—-]+$/,",
    reason:
      "A character class in truncateMessage's trailing-punctuation strip. The em dash here is " +
      "behavior: removing it would leave a dangling dash on every cut message.",
  },
];

/**
 * User-facing copy that shares a file with an exempt region, and so is one bad marker away from
 * being exempted by accident. `classify.ts:881` is the case that motivated this: it is a Notice a
 * user reads, sitting below three model-facing regions in a file a whole-file exemption would have
 * swallowed. The region's end marker resolves to the *first* later line ending in `` `; ``, and
 * that Notice is a later line ending in `` `; ``.
 */
const NEVER_EXEMPT: ReadonlyArray<{ file: string; contains: string }> = [
  { file: "src/pipeline/classify.ts", contains: "Atoms Plus refused this request" },
];

/**
 * `—` and `\u{2014}`, the escape spellings of an em dash. Scanned on the raw literal text so
 * the reported line stays true, and because the rule is about what the user sees: an escape
 * renders identically and would otherwise walk straight past a guard that only looks for the
 * character. Not exhaustive by construction — a runtime `String.fromCodePoint(0x2014)` is a call
 * expression, not a literal, and no source scan can see it.
 */
const ESCAPED_EM_DASH = /\\u\{?2014\}?/i;

/**
 * 1-based line numbers whose em dash sits inside a string, template or regex literal — that is,
 * inside something a user could read, rather than in prose written for the next maintainer.
 *
 * The TypeScript parser draws that boundary, deliberately. The first cut of this guard hand-rolled
 * a scanner, and it was wrong within a day: `/^created:\s*["']?…/` in `src/resurface/resurface.ts`
 * carries a quote inside a character class, a string-aware scanner reads it as an unterminated
 * string, and every block comment in the rest of that file then survives and is reported as copy.
 * Telling a regex literal from a division needs real parser state, not a lookback heuristic, and
 * `typescript` is already a devDependency.
 *
 * Multi-line templates report the line the em dash is actually on, not the line the template opens
 * on, which is what lets the region exemptions and the offender report point at real lines.
 */
export function copyLinesWithEmDash(source: string): Set<number> {
  const file = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true);
  const found = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      const first = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
      node
        .getText(file)
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(EM_DASH) || ESCAPED_EM_DASH.test(line)) found.add(first + i + 1);
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Every TypeScript extension, not just `.ts`.
 *
 * A default-deny guard that only walks one extension is default-allow for the
 * rest, and the gap is invisible: adding `src/ui/thing.tsx` with an em-dashed
 * Notice leaves the suite green. `tsc` happens to catch a `.tsx` today only
 * because `jsx` is unset, and `.mts`/`.cts` are unreachable only under the
 * current module resolution -- so the build is standing in for the guard on a
 * config that a future UI change is entitled to flip. Own it here instead.
 */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))) found.push(path);
  }
  return found.sort();
}

/** Line numbers (1-based) covered by one region, empty when either marker does not resolve. */
function regionLines(
  region: (typeof EXEMPT_REGIONS)[number],
  lines: readonly string[],
): Set<number> {
  const covered = new Set<number>();
  const start = lines.findIndex((l) => l.includes(region.start));
  if (start < 0) return covered;
  const end = lines.findIndex((l, i) => i > start && l.trimEnd().endsWith(region.end));
  if (end < 0) return covered;
  for (let n = start + 1; n <= end + 1; n++) covered.add(n);
  return covered;
}

/** Line numbers (1-based) inside every exempt region of `file`. */
function exemptRegionLines(file: string, lines: readonly string[]): Set<number> {
  const exempt = new Set<number>();
  for (const region of EXEMPT_REGIONS.filter((r) => r.file === file)) {
    for (const n of regionLines(region, lines)) exempt.add(n);
  }
  return exempt;
}

function offenders(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const regionLines = exemptRegionLines(file, lines);
  const exactLines = EXEMPT_LINES.filter((e) => e.file === file).map((e) => e.line);
  return [...copyLinesWithEmDash(lines.join("\n"))]
    .sort((a, b) => a - b)
    .filter((n) => !regionLines.has(n))
    .filter((n) => !exactLines.includes(lines[n - 1].trim()))
    .map((n) => `  ${file}:${n}  ${lines[n - 1].trim()}`);
}

const COVERED = sourceFiles(SRC_ROOT).filter(
  (f) => !EXEMPT_FILES.some((e) => e.file === f),
);

describe("copyLinesWithEmDash separates copy from prose written for maintainers", () => {
  const at = (s: string) => [...copyLinesWithEmDash(s)].sort((a, b) => a - b);

  it("flags a string but not the trailing comment beside it", () => {
    expect(at('const a = "keep — this";\nconst b = 1; // drop — not copy')).toEqual([1]);
  });

  it("flags a URL-bearing string, which a naive // strip would truncate away", () => {
    expect(at('const u = "https://example.com/x — and copy after it";')).toEqual([1]);
  });

  it("is not derailed by a quote inside a regex character class", () => {
    // The bug the hand-rolled scanner shipped with: this quote read as an unterminated string, so
    // every block comment after it survived and was reported as copy.
    expect(at('const RE = /^created:\\s*["\']?(\\d{4})/m;\n/** doc — comment */\nconst b = 1;')).toEqual(
      [],
    );
  });

  it("tells a keyword-preceded regex from a division", () => {
    expect(at('return /^\\d{4}["\']$/.test(x);\n/** doc — comment */')).toEqual([]);
  });

  it("reports the line the em dash is on, not the line its template opens on", () => {
    // Region exemptions and the offender report both depend on this: SYSTEM_PROMPT is one template
    // spanning ~90 lines, and blaming its opening line for all of them would make both useless.
    expect(at("const t = `line one\nline two — here\nline three`;")).toEqual([2]);
  });

  it("flags an em dash inside a regex, which is behavior rather than prose", () => {
    expect(at("const strip = /[\\s—]+$/;")).toEqual([1]);
  });

  it("flags an escaped em dash, which renders identically to the reader", () => {
    expect(at('const a = "Nothing was filed\\u2014try again.";')).toEqual([1]);
    expect(at('const b = "Nothing was filed\\u{2014}try again.";')).toEqual([1]);
  });

  it("sees into a nested template literal", () => {
    // The hand-rolled scanner this replaced took the first backtick it met as the closing one, so
    // a `//` in the mis-split span read as a real comment and quietly deleted the copy after it.
    // No nested template exists in src/** today, which is exactly why it needs a test.
    expect(at("const a = `outer ${`inner // not a comment — here`} end`;")).toEqual([1]);
  });
});

describe("product copy follows the voice rules", () => {
  it("covers every source file that is not explicitly exempt", () => {
    // Guards the guard: if the walk ever silently stops finding files, every other case passes
    // vacuously and the rule quietly stops existing.
    expect(COVERED.length).toBeGreaterThan(50);
    expect(COVERED).toContain("src/plugin/main.ts");
  });

  it("catches an em dash in a file no exemption table has ever heard of", () => {
    // The property the deleted five-file allowlist could not have: a brand-new file is covered on
    // arrival. This is the mutation check made permanent. It ran once by hand against a green
    // baseline and caught all four cases; a check that only ever ran once is a check the next
    // regression walks past, so it lives here now.
    const dir = mkdtempSync(join(tmpdir(), "copy-voice-"));
    try {
      const file = join(dir, "brandNewSurface.ts");
      writeFileSync(file, 'export const S = "Filed 3 atoms — nothing else to do.";\n', "utf8");
      expect(sourceFiles(dir)).toEqual([file]);
      expect(offenders(file)).toHaveLength(1);

      writeFileSync(file, 'export const S = "Filed 3 atoms. Nothing else to do.";\n', "utf8");
      expect(offenders(file)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("walks every TypeScript extension, not only .ts", () => {
    // The walk used to filter on `.ts` alone, which made a default-deny guard default-ALLOW for
    // .tsx/.mts/.cts. Adversarial QA smuggled an em-dashed string past it in all three and the
    // suite stayed green. `tsc` catches a .tsx today only because `jsx` is unset -- the build was
    // standing in for the guard on a config a future UI change is entitled to flip. Mutation
    // check: revert SOURCE_EXTENSIONS to [".ts"] and this test fails on the first extension.
    for (const ext of [".tsx", ".mts", ".cts"]) {
      const dir = mkdtempSync(join(tmpdir(), "copy-voice-ext-"));
      try {
        const file = join(dir, `mutSurface${ext}`);
        writeFileSync(file, 'export const S = "Filed 3 atoms — nothing else to do.";\n', "utf8");
        expect(sourceFiles(dir), `${ext} must be walked`).toEqual([file]);
        expect(offenders(file), `${ext} must be scanned`).toHaveLength(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("uses no em dashes anywhere in src/**", () => {
    const found = COVERED.flatMap(offenders);
    expect(
      found.join("\n"),
      `docs/voice.md bans em dashes in product-authored copy. Use a period, a colon or a comma.\n` +
        `If a line genuinely cannot change, add it to EXEMPT_LINES with the reason:\n${found.join("\n")}`,
    ).toBe("");
  });
});

describe("every em-dash exemption is still earning its place", () => {
  for (const { file } of EXEMPT_FILES) {
    it(`${file} still holds the em dashes it is exempt for`, () => {
      expect(copyLinesWithEmDash(readFileSync(file, "utf8")).size).toBeGreaterThan(0);
    });
  }

  for (const region of EXEMPT_REGIONS) {
    it(`${region.file} region "${region.start}" still resolves and still holds em dashes`, () => {
      const source = readFileSync(region.file, "utf8");
      const lines = source.split("\n");
      const starts = lines.filter((l) => l.includes(region.start)).length;
      expect(starts, `region start marker must match exactly one line, matched ${starts}`).toBe(1);

      const exempt = regionLines(region, lines);
      expect(exempt.size, "region start matched but its end marker did not").toBeGreaterThan(0);
      expect(
        exempt.size,
        "region no longer covers the span it was written for. Its end marker resolves to the " +
          "first later line that ends with it, so a moved or deleted terminator runs the region " +
          "on to the next match and re-exempts whatever it swallows.",
      ).toBe(region.spanLines);

      const copy = copyLinesWithEmDash(source);
      expect([...exempt].some((n) => copy.has(n))).toBe(true);
    });
  }

  for (const canary of NEVER_EXEMPT) {
    it(`${canary.file} keeps "${canary.contains.slice(0, 40)}" outside every exempt region`, () => {
      const lines = readFileSync(canary.file, "utf8").split("\n");
      const n = lines.findIndex((l) => l.includes(canary.contains));
      expect(n, "canary line is gone; re-point or delete this entry").toBeGreaterThanOrEqual(0);
      expect(
        exemptRegionLines(canary.file, lines).has(n + 1),
        `${canary.file}:${n + 1} is user-facing copy and must never fall inside an exempt region`,
      ).toBe(false);
    });
  }

  for (const { file, line } of EXEMPT_LINES) {
    it(`${file} still contains the exempt line "${line.slice(0, 48)}"`, () => {
      const lines = readFileSync(file, "utf8").split("\n");
      expect(lines.map((l) => l.trim())).toContain(line);
      expect(line).toContain(EM_DASH);
    });
  }
});
