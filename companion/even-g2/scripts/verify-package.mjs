import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
const html = readFileSync(join(root, "index.html"), "utf8");
const expected = {
  "@evenrealities/even_hub_sdk": "0.0.15",
  "@evenrealities/evenhub-cli": "0.1.14",
  "@evenrealities/evenhub-simulator": "0.9.5",
};
for (const [name, version] of Object.entries(expected)) {
  const actual = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (actual !== version) throw new Error(`${name} must be pinned exactly to ${version}`);
}
if (manifest.min_app_version !== "2.2.10" || manifest.min_sdk_version !== "0.0.15") throw new Error("Even app/SDK floors drifted");
const permissions = manifest.permissions || [];
if (permissions.length !== 2 || permissions.map((entry) => entry.name).sort().join(",") !== "g2-microphone,network") throw new Error("G2 package permissions are not minimal");
const origins = permissions.find((entry) => entry.name === "network")?.whitelist;
if (JSON.stringify(origins) !== JSON.stringify(["https://plus.tryatoms.app", "wss://plus.tryatoms.app"])) throw new Error("G2 package origins drifted");
for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src https://plus.tryatoms.app wss://plus.tryatoms.app", "base-uri 'none'"]) {
  if (!html.includes(directive)) throw new Error(`CSP missing ${directive}`);
}
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const candidates = files(join(root, "dist")).map((path) => readFileSync(path));
const artifact = join(root, "atoms-g2.ehpk");
const unpacked = spawnSync("unzip", ["-p", artifact], { encoding: null });
if (unpacked.status === 0 && unpacked.stdout) candidates.push(unpacked.stdout);
else candidates.push(readFileSync(artifact));
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
for (const bytes of candidates) {
  const text = bytes.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) throw new Error("secret-like material found in G2 package");
  if (simulatorPatterns.some((pattern) => pattern.test(text))) throw new Error("simulator-only material found in G2 package");
}
console.log(`G2 package verified: ${statSync(artifact).size} bytes, exact pins/origins/permissions/CSP, no secret-like or simulator-only material`);
