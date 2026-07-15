import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
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

