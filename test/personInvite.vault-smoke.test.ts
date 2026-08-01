/**
 * Demo-vault smoke for the person-invite fix (#224 / #227).
 *
 * Writes under docs/media/demo-vault only (agent dogfood lane). Drives the real
 * parse → quality-pass → render → read-back → invite chain over real files.
 *
 * **Plumbing, not product dogfood** (CLAUDE.md non-negotiable 9): the classify
 * step is fixture-fed because this container has no API key, so this proves the
 * pipeline, not the model's role judgement. The Obsidian UI is not exercised.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseCaptures, unprocessedCaptures } from "../src/pipeline/parse";
import { applyClassificationQuality } from "../src/pipeline/classify";
import { buildAtomMarkdown } from "../src/pipeline/render";
import { collectPersonInvites } from "../src/pipeline/personInvite";
import type { ClassificationResult } from "../src/shared/types";

const vault = join(process.cwd(), "docs/media/demo-vault");
const DAY = "2026-08-01";

/** What the model is expected to return for each capture. */
const FIXTURES: { capture: string; result: ClassificationResult }[] = [
  {
    // The reported bug: subject elided, Annie only owns the snack.
    capture: "likes annie's fruit tape snack",
    result: {
      verdict: "atom",
      title: "Likes Annie's fruit tape snack",
      tags: ["preferences"],
      proposed_tags: [],
      links: [],
      people: [{ name: "Annie", role: "mentioned" }],
    },
  },
  {
    // A verb 0.6.60's word list never contained.
    capture: "skipped the gym because jordan likes the late class",
    result: {
      verdict: "atom",
      title: "Skipped the gym because Jordan likes the late class",
      tags: ["preferences"],
      proposed_tags: [],
      links: [],
      people: [{ name: "Jordan", role: "subject" }],
    },
  },
  {
    // Adversarial: model names a subject the capture never wrote (R4).
    capture: "likes the long brown boots",
    result: {
      verdict: "atom",
      title: "Likes the long brown boots",
      tags: ["preferences"],
      proposed_tags: [],
      links: [],
      people: [{ name: "Riley", role: "subject" }],
    },
  },
];

describe("person invite demo-vault smoke", () => {
  it("files atoms and offers a card only for a real subject", () => {
    if (!existsSync(vault)) return; // seed with `npm run seed:demo`

    // 1. Real daily note with the captures appended as the user would.
    const dailyPath = join(vault, "Daily", `${DAY}.md`);
    const existing = existsSync(dailyPath) ? readFileSync(dailyPath, "utf8") : `# ${DAY}\n`;
    const daily =
      existing.trimEnd() +
      "\n" +
      FIXTURES.map((f) => `- ${f.capture}`).join("\n") +
      "\n";
    writeFileSync(dailyPath, daily);

    // 2. Real parse — the captures must be seen as unprocessed.
    const captures = unprocessedCaptures(parseCaptures(daily));
    const texts = captures.map((c) => c.text);
    for (const f of FIXTURES) expect(texts).toContain(f.capture);

    // 3. Real quality pass (people guard) + real render, to real files.
    mkdirSync(join(vault, "Atoms"), { recursive: true });
    const written: { path: string; title: string; content: string }[] = [];
    for (const f of FIXTURES) {
      const result = applyClassificationQuality(f.capture, f.result, {
        titles: ["Jordan", "Riley", "People"],
      });
      const content = buildAtomMarkdown({
        result,
        captureText: f.capture,
        created: `${DAY}T09:00:00`,
        sourceDailyPath: `Daily/${DAY}.md`,
      });
      const path = join(vault, "Atoms", `${result.title}.md`);
      writeFileSync(path, content);
      written.push({ path, title: result.title, content });
    }

    // 4. Read back from disk — nothing in-memory carries over.
    const atoms = written.map((w) => ({
      path: `Atoms/${w.title}.md`,
      title: w.title,
      sourceDate: DAY,
      content: readFileSync(w.path, "utf8"),
    }));

    const invites = collectPersonInvites(atoms, {
      personHubTitles: ["Jordan", "Riley"],
      vaultTitles: ["Jordan", "Riley", "People"],
      now: new Date(`${DAY}T12:00:00`),
    });

    // 5. What the user would see on Atoms home.
    // eslint-disable-next-line no-console
    console.log(
      "\n--- rendered atom (reported capture) ---\n" +
        atoms[0]!.content +
        "\n--- adversarial atom (invented subject) ---\n" +
        atoms[2]!.content +
        "\n--- invite cards offered: " +
        (invites.map((i) => i.displayName).join(", ") || "(none)") +
        "\n",
    );

    // The bug: no card naming a verb, and none naming the snack's owner.
    expect(invites.map((i) => i.displayName)).not.toContain("Likes");
    expect(invites.map((i) => i.displayName)).not.toContain("Annie");
    expect(invites.map((i) => i.displayName)).not.toContain("Skipped");

    // R4: the invented subject never reached frontmatter, so no Riley card.
    expect(atoms[2]!.content).toContain("atoms-people: []");
    expect(invites.map((i) => i.displayName)).not.toContain("Riley");

    // Jordan is a hub already, so the card is suppressed — but the atom
    // records them as the subject, which is what drives the link.
    expect(atoms[1]!.content).toMatch(/name: "Jordan"\n\s+role: subject/);
  });
});
