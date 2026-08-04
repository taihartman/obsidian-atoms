/**
 * #238 F1 — `scripts/reconcile-stripe.mjs` must refuse an in-memory store.
 *
 * `createStore` only forces Postgres when ATOMS_PLUS_ENV *and* DATABASE_URL are
 * both set, so an operator shell with only DATABASE_URL exported gets the
 * memory store. There `hasProcessedEvent` is false for everyone: 100% of the
 * window flags, and `--repair` "repairs" every real customer into a map that
 * disappears when the process exits — while printing success.
 *
 * The guard lives in the script (the library takes whatever store it is given),
 * so this test spawns the script. STRIPE_SECRET_KEY is a dummy: the refusal
 * must happen before any Stripe call, so no network is ever reached.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";

/** @returns {Promise<{ code: number, stdout: string, stderr: string }>} */
function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["scripts/reconcile-stripe.mjs", ...args],
      {
        cwd: root,
        env: {
          ...process.env,
          ATOMS_PLUS_ENV: "development",
          STRIPE_SECRET_KEY: "sk_test_dummy",
          ATOMS_PLUS_STORE: "memory",
          DATABASE_URL: "",
          ...env,
        },
      },
      (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout, stderr });
      },
    );
  });
}

describe("#238 F1 — reconcile CLI refuses to sweep an empty in-memory store", () => {
  it("exits non-zero and names the remedy", async () => {
    const r = await runCli([]);

    assert.equal(r.code, 1, `expected refusal, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Refusing to sweep against a "memory" store/);
    assert.match(r.stderr, /ATOMS_PLUS_STORE=postgres/);
    assert.match(r.stderr, /--allow-memory-store/);
    assert.doesNotMatch(r.stdout, /FLAGGED/, "no sweep may have run");
  });

  it("refuses --repair against memory just as hard", async () => {
    const r = await runCli(["--repair"]);

    assert.equal(r.code, 1);
    assert.match(r.stderr, /Refusing to sweep/);
  });

  it("--allow-memory-store is a real flag, so the escape hatch is reachable", async () => {
    // Argv parsing runs before the store is created, so this proves the flag is
    // recognized without letting the sweep reach the network.
    const r = await runCli(["--allow-memory-store", "--bogus"]);

    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown argument: --bogus/);
    assert.doesNotMatch(r.stderr, /Unknown argument: --allow-memory-store/);
  });
});
