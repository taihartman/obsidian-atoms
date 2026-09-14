import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
const modelManifest = JSON.parse(readFileSync(join(root, "src/audio/moonshine-model-manifest.json"), "utf8"));
const runtimeManifest = JSON.parse(readFileSync(join(root, "src/audio/moonshine-runtime-manifest.json"), "utf8"));
const html = readFileSync(join(root, "index.html"), "utf8");
const expected = {
  "@evenrealities/even_hub_sdk": "0.0.15",
  "@moonshine-ai/moonshine-wasm": "0.1.5",
  "@evenrealities/evenhub-cli": "0.1.14",
  "@evenrealities/evenhub-simulator": "0.9.5",
};
for (const [name, version] of Object.entries(expected)) {
  const actual = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (actual !== version) throw new Error(`${name} must be pinned exactly to ${version}`);
}
if (manifest.min_app_version !== "2.2.10" || manifest.min_sdk_version !== "0.0.15") throw new Error("Even app/SDK floors drifted");
if (manifest.version !== pkg.version) throw new Error("Even package and npm versions drifted");
if (runtimeManifest.packageVersion !== expected["@moonshine-ai/moonshine-wasm"] || runtimeManifest.buildMode !== "single-thread-simd") throw new Error("Moonshine runtime pin drifted");
const permissions = manifest.permissions || [];
if (permissions.length !== 2 || permissions.map((entry) => entry.name).sort().join(",") !== "g2-microphone,network") throw new Error("G2 package permissions are not minimal");
const origins = permissions.find((entry) => entry.name === "network")?.whitelist;
if (JSON.stringify(origins) !== JSON.stringify(["https://plus.tryatoms.app"])) throw new Error("G2 package origins drifted");
for (const directive of ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", "connect-src 'self' https://plus.tryatoms.app", "base-uri 'none'"]) {
  if (!html.includes(directive)) throw new Error(`CSP missing ${directive}`);
}
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const distRoot = join(root, "dist");
const distFiles = files(distRoot);
const runtimeSourceRoot = join(root, "vendor/moonshine-wasm-single-thread");
for (const runtime of runtimeManifest.artifacts) {
  verifyExact(join(runtimeSourceRoot, runtime.name), runtime, "vendored Moonshine runtime");
  const extension = extname(runtime.name);
  const matches = distFiles.filter((path) => basename(path).startsWith("moonshine-") && extname(path) === extension);
  if (matches.length !== 1) throw new Error(`expected one packaged Moonshine ${extension} runtime`);
  verifyExact(matches[0], runtime, "packaged Moonshine runtime");
}
const runtimeGlue = readFileSync(join(runtimeSourceRoot, "moonshine.mjs"), "utf8");
if (/SharedArrayBuffer|PThread|em-pthread|shared\s*:\s*true/u.test(runtimeGlue)) throw new Error("threaded Moonshine runtime material found in fallback package");
const modelRoot = join(distRoot, "moonshine/tiny-streaming-en");
const expectedModelFiles = modelManifest.assets.map((asset) => `moonshine/tiny-streaming-en/${asset.name}`).sort();
const actualModelFiles = files(modelRoot).map((path) => relative(distRoot, path)).sort();
if (JSON.stringify(actualModelFiles) !== JSON.stringify(expectedModelFiles)) throw new Error("unmanifested or missing Moonshine model asset");
for (const asset of modelManifest.assets) {
  const bytes = readFileSync(join(modelRoot, asset.name));
  if (bytes.byteLength !== asset.byteSize) throw new Error(`Moonshine asset size drifted: ${asset.name}`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) throw new Error(`Moonshine asset hash drifted: ${asset.name}`);
}
function verifyExact(path, expectedArtifact, label) {
  const bytes = readFileSync(path);
  if (bytes.byteLength !== expectedArtifact.bytes) throw new Error(`${label} size drifted: ${expectedArtifact.name}`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedArtifact.sha256) throw new Error(`${label} hash drifted: ${expectedArtifact.name}`);
}
const candidates = distFiles
  .filter((path) => [".html", ".js", ".mjs", ".json"].includes(extname(path)))
  .map((path) => readFileSync(path));
const artifact = join(root, "atoms-g2.ehpk");
candidates.push(readFileSync(artifact));
const secretPatterns = [
  /sk-ant-[A-Za-z0-9_-]{12,}/,
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /whsec_[A-Za-z0-9_-]{12,}/,
  /(?:G2_DATA_KEY_CURRENT|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[=:]\s*[^\s"']+/,
];
const simulatorPatterns = [
  /\blocalhost\b/i,
  /127\.0\.0\.1/,
  /simulator\.html/i,
  /simulator-base-url-refused/i,
  /simulator-only/i,
  /autoDriveSimulatorSetup/,
  /auto=1/i,
  /pair=/i,
];
const forbiddenProviderPatterns = [
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /gpt-4o-transcribe/i,
  /\/v1\/g2\/transcribe\/stream/i,
];
for (const bytes of candidates) {
  const text = bytes.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) throw new Error("secret-like material found in G2 package");
  if (simulatorPatterns.some((pattern) => pattern.test(text))) throw new Error("simulator-only material found in G2 package");
  if (forbiddenProviderPatterns.some((pattern) => pattern.test(text))) throw new Error("cloud speech provider material found in G2 package");
}
console.log(`G2 package verified: ${statSync(artifact).size} bytes, exact local speech/model pins, origins, permissions, CSP, and no cloud speech fallback`);
