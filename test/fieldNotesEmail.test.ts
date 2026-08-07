import { describe, it, expect } from "vitest";
import {
  EMAIL_THEME,
  blocksToTextLines,
  buildFieldNotesHtml,
  hoistTldrFirst,
  loopDiagramHtml,
  normalizeBlocks,
  renderBlocksEmailHtml,
  welcomeEmailContent,
} from "../www/functions/_lib/fieldNotesEmail.mjs";

describe("fieldNotesEmail", () => {
  it("uses tryatoms dark theme tokens", () => {
    expect(EMAIL_THEME.bg).toBe("#000000");
    expect(EMAIL_THEME.surface).toBe("#1c1c1e");
    expect(EMAIL_THEME.tint).toBe("#0a84ff");
  });

  it("loop diagram is table-based (no img required)", () => {
    const d = loopDiagramHtml();
    expect(d).toContain("<table");
    expect(d).toContain("Catch it");
    expect(d).toContain("It comes back");
    expect(d).not.toContain("<img");
  });

  it("welcome is multipart-ready with unsub and postal", () => {
    const w = welcomeEmailContent({
      unsubUrl: "https://tryatoms.app/api/unsubscribe?e=a&t=b",
      postalAddress: "Taitopia, 1029 Lyell Ave Unit #740, Rochester, NY 14606",
    });
    expect(w.subject).toMatch(/Field notes/i);
    expect(w.html).toContain("color-scheme");
    expect(w.html).toContain(EMAIL_THEME.surface);
    expect(w.html).toContain("Unsubscribe");
    expect(w.html).toContain("Taitopia");
    expect(w.text).toContain("Unsubscribe:");
    expect(w.text).toContain("tryatoms.app");
  });

  it("figureHtml hosts absolute img", () => {
    const html = buildFieldNotesHtml({
      title: "Test",
      paragraphs: ["Hello"],
      unsubUrl: "https://example.com/u",
      postalAddress: "Addr",
      figure: {
        src: "https://tryatoms.app/email/loop-remember.png",
        alt: "Loop",
      },
    });
    expect(html).toContain('src="https://tryatoms.app/email/loop-remember.png"');
    expect(html).toContain('alt="Loop"');
  });

  it("blocks render sections and inline figures", () => {
    const html = buildFieldNotesHtml({
      title: "Test",
      blocks: [
        { type: "p", text: "Open" },
        { type: "h2", text: "Across the gym" },
        {
          type: "figure",
          src: "https://tryatoms.app/email/fn-face-no-name.png",
          alt: "Face",
        },
        { type: "tldr", lines: ["Short beat.", "Second line."] },
      ],
      unsubUrl: "https://example.com/u",
      postalAddress: "Addr",
    });
    expect(html).toContain("Across the gym");
    expect(html).toContain("Short beat.");
    expect(html).toContain("fn-face-no-name.png");
    expect(html).toContain("<h2");
    expect(html).not.toContain("border-left:3px solid");
    expect(html).not.toContain("Catch it");
  });

  // Gmail strips in-message fragment links, so a "Short version ↓" jump is a
  // dead link. The short version leads instead. Regression guard for both.
  it("never emits an in-message jump link", () => {
    const html = buildFieldNotesHtml({
      title: "Test",
      blocks: [
        { type: "p", text: "Open" },
        { type: "tldr", lines: ["Short beat."] },
        // legacy drafts may still carry a skip block; it must render nothing
        { type: "skip", label: "Short version ↓", target: "fn-tldr" },
      ],
      unsubUrl: "https://example.com/u",
      postalAddress: "Addr",
    });
    expect(html).not.toContain('href="#');
    expect(html).not.toContain("Short version ↓");
    expect(html).not.toContain('id="fn-tldr"');
  });

  it("hoists the short version above the story, whatever order the draft used", () => {
    const blocks = [
      { type: "p", text: "First line of the story." },
      { type: "h2", text: "Middle" },
      { type: "tldr", lines: ["Short beat."] },
      { type: "p", text: "Closer." },
    ];
    expect(hoistTldrFirst(blocks).map((b) => b.type)).toEqual([
      "tldr",
      "p",
      "h2",
      "p",
    ]);

    // body only: buildFieldNotesHtml also echoes the first paragraph into the
    // hidden preheader, which sits above everything.
    const body = renderBlocksEmailHtml(blocks);
    expect(body.indexOf("Short beat.")).toBeLessThan(
      body.indexOf("First line of the story."),
    );
  });

  it("keeps the preheader on the first paragraph, not the short version", () => {
    const html = buildFieldNotesHtml({
      title: "Test",
      blocks: [
        { type: "p", text: "First line of the story." },
        { type: "tldr", lines: ["Short beat."] },
      ],
      unsubUrl: "https://example.com/u",
      postalAddress: "Addr",
    });
    expect(html).toContain(
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">First line of the story.</div>',
    );
  });

  it("plain text leads with the short version too", () => {
    const blocks = normalizeBlocks({
      blocks: [
        { type: "p", text: "Story." },
        { type: "tldr", lines: ["Short beat."] },
      ],
    });
    expect(blocksToTextLines(blocks)).toEqual([
      "Short version",
      "Short beat.",
      "Story.",
    ]);
  });
});
