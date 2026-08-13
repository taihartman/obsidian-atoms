#!/usr/bin/env node
/**
 * Channel math for companion GitHub Releases.
 * Fastlane shells out: node companion/release/channel.mjs --platform … --lane … --version …
 */

const PLUGIN_TAG = /^\d+\.\d+\.\d+/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z0-9.]+))?$/;
const BETA_N = /^beta\.(\d+)$/;

export function parseMarketing(version) {
  const m = String(version ?? "").trim().match(SEMVER);
  if (!m) {
    throw new Error(`not a companion marketing version: ${version}`);
  }
  return { major: m[1], minor: m[2], patch: m[3], pre: m[4] ?? null, core: `${m[1]}.${m[2]}.${m[3]}` };
}

export function androidProdGuard(version) {
  const parsed = parseMarketing(version);
  if (parsed.pre) {
    throw new Error(`android prod refuses marketing '${version}' (need clean X.Y.Z, not -${parsed.pre})`);
  }
  return parsed.core;
}

export function androidBetaName(version) {
  const parsed = parseMarketing(version);
  if (parsed.pre) {
    const n = parsed.pre.match(BETA_N);
    if (!n) {
      throw new Error(`android beta cannot increment pre-release '${parsed.pre}'`);
    }
    return `${parsed.core}-beta.${Number(n[1]) + 1}`;
  }
  return `${parsed.core}-beta.1`;
}

export function iosGithubChannelVersion(marketing, existingTags = []) {
  const parsed = parseMarketing(marketing);
  if (parsed.pre) {
    throw new Error(`iOS MARKETING_VERSION must stay X.Y.Z (got ${marketing})`);
  }
  const prefix = `capture-ios-${parsed.core}-beta.`;
  let max = 0;
  for (const tag of existingTags) {
    if (!String(tag).startsWith(prefix)) continue;
    const n = Number(String(tag).slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${parsed.core}-beta.${max + 1}`;
}

export function releaseFlags({ platform, version }) {
  if (platform !== "android" && platform !== "ios") {
    throw new Error(`platform must be android or ios (got ${platform})`);
  }
  parseMarketing(version);
  const tag = `capture-${platform}-${version}`;
  if (PLUGIN_TAG.test(tag)) {
    throw new Error(`refusing plugin-shaped tag ${tag}`);
  }
  return {
    tag,
    prerelease: /-(beta|rc)(\.|$)/.test(version),
    latest: false,
  };
}

function parseArgs(argv) {
  const out = { platform: null, lane: null, version: null, existingTags: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--platform") out.platform = next();
    else if (a === "--lane") out.lane = next();
    else if (a === "--version") out.version = next();
    else if (a === "--existing-tags") {
      out.existingTags = (next() ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

export function runCli(argv) {
  const { platform, lane, version, existingTags } = parseArgs(argv);
  if (!platform || !lane || !version) {
    throw new Error("usage: channel.mjs --platform android|ios --lane beta|prod --version <ver> [--existing-tags a,b]");
  }
  let channelVersion = version;
  let marketing = version;
  if (platform === "android" && lane === "prod") {
    channelVersion = androidProdGuard(version);
    marketing = channelVersion;
  } else if (platform === "android" && lane === "beta") {
    channelVersion = androidBetaName(version);
    marketing = channelVersion;
  } else if (platform === "ios" && lane === "prod") {
    const parsed = parseMarketing(version);
    if (parsed.pre) throw new Error(`iOS prod refuses marketing '${version}'`);
    channelVersion = parsed.core;
    marketing = parsed.core;
  } else if (platform === "ios" && lane === "beta") {
    marketing = parseMarketing(version).core;
    channelVersion = iosGithubChannelVersion(marketing, existingTags);
  } else {
    throw new Error(`unknown lane ${lane}`);
  }
  const flags = releaseFlags({ platform, version: channelVersion });
  return { ...flags, marketing, channelVersion };
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)))}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
