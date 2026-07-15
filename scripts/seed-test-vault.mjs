#!/usr/bin/env node
/**
 * Seed ~20 past daily notes into the throwaway vault for parse/pipeline testing.
 * Does not create a note for "today" with the intent of processing it — today may
 * exist with unmarked bullets to prove AE4 exclusion.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vault = join(root, "test_vault", "test vault");
const dailyFolder = join(vault, "Daily");

mkdirSync(dailyFolder, { recursive: true });

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const today = new Date();
const samples = [
  (i) => `- 09:1${i % 10} morning thought number ${i} about focus\n`,
  (i) => `- buy milk item ${i}\n\t<!--linker:task-->\n`,
  (i) =>
    `- sleep related hunch ${i}\n\t↳ [[Sleep debt doesn't accumulate linearly]] <!--linker-->\n`,
  (i) =>
    `- multi-line idea ${i}\n  continues on next line with [[user link]]\n  still going\n`,
  (i) => `- noise lol ${i}\n\t<!--linker:noise-->\n`,
  (i) => `- unmarked observation ${i} that should still process\n`,
];

// 20 past days + today (today has unmarked — must be excluded by parser pipeline)
for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  const date = ymd(d);
  const path = join(dailyFolder, `${date}.md`);
  const lines = [`# ${date}`, ""];
  if (daysAgo === 0) {
    lines.push("- TODAY unmarked capture — must never be processed (AE4)\n");
  } else {
    for (let k = 0; k < 3; k++) {
      const gen = samples[(daysAgo + k) % samples.length];
      lines.push(gen(daysAgo * 10 + k));
    }
  }
  writeFileSync(path, lines.join("\n"), "utf8");
}

// Daily Notes core plugin settings (format + folder)
const dailyNotesConfig = {
  format: "YYYY-MM-DD",
  folder: "Daily",
  template: "",
};
const cfgPath = join(vault, ".obsidian", "daily-notes.json");
mkdirSync(dirname(cfgPath), { recursive: true });
writeFileSync(cfgPath, JSON.stringify(dailyNotesConfig, null, 2) + "\n");

// Ensure daily-notes core plugin enabled
const corePath = join(vault, ".obsidian", "core-plugins.json");
if (existsSync(corePath)) {
  try {
    const core = JSON.parse(readFileSync(corePath, "utf8"));
    // core-plugins.json can be array of enabled or object map depending on version
    if (Array.isArray(core)) {
      if (!core.includes("daily-notes")) core.push("daily-notes");
      writeFileSync(corePath, JSON.stringify(core, null, 2) + "\n");
    } else if (core && typeof core === "object") {
      core["daily-notes"] = true;
      writeFileSync(corePath, JSON.stringify(core, null, 2) + "\n");
    }
  } catch {
    /* leave as-is */
  }
}

console.log(`Seeded Daily/ notes in ${vault}`);
console.log(`Today=${ymd(today)} has unmarked capture for AE4 exclusion tests`);
