/**
 * Bundle the plugin's real prompt-building code so measurement scripts exercise the shipped
 * request, not a copy of it. Uses the same `obsidian` mock alias the test suite uses.
 *
 * scripts/measure-classify-cost.mjs carries its own copy of this deliberately: its numbers are
 * published in docs/research/, and rewiring it would put those figures behind an untested edit.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { REPO_ROOT } from "./shortlist.mjs";

export async function loadRepoPipeline() {
  const outfile = path.join(REPO_ROOT, "node_modules/.cache/atoms-measure/pipeline.mjs");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    stdin: {
      contents: [
        `export { buildMessagesRequest, SYSTEM_PROMPT, CLASSIFICATION_SCHEMA, classifyCapture } from "./src/pipeline/classify";`,
        `export { buildVaultContext } from "./src/pipeline/context";`,
        `export { DEFAULT_ACTIVE_VOCABULARY } from "./src/pipeline/vocabulary";`,
        `export { ASSUMED_OUTPUT_TOKENS, DEFAULT_BACKFILL_MODEL } from "./src/pipeline/backfill";`,
      ].join("\n"),
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "error",
    alias: {
      obsidian: path.join(REPO_ROOT, "test/mocks/obsidian.ts"),
      "obsidian-daily-notes-interface": path.join(
        REPO_ROOT,
        "test/mocks/obsidian-daily-notes-interface.ts",
      ),
    },
  });
  return import(pathToFileURL(outfile).href);
}
