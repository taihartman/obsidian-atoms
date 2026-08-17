import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Community listing matches only a plain X.Y.Z on the default branch. */
export const STABLE_PLUGIN_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * @param {{ packageVersion: string, manifestVersion: string }} versions
 * @returns {string | null} a reason the pair cannot land on master
 */
export function communityManifestProblem({ packageVersion, manifestVersion }) {
	if (packageVersion !== manifestVersion) {
		return `package.json (${packageVersion}) != manifest.json (${manifestVersion})`;
	}
	if (!STABLE_PLUGIN_VERSION.test(packageVersion)) {
		return (
			`version '${packageVersion}' cannot land on master — Community reads ` +
			`default-branch manifest.json and will not match a prerelease. Use a ` +
			`plain X.Y.Z, or tag the beta from the feature branch.`
		);
	}
	return null;
}

export function checkCommunityManifest(root = process.cwd()) {
	const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
	const manifestVersion = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
	return communityManifestProblem({ packageVersion, manifestVersion });
}

function main() {
	const problem = checkCommunityManifest();
	if (problem) {
		console.error(problem);
		process.exit(1);
	}
}

const invoked =
	Boolean(process.argv[1]) &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) main();
