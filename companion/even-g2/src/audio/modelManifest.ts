import manifest from "./moonshine-model-manifest.json";

export type MoonshineAsset = Readonly<{
  name: string;
  path: string;
  url: string;
  byteSize: number;
  sha256: string;
}>;

export const MOONSHINE_MODEL_MANIFEST = Object.freeze({
  ...manifest,
  delivery: "bundled" as const,
  assets: Object.freeze(manifest.assets.map((asset) => Object.freeze(asset))),
});

