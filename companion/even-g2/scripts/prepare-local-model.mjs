import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(
  join(root, "src/audio/moonshine-model-manifest.json"),
  "utf8",
));
const output = join(root, "public/moonshine/tiny-streaming-en");
await mkdir(output, { recursive: true });

for (const asset of manifest.assets) {
  const target = join(output, asset.name);
  let existing = null;
  try {
    existing = await readFile(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing && valid(asset, existing)) continue;

  const response = await fetchWithRetry(asset.url);
  if (!response.ok) throw new Error(`asset_download_failed:${asset.name}:${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertValid(asset, bytes);
  const temporary = `${target}.partial`;
  await rm(temporary, { force: true });
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);
}

console.log(`Prepared ${manifest.assets.length} hash-verified ${manifest.model} assets`);

function valid(asset, bytes) {
  return bytes.byteLength === asset.byteSize && sha256(bytes) === asset.sha256;
}

function assertValid(asset, bytes) {
  if (bytes.byteLength !== asset.byteSize) throw new Error(`asset_size_mismatch:${asset.name}`);
  if (sha256(bytes) !== asset.sha256) throw new Error(`asset_hash_mismatch:${asset.name}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}
