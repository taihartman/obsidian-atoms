import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(root, "src/audio/moonshine-runtime-manifest.json"), "utf8"),
);
const sourceDir = join(root, "vendor/moonshine-wasm-single-thread");
const targetDir = join(root, "node_modules/@moonshine-ai/moonshine-wasm/dist");

if (manifest.packageVersion !== "0.1.5" || manifest.buildMode !== "single-thread-simd") {
  throw new Error("unexpected Moonshine runtime manifest");
}

mkdirSync(targetDir, { recursive: true });
for (const artifact of manifest.artifacts) {
  const source = join(sourceDir, artifact.name);
  verify(source, artifact);
  if (artifact.name.endsWith(".mjs")) {
    const glue = readFileSync(source, "utf8");
    if (/SharedArrayBuffer|PThread|em-pthread|shared\s*:\s*true/u.test(glue)) {
      throw new Error("threaded Moonshine runtime material found in fallback glue");
    }
  }
  const target = join(targetDir, artifact.name);
  const temporary = `${target}.tmp`;
  copyFileSync(source, temporary);
  renameSync(temporary, target);
  verify(target, artifact);
}

console.log("Prepared hash-verified single-thread SIMD Moonshine runtime");

function verify(path, artifact) {
  if (statSync(path).size !== artifact.bytes) {
    throw new Error(`unexpected byte count for ${artifact.name}`);
  }
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sha256 !== artifact.sha256) {
    throw new Error(`unexpected SHA-256 for ${artifact.name}`);
  }
}
