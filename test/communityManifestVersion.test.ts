import { describe, expect, it } from "vitest";
import {
	STABLE_PLUGIN_VERSION,
	communityManifestProblem,
} from "../scripts/community-manifest-version.mjs";

describe("communityManifestProblem", () => {
	it("accepts a matching plain semver", () => {
		expect(
			communityManifestProblem({
				packageVersion: "0.8.3",
				manifestVersion: "0.8.3",
			}),
		).toBeNull();
	});

	it("refuses a beta, even when both files agree", () => {
		const problem = communityManifestProblem({
			packageVersion: "0.8.3-beta.2",
			manifestVersion: "0.8.3-beta.2",
		});
		expect(problem).toMatch(/cannot land on master/);
		expect(problem).toMatch(/0\.8\.3-beta\.2/);
	});

	it("refuses an rc the same way", () => {
		expect(
			communityManifestProblem({
				packageVersion: "0.8.4-rc.1",
				manifestVersion: "0.8.4-rc.1",
			}),
		).toMatch(/cannot land on master/);
	});

	it("refuses a v-prefix and a four-part version", () => {
		expect(
			communityManifestProblem({
				packageVersion: "v0.8.3",
				manifestVersion: "v0.8.3",
			}),
		).toMatch(/cannot land on master/);
		expect(
			communityManifestProblem({
				packageVersion: "0.8.3.1",
				manifestVersion: "0.8.3.1",
			}),
		).toMatch(/cannot land on master/);
	});

	it("names a package/manifest mismatch before the shape", () => {
		expect(
			communityManifestProblem({
				packageVersion: "0.8.3",
				manifestVersion: "0.8.3-beta.2",
			}),
		).toMatch(/package\.json \(0\.8\.3\) != manifest\.json \(0\.8\.3-beta\.2\)/);
	});
});

describe("STABLE_PLUGIN_VERSION", () => {
	it("is only three numeric parts", () => {
		expect(STABLE_PLUGIN_VERSION.test("0.8.3")).toBe(true);
		expect(STABLE_PLUGIN_VERSION.test("0.8.3-beta.1")).toBe(false);
		expect(STABLE_PLUGIN_VERSION.test("0.8.3-rc.1")).toBe(false);
	});

	it("refuses the shape release.yml used to treat as releasable", () => {
		// The auto-release job accepted X.Y.Z(-suffix)?. That is how
		// 0.8.3-beta.2 landed on master and delisted Community.
		const releasableTag = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/;
		expect(releasableTag.test("0.8.3-beta.2")).toBe(true);
		expect(STABLE_PLUGIN_VERSION.test("0.8.3-beta.2")).toBe(false);
	});
});
