import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
/**
 * This suite's own output. Deliberately NOT `www/dist`: that directory is the
 * artifact `pages deploy` ships, and the deploy workflow runs this test *after*
 * its real build, so a fixture build landing in `www/dist` is what production
 * then serves. Both overrides exist for the same reason — a test may read the
 * repo, but it may not write the things the repo ships.
 */
const dist = join(root, "www/dist-archive-test");
/**
 * The fixture archive this suite builds from. Handed to the build through
 * `ATOMS_PUBLISHED_DIR` rather than copied into `docs/field-notes/published/`:
 * that directory is the real archive, and the copy-then-delete this test used
 * to do removed a tracked file from the working tree on every run (#354).
 */
const fixturePublishedDir = join(here, "fixtures/field-notes/published");
const realPublishedDir = join(root, "docs/field-notes/published");
const realDist = join(root, "www/dist");

/** Snapshots taken at module load, before `beforeAll` builds anything. */
const realArchiveBefore = safeListing(realPublishedDir);
const realDistNotesBefore = safeListing(join(realDist, "notes"));

function safeListing(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe("Field notes archive (dist)", () => {
  beforeAll(() => {
    execSync("npm run build:www", {
      cwd: root,
      stdio: "pipe",
      env: {
        ...process.env,
        ATOMS_PUBLISHED_DIR: fixturePublishedDir,
        ATOMS_DIST_DIR: dist,
      },
    });
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

  // #354: this suite used to stage its fixture by copying it into the real
  // archive and deleting it afterwards, which removed a tracked file from the
  // working tree on every run — and the deleted file then rode into a commit
  // via `git add -A`. Building from a fixture directory is the fix; this is the
  // assertion that keeps it fixed.
  it("builds without touching the real published archive", () => {
    expect(safeListing(realPublishedDir)).toEqual(realArchiveBefore);
  });

  // The one that was actually shipping. `tryatoms-pages.yml` runs this suite as
  // an assertion *after* `npm run build:www`, then deploys `www/dist` — so when
  // this suite built into `www/dist`, production served the fixture archive.
  // The site listed "The dump that finally stuck" as a real Field note for that
  // reason, and deleting the source file did not fix it, because the test put
  // it back on every deploy.
  it("builds without overwriting the dist that gets deployed", () => {
    expect(safeListing(join(realDist, "notes"))).toEqual(realDistNotesBefore);
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
