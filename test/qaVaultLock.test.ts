/**
 * #516 — the shared QA vault lock.
 *
 * This script decides whether a QA pass is looking at its own build, so its failure mode is not a
 * crash, it is evidence that quietly belongs to somebody else. Both bugs it shipped with during
 * development are pinned here: the lock keyed per worktree (which would have let every session
 * take "the lock" and clobber each other exactly as before), and the missing lock directory (which
 * reported a phantom holder read out of a file that did not exist).
 *
 * Every case runs against a temp vault path, so the key differs from the real one and these tests
 * can never take the lock a live session is holding.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../scripts/qa-vault-lock.sh");

let vault: string;

function run(
  args: string[],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args, "--vault", vault], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return {
      status: err.status,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

const lockPath = (): string => run(["path"]).stdout.trim();

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), "atoms-qa-vault-"));
});

afterEach(() => {
  const p = lockPath();
  if (p && existsSync(p)) rmSync(p, { force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("qa-vault-lock", () => {
  it("starts free and can be taken, then released", () => {
    expect(run(["status"]).stdout).toContain("free");

    expect(run(["acquire", "--note", "unit"]).status).toBe(0);
    expect(run(["status"]).stdout).toContain("yours");

    expect(run(["release"]).status).toBe(0);
    expect(run(["status"]).stdout).toContain("free");
  });

  /**
   * The first bug. The lock file lived under a directory the script never created, so the very
   * first `mkdir "$LOCK.d"` failed for want of a parent and acquire reported a holder it had read
   * out of a nonexistent file — "held by ? for 29780288m".
   */
  it("takes the lock on a machine that has never held one", () => {
    const p = lockPath();
    if (existsSync(p)) rmSync(p, { force: true });

    const r = run(["acquire"]);

    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("held by ?");
  });

  it("re-acquiring your own lock is not a conflict", () => {
    run(["acquire", "--note", "first"]);
    expect(run(["acquire", "--note", "second"]).status).toBe(0);
  });

  it("refuses a lock another worktree holds, and names it", () => {
    writeFileSync(
      lockPath(),
      [
        "holder=/somewhere/else/peer-worktree",
        "branch=fix/their-thing",
        "note=driving a pass",
        `at=${Math.floor(Date.now() / 1000)}`,
        "ttl=2700",
        "",
      ].join("\n"),
    );

    const r = run(["acquire"]);

    expect(r.status).toBe(3);
    // Naming the holder is the whole point: "locked" with no owner sends the reader hunting.
    expect(r.stderr).toContain("peer-worktree");
    expect(r.stderr).toContain("fix/their-thing");
  });

  it("will not release a lock it does not hold without --force", () => {
    const held = [
      "holder=/somewhere/else/peer-worktree",
      "branch=fix/their-thing",
      "note=",
      `at=${Math.floor(Date.now() / 1000)}`,
      "ttl=2700",
      "",
    ].join("\n");
    writeFileSync(lockPath(), held);

    expect(run(["release"]).status).toBe(4);
    expect(existsSync(lockPath())).toBe(true);

    expect(run(["release", "--force"]).status).toBe(0);
    expect(existsSync(lockPath())).toBe(false);
  });

  /** An abandoned session must not hold the machine's only QA vault forever. */
  it("takes over a lock that has gone stale", () => {
    writeFileSync(
      lockPath(),
      [
        "holder=/somewhere/else/abandoned",
        "branch=gone",
        "note=",
        "at=1",
        "ttl=60",
        "",
      ].join("\n"),
    );

    expect(run(["status"]).stdout).toContain("STALE");
    expect(run(["acquire"]).status).toBe(0);
    expect(run(["status"]).stdout).toContain("yours");
  });

  /**
   * The second bug, and the one that would have made the whole feature theatre: the default vault
   * was resolved against the *running worktree*, so each session took a different lock for the
   * same vault and none of them ever saw the others. The vault lives in the main checkout; a
   * worktree must resolve to it and not to a `test_vault` of its own.
   */
  it("defaults to the main checkout's vault, not the running worktree's", () => {
    const resolved = execFileSync("bash", [SCRIPT, "vault"], {
      encoding: "utf8",
    }).trim();
    const mainCheckout = path.dirname(
      execFileSync(
        "git",
        ["-C", path.dirname(SCRIPT), "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { encoding: "utf8" },
      ).trim(),
    );

    expect(resolved).toBe(path.join(mainCheckout, "test_vault", "test vault"));

    // And when run from a linked worktree, that is still the answer rather than its own copy.
    const repoRoot = path.resolve(__dirname, "..");
    if (repoRoot !== mainCheckout) {
      expect(resolved.startsWith(repoRoot + path.sep)).toBe(false);
    }
  });

  it("keys the lock by the vault, so two callers agree on one lock file", () => {
    const first = lockPath();
    const second = run(["path"]).stdout.trim();
    expect(second).toBe(first);

    const other = mkdtempSync(path.join(tmpdir(), "atoms-qa-other-"));
    const otherLock = execFileSync(
      "bash",
      [SCRIPT, "path", "--vault", other],
      { encoding: "utf8" },
    ).trim();
    rmSync(other, { recursive: true, force: true });

    expect(otherLock).not.toBe(first);
  });
});
