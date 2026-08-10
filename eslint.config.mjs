/**
 * Community-aligned lint — same family as the Obsidian plugin review scan.
 * Upstream: https://github.com/obsidianmd/eslint-plugin
 */
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "test/**",
      "www/**",
      "plus-service/**",
      "companion/**",
      "scripts/**",
      "docs/**",
      "esbuild.config.mjs",
      "version-bump.mjs",
      "*.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Large imperative settings surface; declarative migration is its own claim.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      // minAppVersion is still below 1.13; we keep display() on purpose.
      "obsidianmd/settings-tab/no-deprecated-display": "off",
      // Product voice owns UI strings (Atoms Plus, Capture Atom, brands). Not auto-fixed.
      "obsidianmd/ui/sentence-case": "off",
      // display() still required below 1.13; deprecation noise is expected until migration.
      "@typescript-eslint/no-deprecated": "off",
    },
  },
]);
