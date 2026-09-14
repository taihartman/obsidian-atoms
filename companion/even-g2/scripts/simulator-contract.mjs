import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("@evenrealities/evenhub-simulator/package.json");
const simulator = JSON.parse(readFileSync(packagePath, "utf8"));
const readme = readFileSync(join(dirname(packagePath), "README.md"), "utf8");
if (simulator.version !== "0.9.5") throw new Error("simulator must remain pinned to 0.9.5");
for (const endpoint of ["/api/ping", "/api/screenshot/glasses", "/api/console", "/api/input"]) {
  if (!readme.includes(endpoint)) throw new Error(`pinned simulator is missing ${endpoint}`);
}
if (!readme.includes("576×288")) throw new Error("pinned simulator does not promise the required framebuffer size");
console.log("Pinned simulator 0.9.5 automation API verified; live screenshots remain a private-test evidence gate.");
