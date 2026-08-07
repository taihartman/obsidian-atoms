import { describe, expect, it } from "vitest";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import {
  escapeHtml,
  escapeAttr,
  loadPublishedNotes,
  normalizeFigureSrc,
  parsePublishedBasename,
  promoteDraftToPublished,
  renderNoteBodyHtml,
  isSafeSlug,
  pickPublicFields,
} from "../www/lib/fieldNotesContent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures/field-notes/published");

describe("fieldNotesContent", () => {
  it("parses safe basenames and rejects path-like slugs", () => {
    expect(parsePublishedBasename("2026-08-01-sample-loop.json")).toEqual({
      date: "2026-08-01",
      slug: "sample-loop",
      filename: "2026-08-01-sample-loop.json",
    });
    expect(parsePublishedBasename("2026-08-01-../evil.json")).toBeNull();
    expect(isSafeSlug("sample-loop")).toBe(true);
    expect(isSafeSlug("../x")).toBe(false);
  });

  it("loads fixtures newest-first", () => {
    const notes = loadPublishedNotes(fixtureDir);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].slug).toBe("sample-loop");
    expect(notes[0].title).toContain("dump");
  });

  it("escapes HTML in body text and attributes", () => {
    const html = renderNoteBodyHtml({
      paragraphs: ['Hello <script>alert(1)</script> & "x"'],
      figure: {
        src: "/email/ok.png",
        alt: 'a "quoted" <b>alt',
      },
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('alt="a &quot;quoted&quot; &lt;b&gt;alt"');
  });

  it("omits unknown diagram and external figure hosts", () => {
    expect(normalizeFigureSrc("https://evil.example/x.png")).toBeNull();
    expect(normalizeFigureSrc("javascript:alert(1)")).toBeNull();
    expect(normalizeFigureSrc("https://tryatoms.app/email/x.png")).toBe(
      "/email/x.png",
    );
    const html = renderNoteBodyHtml({
      paragraphs: ["p"],
      diagram: "<img onerror=1>",
      figure: { src: "https://cdn.resend.com/x.png", alt: "x" },
    });
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("resend");
    expect(html).toContain("notes-p");
  });

  it("includes loop diagram and cta when present", () => {
    const html = renderNoteBodyHtml({
      paragraphs: ["One"],
      diagram: "loop",
      cta: { label: "Open", href: "https://tryatoms.app" },
    });
    expect(html).toContain("notes-loop");
    expect(html).toContain("Three-step capture loop");
    expect(html).toContain("Open");
    expect(html).not.toContain("unsubscribe");
  });

  it("renders blocks with h2, tldr, and inline figure", () => {
    const html = renderNoteBodyHtml({
      blocks: [
        { type: "p", text: "Open" },
        { type: "h2", text: "Two seconds" },
        {
          type: "figure",
          src: "https://tryatoms.app/email/fn-ask-dom.png",
          alt: "Ask Dom",
        },
        { type: "tldr", lines: ["Got Dom back."] },
      ],
    });
    expect(html).toContain('class="notes-h2"');
    expect(html).toContain("Two seconds");
    expect(html).toContain("Got Dom back.");
    expect(html).toContain("fn-ask-dom.png");
    expect(html).not.toContain("notes-pull");
    expect(html).not.toContain("notes-loop");
  });

  // The archive mirrors the email: short version first, no jump link anywhere.
  it("leads with the short version and ships no jump link", () => {
    const html = renderNoteBodyHtml({
      blocks: [
        { type: "p", text: "Open" },
        { type: "tldr", lines: ["Got Dom back."] },
        { type: "skip", label: "Short version ↓", target: "fn-tldr" },
      ],
    });
    expect(html.indexOf("Got Dom back.")).toBeLessThan(html.indexOf("Open"));
    expect(html).not.toContain("notes-skip");
    expect(html).not.toContain('href="#');
    expect(html).not.toContain('id="fn-tldr"');
    expect(html).not.toContain("Short version ↓");
  });

  it("promoteDraftToPublished allowlists fields and requires basename", () => {
    const { filename, note } = promoteDraftToPublished(
      {
        subject: "S",
        title: "T",
        paragraphs: ["P"],
        unsubUrl: "secret",
        postalAddress: "nope",
      },
      "2026-08-06-hello-world.json",
    );
    expect(filename).toBe("2026-08-06-hello-world.json");
    expect(note.slug).toBe("hello-world");
    expect(note.date).toBe("2026-08-06");
    expect(note.unsubUrl).toBeUndefined();
    expect(pickPublicFields({ title: "a", unsubUrl: "x" }).unsubUrl).toBeUndefined();
    expect(() =>
      promoteDraftToPublished(
        { subject: "S", title: "T", paragraphs: ["P"] },
        "bad.json",
      ),
    ).toThrow(/basename/);
  });

  it("sorts two notes by filename date", () => {
    const tmp = join(here, "fixtures/field-notes/tmp-sort");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, "2026-07-01-old.json"),
      JSON.stringify({ title: "Old", paragraphs: ["a"], subject: "o" }),
    );
    writeFileSync(
      join(tmp, "2026-08-02-new.json"),
      JSON.stringify({ title: "New", paragraphs: ["b"], subject: "n" }),
    );
    const notes = loadPublishedNotes(tmp);
    expect(notes.map((n) => n.slug)).toEqual(["new", "old"]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("escapeAttr covers quotes", () => {
    expect(escapeAttr(`a"b'c`)).toContain("&quot;");
    expect(escapeHtml("<x>")).toBe("&lt;x&gt;");
  });
});
