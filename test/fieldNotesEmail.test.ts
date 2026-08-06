import { describe, it, expect } from "vitest";
import {
  EMAIL_THEME,
  buildFieldNotesHtml,
  loopDiagramHtml,
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
});
