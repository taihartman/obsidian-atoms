import { describe, expect, it } from "vitest";
import {
  applyClassificationQuality,
  CLASSIFICATION_SCHEMA,
  normalizePeople,
} from "../src/pipeline/classify";
import {
  atomsPeopleLines,
  parseAtomsPeople,
} from "../src/pipeline/atomQuality";
import {
  personInviteNameFromPeople,
  resolveAtomPersonName,
} from "../src/pipeline/personInvite";
import { buildAtomMarkdown } from "../src/pipeline/render";
import type { ClassificationResult } from "../src/shared/types";

const result = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  verdict: "atom",
  title: "Likes Annie's fruit tape snack",
  tags: [],
  proposed_tags: [],
  links: [],
  ...over,
});

// U1 — schema + invariants
describe("classification schema people field", () => {
  it("requires people with a role enum", () => {
    const p = CLASSIFICATION_SCHEMA.properties.people;
    expect(CLASSIFICATION_SCHEMA.required).toContain("people");
    expect(p.items.required).toEqual(["name", "role"]);
    expect(p.items.properties.role.enum).toEqual([
      "subject",
      "mentioned",
      "recommender",
    ]);
    expect(p.items.additionalProperties).toBe(false);
  });

  // R9 / AE6 — plus-service holds a hand-synced snapshot; drift is silent.
  //
  // This *imports* the snapshot rather than reading it as text. A text-only
  // assertion passed while the file was unparseable JavaScript: an unescaped
  // backtick in the prompt closed its template literal early, so plus-service
  // could not load its own classify template. Read the file, miss the bug.
  it("stays in sync with the plus-service snapshot, and parses", async () => {
    const snapshot = (await import(
      "../plus-service/src/classifyTemplate.mjs"
    )) as {
      SYSTEM_PROMPT: string;
      CLASSIFICATION_SCHEMA: typeof CLASSIFICATION_SCHEMA;
    };
    expect(snapshot.CLASSIFICATION_SCHEMA.required).toEqual(
      CLASSIFICATION_SCHEMA.required,
    );
    expect(
      snapshot.CLASSIFICATION_SCHEMA.properties.people.items.properties.role.enum,
    ).toEqual(
      CLASSIFICATION_SCHEMA.properties.people.items.properties.role.enum,
    );
    expect(snapshot.SYSTEM_PROMPT).toContain("people[] — who is named, and how");
    // The guidance keeps its inline code ticks — proof they survived escaping.
    expect(snapshot.SYSTEM_PROMPT).toContain("`subject`");
  });
});

describe("normalizePeople", () => {
  const capture = "likes annie's fruit tape snack";

  it("keeps a name written in the capture", () => {
    const r = normalizePeople(capture, result({
      people: [{ name: "Annie", role: "mentioned" }],
    }));
    expect(r.people).toEqual([{ name: "Annie", role: "mentioned" }]);
  });

  // AE3 — a subject the capture never wrote is invented.
  it("drops a hallucinated subject", () => {
    const r = normalizePeople(capture, result({
      people: [
        { name: "Nichita", role: "subject" },
        { name: "Annie", role: "mentioned" },
      ],
    }));
    expect(r.people).toEqual([{ name: "Annie", role: "mentioned" }]);
  });

  it("drops a denied name even when the model insists", () => {
    const r = normalizePeople("likes the boots", result({
      people: [{ name: "Likes", role: "subject" }],
    }));
    expect(r.people).toEqual([]);
  });

  it("drops unknown roles and duplicates", () => {
    const r = normalizePeople("annie and annie", result({
      people: [
        { name: "Annie", role: "bystander" as never },
        { name: "Annie", role: "mentioned" },
        { name: "Annie", role: "subject" },
      ],
    }));
    expect(r.people).toEqual([{ name: "Annie", role: "mentioned" }]);
  });

  // KTD6 — absent must not become [].
  it("leaves an absent field absent", () => {
    expect(normalizePeople(capture, result()).people).toBeUndefined();
  });

  // Batch (backfill) and smart refresh parse model JSON on their own paths and
  // reach frontmatter through applyClassificationQuality, not the live parser.
  it("guards the shared quality pass used by backfill and refresh", () => {
    const r = applyClassificationQuality(
      capture,
      result({
        people: [
          { name: "Nichita", role: "subject" },
          { name: "Annie", role: "mentioned" },
        ],
      }),
    );
    expect(r.people).toEqual([{ name: "Annie", role: "mentioned" }]);
  });
});

// U2 — persistence
describe("atoms-people frontmatter", () => {
  const round = (people: Parameters<typeof atomsPeopleLines>[0]) =>
    parseAtomsPeople(`---\n${atomsPeopleLines(people).join("\n")}\n---\n\nbody\n`);

  it("round-trips names with apostrophes, spaces and diacritics", () => {
    const people = [
      { name: "O'Brien", role: "subject" as const },
      { name: "Ana Sofía", role: "mentioned" as const },
    ];
    expect(round(people)).toEqual(people);
  });

  it("distinguishes absent from empty (KTD6)", () => {
    expect(parseAtomsPeople("---\ncreated: 2026-08-01\n---\n\nbody\n")).toBeNull();
    expect(round([])).toEqual([]);
  });

  it("is written by buildAtomMarkdown only when the model sent it", () => {
    const base = {
      captureText: "likes annie's fruit tape snack",
      created: "2026-08-01",
      sourceDailyPath: "Daily/2026-08-01.md",
    };
    const withField = buildAtomMarkdown({
      ...base,
      result: result({ people: [{ name: "Annie", role: "mentioned" }] }),
    });
    expect(parseAtomsPeople(withField)).toEqual([
      { name: "Annie", role: "mentioned" },
    ]);
    expect(parseAtomsPeople(buildAtomMarkdown({ ...base, result: result() }))).toBeNull();
  });
});

// U3 — invite consumes the field
describe("personInviteNameFromPeople", () => {
  it("invites the sole subject", () => {
    expect(
      personInviteNameFromPeople([
        { name: "Nichita", role: "subject" },
        { name: "Annie", role: "mentioned" },
      ]),
    ).toBe("Nichita");
  });

  it.each([
    [[{ name: "Annie", role: "mentioned" as const }], "a possessive owner"],
    [[{ name: "Christian", role: "recommender" as const }], "a recommender"],
    [[], "nobody"],
    [
      [
        { name: "Mom", role: "subject" as const },
        { name: "Dad", role: "subject" as const },
      ],
      "two subjects",
    ],
  ])("invites nobody for %#: %s", (people) => {
    expect(personInviteNameFromPeople(people)).toBeNull();
  });
});

describe("resolveAtomPersonName", () => {
  const atom = (fm: string, body: string) =>
    `---\ngenerated-by: linker\n${fm}---\n${body}\n`;

  // AE1 — the reported capture.
  it("names nobody for the subject-less capture", () => {
    const content = atom(
      "atoms-people:\n  - name: \"Annie\"\n    role: mentioned\n",
      "likes annie's fruit tape snack",
    );
    expect(
      resolveAtomPersonName(
        content,
        "likes annie's fruit tape snack",
        "Likes Annie's fruit tape snack",
      ),
    ).toBeNull();
  });

  // AE5 — the verb 0.6.60's word list never listed.
  it("names the subject, never the leading verb", () => {
    const content = atom(
      "atoms-people:\n  - name: \"Nichita\"\n    role: subject\n",
      "skipped the gym because nichita likes it",
    );
    expect(
      resolveAtomPersonName(
        content,
        "skipped the gym because nichita likes it",
        "Skipped the gym because Nichita likes it",
      ),
    ).toBe("Nichita");
  });

  // F4 / R7 — atoms written before the field keep 0.6.60 behaviour.
  it("falls back to the legacy heuristic when the field is absent", () => {
    const legacy = atom("", "Mom wants to celebrate for her bday");
    expect(
      resolveAtomPersonName(
        legacy,
        "Mom wants to celebrate for her bday",
        "Plan for moms birthday",
      ),
    ).toBe("Mom");
  });

  // AE4 — two verb-led atoms must not group as one person.
  it("does not group two verb-led atoms under a shared label", () => {
    const a = atom("atoms-people: []\n", "likes annie's fruit tape snack");
    const b = atom("atoms-people: []\n", "likes the long brown boots");
    const nameA = resolveAtomPersonName(a, "likes annie's snack", "Likes Annie's snack");
    const nameB = resolveAtomPersonName(b, "likes the boots", "Likes the long brown boots");
    expect(nameA).toBeNull();
    expect(nameB).toBeNull();
  });
});
