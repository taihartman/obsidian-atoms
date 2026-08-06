import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "www/dist");
const fixtureNote = join(here, "fixtures/field-notes/published/2026-08-01-sample-loop.json");
const publishedDir = join(root, "docs/field-notes/published");
const publishedSample = join(publishedDir, "2026-08-01-sample-loop.json");

describe("Field notes archive (dist)", () => {
  beforeAll(() => {
    mkdirSync(publishedDir, { recursive: true });
    // Temp copy for build:www only — do not leave fixtures in published/ (prod SSOT).
    cpSync(fixtureNote, publishedSample);
    execSync("npm run build:www", { cwd: root, stdio: "pipe" });
  });

  afterAll(() => {
    rmSync(publishedSample, { force: true });
  });

  it("emits index and issue pages", () => {
    expect(existsSync(join(dist, "notes/index.html"))).toBe(true);
    expect(existsSync(join(dist, "notes/sample-loop/index.html"))).toBe(true);
  });

  it("index lists the note and links the issue URL", () => {
    const html = readFileSync(join(dist, "notes/index.html"), "utf8");
    expect(html).toContain("Field notes");
    expect(html).toContain("sample-loop");
    expect(html).toContain('href="/notes/sample-loop/"');
    expect(html).toContain("The dump that finally stuck");
    expect(html).toContain("data-notes-form");
    expect(html).toContain('name="website"');
    expect(html).toMatch(/app\.[a-f0-9]{8}\.js/);
    expect(html).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    expect(html).not.toMatch(/style\s*=/);
    expect(html).not.toMatch(/—/);
    expect(html).not.toMatch(/comments|rss|RSS/i);
  });

  it("issue page has full substance and signup", () => {
    const html = readFileSync(join(dist, "notes/sample-loop/index.html"), "utf8");
    expect(html).toContain("The dump that finally stuck");
    expect(html).toContain("five-second capture");
    expect(html).toContain("notes-loop");
    expect(html).toContain("Open tryatoms.app");
    expect(html).toContain("also arrive by email");
    expect(html).toContain("data-notes-form");
    expect(html).toContain('href="/#how"');
    expect(html).toContain('href="/notes/"');
    expect(html).not.toContain("unsubscribe");
    expect(html).not.toMatch(/style\s*=/);
  });

  it("topbar on index home points Field notes at /notes/", () => {
    const index = readFileSync(join(dist, "index.html"), "utf8");
    const m = index.match(/class="topbar"[\s\S]*?<\/nav>/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('href="/notes/"');
  });
});

describe("Field notes empty archive", () => {
  it("builds honest empty state when published is empty", () => {
    const tmpPub = join(root, "docs/field-notes/published-empty-test");
    rmSync(tmpPub, { recursive: true, force: true });
    mkdirSync(tmpPub, { recursive: true });
    // Import generator pieces
    return import("../www/lib/fieldNotesContent.mjs").then(async (mod) => {
      const notes = mod.loadPublishedNotes(tmpPub);
      expect(notes).toEqual([]);
      rmSync(tmpPub, { recursive: true, force: true });
    });
  });
});
