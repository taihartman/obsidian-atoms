import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import {
  NON_ATOM_BODY_CHARS,
  buildCandidateCorpus,
  type CandidateNote,
} from "../src/pipeline/candidates";
import { rankShortlist } from "../src/pipeline/shortlist";

interface FakeFile {
  path: string;
  content?: string;
  /** Sync placeholder / deleted between listing and reading. */
  unreadable?: boolean;
  cache?: {
    tags?: Array<{ tag: string }>;
    frontmatter?: Record<string, unknown> | null;
  } | null;
}

/**
 * Vault double that counts reads. The read count is the KTD4 evidence, so it is measured
 * rather than assumed: `cachedRead` bumps a counter no production code can reset.
 */
function fakeApp(files: FakeFile[]): { app: App; reads: () => number } {
  let reads = 0;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const app = {
    vault: {
      getMarkdownFiles: () =>
        files.map((f) => ({ path: f.path, basename: f.path.split("/").pop()!.replace(/\.md$/, "") })),
      cachedRead: async (file: { path: string }) => {
        reads += 1;
        const f = byPath.get(file.path);
        if (!f || f.unreadable) throw new Error("ENOENT: not readable");
        return f.content ?? "";
      },
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => byPath.get(file.path)?.cache ?? null,
    },
  };
  return { app: app as unknown as App, reads: () => reads };
}

const atom = (title: string, capture: string, prose = ""): FakeFile => ({
  path: `Atoms/${title}.md`,
  content: `---
created: 2026-07-01T10:00:00
source: "[[2026-07-01]]"
generated-by: linker
tags:
  - idea
---
${capture}${prose ? `\n\n${prose}` : ""}
`,
  cache: { frontmatter: { tags: ["idea"] } },
});

const byTitle = (notes: CandidateNote[], title: string) =>
  notes.find((n) => n.title === title);

describe("buildCandidateCorpus", () => {
  it("reads every markdown file exactly once", async () => {
    const { app, reads } = fakeApp([
      atom("Sleep debt plateaus", "sleep debt seems to plateau"),
      { path: "People/Ning.md", content: "Ning runs the CRG reading group." },
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });

    expect(reads()).toBe(2);
    expect(corpus.reads).toBe(2);
    expect(corpus.notes).toHaveLength(2);
  });

  it("is built once for a multi-capture run — reads are note count, not note × capture", async () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      atom(`Atom ${i}`, `capture number ${i} about sleep and coffee`),
    );
    const { app, reads } = fakeApp(files);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    const captures = [
      "sleep debt again",
      "coffee after four",
      "reading group notes",
      "sleep and coffee both",
      "something else entirely",
    ];
    // Scoring a whole run's worth of captures against the seeded corpus must not touch the vault.
    for (const c of captures) rankShortlist(c, corpus.notes, 5);

    expect(reads()).toBe(files.length);
    expect(reads()).not.toBe(files.length * captures.length);
  });

  it("skips a note that cannot be read, counts it, and keeps going", async () => {
    const { app, reads } = fakeApp([
      atom("Readable", "coffee after four wrecks my sleep"),
      { path: "Atoms/Sync placeholder.md", unreadable: true },
      atom("Also readable", "reading group met on Tuesday"),
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });

    expect(corpus.unreadable).toBe(1);
    expect(reads()).toBe(3);
    expect(corpus.notes.map((n) => n.title).sort()).toEqual([
      "Also readable",
      "Readable",
    ]);
  });

  it("does not throw when a file disappears between listing and reading", async () => {
    const { app } = fakeApp([{ path: "Atoms/Deleted.md", unreadable: true }]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });

    expect(corpus.notes).toEqual([]);
    expect(corpus.unreadable).toBe(1);
  });

  it("yields a title-only candidate for an empty note", async () => {
    const { app } = fakeApp([{ path: "Notes/Trailhead parking.md", content: "" }]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    const note = byTitle(corpus.notes, "Trailhead parking")!;

    expect(note.body).toBe("");
    expect(note.tags).toEqual([]);
    expect(rankShortlist("where do we park at the trailhead", corpus.notes, 5)).toHaveLength(1);
  });

  it("takes tags from frontmatter and from inline hashtags", async () => {
    const { app } = fakeApp([
      {
        path: "Notes/Mixed.md",
        content: `---
tags:
  - idea
---
body with an inline #preference tag
`,
        cache: {
          frontmatter: { tags: ["idea"] },
          tags: [{ tag: "#preference" }],
        },
      },
      {
        path: "Notes/Inline string.md",
        content: "plain",
        cache: { frontmatter: { tags: "person, media" } },
      },
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });

    expect(byTitle(corpus.notes, "Mixed")!.tags).toEqual(["idea", "preference"]);
    expect(byTitle(corpus.notes, "Inline string")!.tags).toEqual(["media", "person"]);
  });

  it("indexes the atom's capture as body and its reason-bearing link prose as links", async () => {
    const { app } = fakeApp([
      atom(
        "Sleep debt plateaus",
        "sleep debt seems to plateau after a week",
        "Revises [[Sleep hygiene]] because the plateau contradicts the cumulative model.",
      ),
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    const note = byTitle(corpus.notes, "Sleep debt plateaus")!;

    expect(note.isAtom).toBe(true);
    expect(note.body).toBe("sleep debt seems to plateau after a week");
    expect(note.links.join(" ")).toContain("cumulative model");
    // The prose is not smuggled into the body — body must stay the verbatim capture.
    expect(note.body).not.toContain("cumulative");
  });

  it("lets link prose alone carry a match the capture never mentions", async () => {
    const { app } = fakeApp([
      atom(
        "Sleep debt plateaus",
        "it levels off after a week",
        "Revises [[Sleep hygiene]] because the plateau contradicts the cumulative model.",
      ),
      atom("Unrelated", "the trailhead parking fills by seven"),
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    const top = rankShortlist("cumulative model of sleep", corpus.notes, 5);

    expect(top[0]?.title).toBe("Sleep debt plateaus");
  });

  it("makes frontmatter aliases scoreable so person hubs stay linkable", async () => {
    const { app } = fakeApp([
      {
        path: "People/Ning.md",
        content: "runs the CRG reading group",
        cache: { frontmatter: { aliases: ["Ning Wang"] } },
      },
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });

    expect(corpus.notes.map((n) => n.title).sort()).toEqual(["Ning", "Ning Wang"]);
    expect(corpus.reads).toBe(1); // one file, one read, two link targets
  });

  it("caps non-atom bodies but never truncates an atom's capture", async () => {
    const long = "alpha ".repeat(1000); // 6,000 chars
    const { app } = fakeApp([
      { path: "Notes/Long meeting.md", content: long },
      atom("Long capture", long),
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });

    expect(byTitle(corpus.notes, "Long meeting")!.body).toHaveLength(NON_ATOM_BODY_CHARS);
    expect(byTitle(corpus.notes, "Long capture")!.body.length).toBeGreaterThan(
      NON_ATOM_BODY_CHARS,
    );
  });

  it("scopes the atom folder by prefix, so a sibling folder is not treated as atoms", async () => {
    const { app } = fakeApp([
      { path: "AtomsArchive/Not an atom.md", content: "capture text\n\nprose tail" },
    ]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    const note = byTitle(corpus.notes, "Not an atom")!;

    expect(note.isAtom).toBe(false);
    expect(note.body).toContain("prose tail");
  });

  it("records the source daily on linker-generated atoms", async () => {
    const { app } = fakeApp([atom("Sleep debt plateaus", "sleep debt seems to plateau")]);
    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    expect(byTitle(corpus.notes, "Sleep debt plateaus")?.sourceDaily).toBe(
      "2026-07-01",
    );
  });

  it("accepts a mid-run atom without re-reading the vault (KTD4a)", async () => {
    const { app, reads } = fakeApp([atom("Seeded", "sleep debt seems to plateau")]);

    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    corpus.add({
      path: "Atoms/Fresh atom.md",
      title: "Fresh atom",
      body: "coffee after four wrecks my sleep",
      tags: ["preference"],
      links: ["Revises [[Seeded]] because the plateau reappears."],
      isAtom: true,
    });

    expect(reads()).toBe(1);
    expect(rankShortlist("coffee wrecks sleep", corpus.notes, 5)[0]?.title).toBe(
      "Fresh atom",
    );
  });

  it("upsert replaces same-path seed and drops a renamed path", async () => {
    const { app } = fakeApp([atom("Old title", "original capture about sleep")]);
    const corpus = await buildCandidateCorpus(app, { atomFolder: "Atoms" });
    expect(corpus.paths.has("Atoms/Old title.md")).toBe(true);

    corpus.upsert(
      {
        path: "Atoms/New title.md",
        title: "New title",
        body: "original capture about sleep",
        tags: ["sleep"],
        links: ["Related to [[Other]] because of the plateau."],
        isAtom: true,
      },
      ["Atoms/Old title.md"],
    );

    expect(corpus.paths.has("Atoms/Old title.md")).toBe(false);
    expect(corpus.paths.has("Atoms/New title.md")).toBe(true);
    expect(corpus.notes.filter((n) => n.path === "Atoms/Old title.md")).toHaveLength(0);
    expect(rankShortlist("plateau related", corpus.notes, 3)[0]?.title).toBe("New title");
  });
});
