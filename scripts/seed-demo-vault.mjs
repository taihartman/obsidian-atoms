#!/usr/bin/env node
/**
 * Seed fictional dogfood into docs/media/demo-vault for README screenshots.
 * Never copy personal / Remote Vault content — only synthetic sample notes.
 *
 * Usage:
 *   node scripts/seed-demo-vault.mjs            # full library (post-process)
 *   node scripts/seed-demo-vault.mjs --empty    # first-day empty home
 *   node scripts/seed-demo-vault.mjs --waiting  # past captures pending process
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vault = join(root, "docs", "media", "demo-vault");
const dailyFolder = join(vault, "Daily");
const atomsFolder = join(vault, "Atoms");
const peopleFolder = join(vault, "People");

const mode = process.argv.includes("--empty")
  ? "empty"
  : process.argv.includes("--waiting")
    ? "waiting"
    : "full";

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function wipeFolder(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const name of readdirSync(dir)) {
    if (name === ".gitkeep") continue;
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}

function ensureVaultSkeleton() {
  mkdirSync(join(vault, ".obsidian", "plugins", "atoms"), { recursive: true });
  mkdirSync(dailyFolder, { recursive: true });
  mkdirSync(atomsFolder, { recursive: true });
  mkdirSync(peopleFolder, { recursive: true });

  writeFileSync(
    join(vault, ".obsidian", "app.json"),
    JSON.stringify({ promptDelete: false, alwaysUpdateLinks: true }, null, 2) +
      "\n",
  );
  writeFileSync(
    join(vault, ".obsidian", "appearance.json"),
    JSON.stringify(
      { cssTheme: "", baseFontSize: 16, theme: "obsidian", accentColor: "" },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(vault, ".obsidian", "core-plugins.json"),
    JSON.stringify(
      {
        "file-explorer": true,
        "global-search": true,
        switcher: true,
        graph: false,
        backlink: true,
        canvas: false,
        "outgoing-link": true,
        "tag-pane": true,
        properties: true,
        "page-preview": true,
        "daily-notes": true,
        templates: false,
        "note-composer": true,
        "command-palette": true,
        "slash-command": false,
        "editor-status": true,
        bookmarks: true,
        "markdown-importer": false,
        "zk-prefixer": false,
        "random-note": false,
        outline: true,
        "word-count": true,
        slides: false,
        "audio-recorder": false,
        workspaces: false,
        "file-recovery": true,
        publish: false,
        sync: false,
        bases: false,
        webviewer: false,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify(["atoms"], null, 2) + "\n",
  );
  writeFileSync(
    join(vault, ".obsidian", "daily-notes.json"),
    JSON.stringify(
      { format: "YYYY-MM-DD", folder: "Daily", template: "" },
      null,
      2,
    ) + "\n",
  );
  // No secrets — empty key settings for screenshots
  writeFileSync(
    join(vault, ".obsidian", "plugins", "atoms", "data.json"),
    JSON.stringify(
      {
        apiKeySecretId: "",
        model: "claude-sonnet-4-20250514",
        atomFolder: "Atoms",
        activeVocabulary: [
          "idea",
          "question",
          "observation",
          "person",
          "preferences",
          "watch",
          "media",
          "list",
        ],
        proposedTags: [],
        useDeviceLocalKeyFallback: false,
        captureShortcutInstallUrl:
          "https://www.icloud.com/shortcuts/example-atoms-capture",
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(vault, "Welcome.md"),
    [
      "# Welcome",
      "",
      "Synthetic dogfood vault for **Atoms** — **target-quality** filing demo.",
      "All people, shows, and claims here are fictional sample content.",
      "",
      "## Look around",
      "",
      "1. Open **[[Jordan]]** → Backlinks with substantive reasons.",
      "2. Open **[[People]]** → workplace index edges.",
      "3. Open **[[App ideas]]** → product ideas kept as atoms (not task/noise).",
      "4. Open a **Daily** note → captures + markers.",
      "5. Graph view → hubs with dense edges; media links only when a hub note exists.",
      "",
    ].join("\n"),
  );
}

/** Fictional cast — not from any personal vault. */
const people = {
  jordan: {
    path: "People/Jordan.md",
    body: [
      "---",
      "tags:",
      "  - person",
      "---",
      "",
      "# Jordan",
      "",
      "Coworker on the design team. Likes quiet coffee walks.",
      "",
      "## Preferences",
      "- (atom backlinks add gift / aesthetic cues)",
      "",
      "## Work",
      "- Design critiques prefer mornings",
      "",
    ].join("\n"),
  },
  riley: {
    path: "People/Riley.md",
    body: [
      "---",
      "tags:",
      "  - person",
      "---",
      "",
      "# Riley",
      "",
      "Friend who always has a book recommendation.",
      "",
    ].join("\n"),
  },
  index: {
    path: "People/People.md",
    body: [
      "---",
      "tags:",
      "  - people-index",
      "---",
      "",
      "# People",
      "",
      "Workplace + social index. New person atoms link here when no dedicated hub yet.",
      "",
      "## Studio",
      "- (atom backlinks: Sam)",
      "",
    ].join("\n"),
  },
};

/**
 * Full library after process: past dailies with markers + flat atoms + hubs.
 * Content is inventedsample second-brain material only.
 */
function seedFull() {
  const d3 = ymd(daysAgo(3));
  const d2 = ymd(daysAgo(2));
  const d1 = ymd(daysAgo(1));
  const today = ymd(daysAgo(0));

  writeFileSync(join(vault, people.jordan.path), people.jordan.body);
  writeFileSync(join(vault, people.riley.path), people.riley.body);
  writeFileSync(join(vault, people.index.path), people.index.body);

  mkdirSync(join(vault, "Projects"), { recursive: true });
  writeFileSync(
    join(vault, "Projects/App ideas.md"),
    [
      "---",
      "tags:",
      "  - project",
      "  - ideas",
      "---",
      "",
      "# App ideas",
      "",
      "Hub for product / build ideas. Keepable pitches stay **atoms** that link here.",
      "",
    ].join("\n"),
  );

  // --- Atoms (filed) — target-quality reasons ---
  const atoms = [
    {
      file: "Short walks unlock stuck problems.md",
      created: `${d3}T09:14:00`,
      source: d3,
      tags: ["idea", "observation"],
      body: [
        "09:14 short walk fixed the design block better than another hour at the desk",
        "",
        "same recovery theme as deep-work breaks ([[Deep work needs recovery]])",
        "",
      ].join("\n"),
    },
    {
      file: "Deep work needs recovery.md",
      created: `${d3}T14:02:00`,
      source: d3,
      tags: ["idea"],
      body: [
        "14:02 deep work only sticks when I protect a real break after",
        "",
      ].join("\n"),
    },
    {
      file: "Jordan prefers morning design critiques.md",
      created: `${d2}T10:20:00`,
      source: d2,
      tags: ["person", "preferences"],
      body: [
        "10:20 Jordan said morning design critiques land better than late afternoon",
        "",
        "scheduling preference for critiques — mornings over late afternoon ([[Jordan]])",
        "",
      ].join("\n"),
    },
    {
      file: "Jordan likes the color periwinkle.md",
      created: `${d2}T11:00:00`,
      source: d2,
      tags: ["person", "preferences"],
      body: [
        "Jordan likes the color periwinkle",
        "",
        "concrete aesthetic preference for gifts / clothes ([[Jordan]])",
        "",
      ].join("\n"),
    },
    {
      file: "Want to watch Arrival.md",
      created: `${d2}T20:05:00`,
      source: d2,
      tags: ["watch", "movie", "media", "list"],
      body: [
        "20:05 Riley said rewatch Arrival for the linguistics angle",
        "",
        "watchlist: Arrival already in the vault · recommended by Riley ([[Arrival]]) · recommendation source ([[Riley]])",
        "",
      ].join("\n"),
    },
    {
      file: "Sam is the strong designer at Studio who wears a white collared shirt.md",
      created: `${d2}T12:00:00`,
      source: d2,
      tags: ["person", "observation"],
      body: [
        "Sam is the name of the really strong designer at Studio. Usually wears white collared shirt",
        "",
        "workplace / social index — identity cue from this capture ([[People]])",
        "",
      ].join("\n"),
    },
    {
      file: "Capture is cheap review is scarce.md",
      created: `${d1}T08:40:00`,
      source: d1,
      tags: ["idea"],
      body: [
        "08:40 capture is cheap; the scarce resource is a calm review pass later",
        "",
        "product stance for filing past dailies into atoms without a guilt review queue",
        "",
      ].join("\n"),
    },
    {
      file: "Questions beat vague goals.md",
      created: `${d1}T16:11:00`,
      source: d1,
      tags: ["question", "idea"],
      body: [
        "16:11 what would make tomorrow's planning feel light instead of heavy?",
        "",
      ].join("\n"),
    },
    {
      file: "Starbucks weekend drink tracker site idea.md",
      created: `${d1}T18:00:00`,
      source: d1,
      tags: ["idea", "project"],
      body: [
        "Personal starbucks weekend drink order tracker website.",
        "Please create a modern website to log weekend Starbucks drinks publicly with private write access and AI fun facts.",
        "",
        "product / build idea to revisit ([[App ideas]])",
        "",
      ].join("\n"),
    },
  ];

  // Most atoms unstamped (eligible for Update notes). One stamped at current quality.
  const CURRENT_ATOMS_QUALITY = 2;
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const tagsYaml = a.tags.map((t) => `  - ${t}`).join("\n");
    const qualityLines =
      i === 0
        ? [
            `atoms-quality: ${CURRENT_ATOMS_QUALITY}`,
            `quality-updated: ${a.created.slice(0, 10)}`,
          ]
        : [];
    writeFileSync(
      join(atomsFolder, a.file),
      [
        "---",
        `created: ${a.created}`,
        `source: "[[${a.source}]]"`,
        "generated-by: linker",
        ...qualityLines,
        "tags:",
        tagsYaml,
        "---",
        "",
        a.body,
      ].join("\n"),
    );
  }

  // Media hub stub so chips resolve
  writeFileSync(
    join(vault, "Arrival.md"),
    [
      "---",
      "tags:",
      "  - movie",
      "  - media",
      "---",
      "",
      "# Arrival",
      "",
      "Film about language and first contact. Sample hub for dogfood.",
      "",
    ].join("\n"),
  );

  // --- Dailies (processed markers on past days; today still open) ---
  writeFileSync(
    join(dailyFolder, `${d3}.md`),
    [
      `# ${d3}`,
      "",
      "- 09:14 short walk fixed the design block better than another hour at the desk",
      "\t↳ [[Short walks unlock stuck problems]] <!--linker-->",
      "- 14:02 deep work only sticks when I protect a real break after",
      "\t↳ [[Deep work needs recovery]] <!--linker-->",
      "- buy oat milk",
      "\t<!--linker:noise-->",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dailyFolder, `${d2}.md`),
    [
      `# ${d2}`,
      "",
      "- 10:20 Jordan said morning design critiques land better than late afternoon",
      "\t↳ [[Jordan prefers morning design critiques]] <!--linker-->",
      "- Jordan likes the color periwinkle",
      "\t↳ [[Jordan likes the color periwinkle]] <!--linker-->",
      "- 20:05 Riley said rewatch Arrival for the linguistics angle",
      "\t↳ [[Want to watch Arrival]] <!--linker-->",
      "- Sam is the name of the really strong designer at Studio. Usually wears white collared shirt",
      "\t↳ [[Sam is the strong designer at Studio who wears a white collared shirt]] <!--linker-->",
      "- email landlord about the lock",
      "\t<!--linker:noise-->",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dailyFolder, `${d1}.md`),
    [
      `# ${d1}`,
      "",
      "- 08:40 capture is cheap; the scarce resource is a calm review pass later",
      "\t↳ [[Capture is cheap review is scarce]] <!--linker-->",
      "- 16:11 what would make tomorrow's planning feel light instead of heavy?",
      "\t↳ [[Questions beat vague goals]] <!--linker-->",
      "- Personal starbucks weekend drink order tracker website.",
      "- Please create a modern website to log weekend Starbucks drinks publicly with private write access and AI fun facts.",
      "\t↳ [[Starbucks weekend drink tracker site idea]] <!--linker-->",
      "- schedule dentist",
      "\t<!--linker:noise-->",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dailyFolder, `${today}.md`),
    [
      `# ${today}`,
      "",
      "- still thinking about whether weekly reviews should stay on Fridays",
      "- try a 25-minute focus block before messages",
      "",
    ].join("\n"),
  );
}

/** Past unmarked captures only — home shows waiting / process card. */
function seedWaiting() {
  const d2 = ymd(daysAgo(2));
  const d1 = ymd(daysAgo(1));
  const today = ymd(daysAgo(0));

  writeFileSync(join(vault, people.jordan.path), people.jordan.body);
  writeFileSync(join(vault, people.riley.path), people.riley.body);

  writeFileSync(
    join(dailyFolder, `${d2}.md`),
    [
      `# ${d2}`,
      "",
      "- 10:20 Jordan said morning design critiques land better than late afternoon",
      "- 20:05 Riley said rewatch Arrival for the linguistics angle",
      "- buy oat milk",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dailyFolder, `${d1}.md`),
    [
      `# ${d1}`,
      "",
      "- 08:40 capture is cheap; the scarce resource is a calm review pass later",
      "- 16:11 what would make tomorrow's planning feel light instead of heavy?",
      "- short walk unlocked a stuck design problem",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(dailyFolder, `${today}.md`),
    [
      `# ${today}`,
      "",
      "- still thinking about whether weekly reviews should stay on Fridays",
      "",
    ].join("\n"),
  );
}

/** First-day: empty library, empty past queue, setup card only. */
function seedEmpty() {
  const today = ymd(daysAgo(0));
  writeFileSync(
    join(dailyFolder, `${today}.md`),
    [`# ${today}`, "", ""].join("\n"),
  );
}

// --- run ---
ensureVaultSkeleton();
wipeFolder(dailyFolder);
wipeFolder(atomsFolder);
wipeFolder(peopleFolder);
// Remove stray sample hubs from prior full seeds
for (const extra of ["Arrival.md", "Welcome.md"]) {
  const p = join(vault, extra);
  if (existsSync(p) && extra !== "Welcome.md") rmSync(p, { force: true });
}
// Clean Projects/ between seeds (recreated in full mode)
const projectsDir = join(vault, "Projects");
if (existsSync(projectsDir) && mode !== "full") {
  wipeFolder(projectsDir);
}

if (mode === "empty") seedEmpty();
else if (mode === "waiting") seedWaiting();
else seedFull();

console.log(`Seeded demo vault (${mode}): ${vault}`);
console.log(`  Daily: ${readdirSync(dailyFolder).join(", ") || "(none)"}`);
console.log(`  Atoms: ${readdirSync(atomsFolder).join(", ") || "(none)"}`);
console.log(
  `  People: ${existsSync(peopleFolder) ? readdirSync(peopleFolder).join(", ") || "(none)" : "(none)"}`,
);
