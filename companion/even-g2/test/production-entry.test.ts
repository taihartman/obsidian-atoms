import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("production companion entry", () => {
  it("keeps the packaged HTML on the production-only entry", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const entry = readFileSync(join(root, "src/main.ts"), "utf8");
    expect(html).toContain('src="/src/main.ts"');
    expect(html).toContain('<output id="capability-status" aria-live="polite">Atoms</output>');
    expect(entry).toContain('"https://plus.tryatoms.app"');
    expect(`${html}\n${entry}`).not.toMatch(/localhost|127\.0\.0\.1|simulatorConfig|simulatorSetup|simulator\.html|autoDriveSimulatorSetup|auto=1|pair=/iu);
    expect(readFileSync(join(root, "src/bootstrap.ts"), "utf8")).toMatch(/installEvenSdkEventLogPrivacy\(\)[\s\S]*waitForEvenAppBridge\(\)/u);
  });

  it("makes package verification reject loopback and simulator-only material", () => {
    const verifier = readFileSync(join(root, "scripts/verify-package.mjs"), "utf8");
    expect(verifier).toContain("simulator-only material found in G2 package");
    expect(verifier).toMatch(/localhost/);
    expect(verifier).toMatch(/127\\\.0\\\.0\\\.1/);
    expect(verifier).toMatch(/autoDriveSimulatorSetup/);
    expect(verifier).toMatch(/auto=1/);
  });

  it("exposes explicit simulator and supporting-services commands", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.simulator).toBe("node scripts/simulator-harness.mjs");
    expect(pkg.scripts["simulator:services"]).toBe("node scripts/simulator-harness.mjs --services-check");
    expect(pkg.scripts).not.toHaveProperty("simulator:smoke");
  });
});
