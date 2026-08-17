import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "companion/release/**/*.test.mjs"],
    // A DOM, because settings rows are asserted on what they render. happy-dom over jsdom:
    // it is the lighter and faster of the two, and nothing here needs jsdom's fuller
    // fidelity — the plugin only builds elements, reads text, and clicks. Obsidian's
    // `HTMLElement` sugar is installed by `test/mocks/domAugmentations.ts`.
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "test/mocks/obsidian.ts"),
      "obsidian-daily-notes-interface": path.resolve(
        __dirname,
        "test/mocks/obsidian-daily-notes-interface.ts",
      ),
    },
  },
});

