import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
 * Comments are stripped first. The rule is about copy a user reads, and prose written for the next
 * maintainer is not that.
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
  reason: string;
}> = [
  {
    file: "src/pipeline/classify.ts",
    start: "export const CLASSIFICATION_PARITY_PHRASES = [",
    end: "] as const;",
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
    reason:
      "JSON-schema `description` fields, sent to the model as part of the tool definition. Same " +
      "rationale as SYSTEM_PROMPT: model-facing instruction, never rendered to a user.",
  },
  {
    file: "src/pipeline/classify.ts",
    start: "export const SYSTEM_PROMPT = `",
    end: "`;",
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
    end: "}",
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
      "cell. It is not a sentence, and it renders on both the home and settings surfaces, so " +
      "changing it moves two screens for no voice gain.",
  },
  {
    file: "src/platform/askMirror.ts",
    line: "/[\\s.,;:!?—-]+$/,",
    reason:
      "A character class in truncateMessage's trailing-punctuation strip. The em dash here is " +
      "behavior: removing it would leave a dangling dash on every cut message.",
  },
];

/** Tokens after which a `/` opens a regex literal rather than dividing. */
const BEFORE_REGEX = "(,=:[!&|?{};+-*%^~<>";
const REGEX_KEYWORDS = /\b(return|case|typeof|instanceof|in|of|do|else|yield|await)$/;

/**
 * Strips block comments, full-line `//` and **trailing** `//` while leaving string, template and
 * **regex** literals intact, so `https://…` inside copy survives and a trailing `// note —` is not
 * mistaken for copy. Line count is preserved so offender line numbers stay true to the file.
 *
 * Regex literals have to be understood, not merely skipped past: `/^created:\s*["']?…/` in
 * `src/resurface/resurface.ts` carries a quote inside a character class, and a scanner that reads
 * it as the start of a string never finds the close. Every block comment in the rest of that file
 * then survives the strip and gets reported as copy. The first cut of this guard did exactly that.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let significant = "";

  const opensRegex = (): boolean =>
    significant === "" ||
    BEFORE_REGEX.includes(significant.at(-1) as string) ||
    REGEX_KEYWORDS.test(significant);

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && opensRegex()) {
      out += c;
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== "\n") {
        const r = source[i];
        if (r === "\\") {
          out += r + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += r;
        i++;
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
      }
      significant = "/";
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < source.length) {
        const s = source[i];
        if (s === "\\") {
          out += s + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += s;
        i++;
        if (s === c) break;
      }
      significant = c;
      continue;
    }

    out += c;
    if (!/\s/.test(c)) significant += c;
    else if (c === "\n") significant = "";
    i++;
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (name.endsWith(".ts")) found.push(path);
  }
  return found.sort();
}

/** Line numbers (1-based) inside every exempt region of `file`. */
function exemptRegionLines(file: string, lines: readonly string[]): Set<number> {
  const exempt = new Set<number>();
  for (const region of EXEMPT_REGIONS.filter((r) => r.file === file)) {
    const start = lines.findIndex((l) => l.includes(region.start));
    if (start < 0) continue;
    const end = lines.findIndex((l, i) => i > start && l.trimEnd().endsWith(region.end));
    if (end < 0) continue;
    for (let n = start + 1; n <= end + 1; n++) exempt.add(n);
  }
  return exempt;
}

function offenders(file: string): string[] {
  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  const regionLines = exemptRegionLines(file, lines);
  const exactLines = EXEMPT_LINES.filter((e) => e.file === file).map((e) => e.line);
  return lines
    .map((line, i) => [i + 1, line] as const)
    .filter(([n, line]) => line.includes(EM_DASH) && !regionLines.has(n))
    .filter(([, line]) => !exactLines.includes(line.trim()))
    .map(([n, line]) => `  ${file}:${n}  ${line.trim()}`);
}

const COVERED = sourceFiles(SRC_ROOT).filter(
  (f) => !EXEMPT_FILES.some((e) => e.file === f),
);

describe("stripComments keeps copy and drops prose written for maintainers", () => {
  const lines = (s: string) => stripComments(s).split("\n");

  it("drops a trailing // comment but keeps the code beside it", () => {
    expect(lines('const a = "keep"; // drop — this em dash is not copy')[0]).toBe(
      'const a = "keep"; ',
    );
  });

  it("keeps a URL inside a string, which a naive // strip would truncate", () => {
    expect(lines('const u = "https://example.com/x — and copy after it";')[0]).toContain(
      "— and copy after it",
    );
  });

  it("keeps regex literals intact, including quotes in a character class", () => {
    // The bug this guard shipped with: a quote inside a regex read as an unterminated string, so
    // every block comment after it survived and was reported as copy.
    const src = 'const RE = /^created:\\s*["\']?(\\d{4})/m;\n/** doc — comment */\nconst b = 1;';
    expect(lines(src)[1]).toBe("");
    expect(lines(src)[0]).toContain('["\']?');
  });

  it("treats a keyword-preceded slash as a regex, not a division", () => {
    const src = 'return /^\\d{4}["\']$/.test(x);\n/** doc — comment */';
    expect(lines(src)[1]).toBe("");
  });

  it("preserves line numbers across a multi-line block comment", () => {
    expect(lines("/*\n\n*/\nconst a = 1;")).toHaveLength(4);
  });
});

describe("product copy follows the voice rules", () => {
  it("covers every source file that is not explicitly exempt", () => {
    // Guards the guard: if the walk ever silently stops finding files, every other case passes
    // vacuously and the rule quietly stops existing.
    expect(COVERED.length).toBeGreaterThan(50);
    expect(COVERED).toContain("src/plugin/main.ts");
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
      expect(stripComments(readFileSync(file, "utf8"))).toContain(EM_DASH);
    });
  }

  for (const region of EXEMPT_REGIONS) {
    it(`${region.file} region "${region.start}" still resolves and still holds em dashes`, () => {
      const lines = stripComments(readFileSync(region.file, "utf8")).split("\n");
      const starts = lines.filter((l) => l.includes(region.start)).length;
      expect(starts, `region start marker must match exactly one line, matched ${starts}`).toBe(1);

      const exempt = exemptRegionLines(region.file, lines);
      expect(exempt.size, "region start matched but its end marker did not").toBeGreaterThan(0);
      expect([...exempt].some((n) => lines[n - 1].includes(EM_DASH))).toBe(true);
    });
  }

  for (const { file, line } of EXEMPT_LINES) {
    it(`${file} still contains the exempt line "${line.slice(0, 48)}"`, () => {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      expect(lines.map((l) => l.trim())).toContain(line);
      expect(line).toContain(EM_DASH);
    });
  }
});
