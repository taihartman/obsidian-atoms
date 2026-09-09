import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const challengeToken = readFileSync(
  join(root, "www", "src", ".well-known", "openai-apps-challenge"),
  "utf8",
).trim();
let dist = "";

describe("OpenAI plugin domain challenge", () => {
  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), "atoms-openai-challenge-"));
    execFileSync(process.execPath, ["www/build.mjs"], {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, ATOMS_DIST_DIR: dist },
    });
  });

  afterAll(() => {
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  it("emits the challenge at the exact well-known path with no extra bytes", () => {
    expect(challengeToken).toMatch(/^[A-Za-z0-9_-]+$/);
    const challenge = readFileSync(
      join(dist, ".well-known", "openai-apps-challenge"),
      "utf8",
    );
    expect(challenge).toBe(challengeToken);
  });
});
