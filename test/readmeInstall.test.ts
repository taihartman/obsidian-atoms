/**
 * The community directory pulls README.md. If this file still talks as if Atoms
 * is unlisted, every new visitor on that page is sent to wait, or to BRAT.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");

describe("README install copy", () => {
  it("tells a new user to install from Community plugins now", () => {
    expect(readme).toContain(
      "Settings → **Community plugins** → Browse → **Atoms** → Install → Enable.",
    );
    expect(readme).toMatch(/community directory/i);
  });

  it("does not say the plugin is unlisted or only listed later", () => {
    expect(readme).not.toMatch(/once listed/i);
    expect(readme).not.toMatch(/when listed/i);
    expect(readme).not.toMatch(/not yet listed/i);
  });

  it("keeps BRAT as the dogfood / beta path, not the default", () => {
    const install = readme.split("## How to use")[0] ?? "";
    const communityAt = install.indexOf("### Community plugins");
    const bratAt = install.indexOf("### BRAT");
    expect(communityAt).toBeGreaterThan(-1);
    expect(bratAt).toBeGreaterThan(communityAt);
    expect(install).toMatch(/BRAT \(dogfood \/ beta\)/);
  });

  it("keeps a manual GitHub Release fallback", () => {
    expect(readme).toMatch(/### Manual \(GitHub Release\)/);
    expect(readme).toContain("<Vault>/.obsidian/plugins/atoms/");
  });
});
