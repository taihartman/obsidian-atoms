#!/usr/bin/env bash
# Agent-facing verification: unit tests + vault fixtures + live Obsidian CLI.
# Requires Obsidian open on the throwaway vault with CLI enabled.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:-$ROOT/test_vault/test vault}"
cd "$ROOT"

echo "=== unit tests ==="
npm test

echo "=== seed + install ==="
npm run seed:vault
./scripts/install-to-vault.sh

if ! command -v obsidian >/dev/null 2>&1; then
  echo "FAIL: obsidian CLI not on PATH"
  exit 1
fi

open -a Obsidian "$VAULT" 2>/dev/null || true
sleep 1

echo "=== CLI: plugins / commands ==="
(
  cd "$VAULT"
  obsidian plugins:enabled | grep -E '^(atoms|daily-notes)$' || {
    echo "FAIL: expected atoms and daily-notes enabled"
    exit 1
  }
  obsidian commands filter=atoms
  obsidian command id=atoms:list-unprocessed-captures
  obsidian command id=atoms:log-context-prefix
  # Live context stability via plugin
  out=$(obsidian eval 'code=(()=>{const p=app.plugins.plugins["atoms"];if(!p?.contextProvider)return "missing";const a=p.contextProvider.buildContext();const b=p.contextProvider.buildContext();return JSON.stringify({stable:JSON.stringify(a)===JSON.stringify(b),titles:a.titles.length,tags:a.tags.length,vocab:a.vocabulary.length})})()')
  echo "$out"
  echo "$out" | grep -q 'stable":true' || { echo "FAIL: context not stable"; exit 1; }
)

echo "=== ground-truth parse (filesystem) ==="
npx --yes tsx -e '
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { collectPastNotesWithUnmarkedCaptures, parseCaptures } from "./src/parse.ts";

const vault = process.argv[1];
const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
const notes = readdirSync(vault).filter((f) => f.endsWith(".md")).map((f) => {
  const date = f.replace(/\.md$/, "");
  return { path: "Daily/" + f, date, content: readFileSync(join(vault, f), "utf8") };
});
const result = collectPastNotesWithUnmarkedCaptures(notes, todayStr);
const todayNote = notes.find((n) => n.date === todayStr);
const todayUnmarked = todayNote
  ? parseCaptures(todayNote.content).filter((c) => !c.processed).length
  : 0;
const total = result.reduce((n, x) => n + x.unprocessed.length, 0);
const todayExcluded = !result.some((n) => n.date === todayStr);
const out = {
  today: todayStr,
  dailyFiles: notes.length,
  pastDaysWithUnprocessed: result.length,
  totalUnprocessed: total,
  todayUnmarkedCount: todayUnmarked,
  todayExcludedFromPipeline: todayExcluded,
};
console.log(JSON.stringify(out, null, 2));
if (!todayExcluded) {
  console.error("FAIL: today appeared in pipeline");
  process.exit(1);
}
if (todayUnmarked < 1) {
  console.error("FAIL: expected today to have an unmarked capture for AE4 fixture");
  process.exit(1);
}
if (total < 1) {
  console.error("FAIL: expected some unprocessed past captures");
  process.exit(1);
}
console.log("ground-truth OK");
' "$VAULT/Daily"

echo "=== live vault scan (CLI eval) ==="
(
  cd "$VAULT"
  obsidian eval 'code=(async()=>{
    const ATOM=/^\s*↳ .*\[\[.*\]\].*<!--linker-->\s*$/;
    const NON=/^\s*<!--linker:(task|noise)-->\s*$/;
    const TOP=/^- (.*)$/;
    const isMarker=l=>ATOM.test(l)||NON.test(l);
    function parseCaptures(content){
      const lines=content.split(/\r?\n/); const caps=[]; let i=0;
      while(i<lines.length){
        if(!TOP.test(lines[i])){i++;continue}
        i++;
        while(i<lines.length){
          const L=lines[i];
          if(L.length===0||TOP.test(L)||!/^[ \t]/.test(L)||isMarker(L)) break;
          i++;
        }
        let processed=false;
        if(i<lines.length&&isMarker(lines[i])){processed=true;i++}
        caps.push({processed});
      }
      return caps;
    }
    const d=new Date();
    const todayStr=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const files=app.vault.getMarkdownFiles().filter(f=>f.path.startsWith("Daily/"));
    let totalUn=0, days=0, todayUn=0;
    for (const f of files){
      const date=f.basename;
      const content=await app.vault.cachedRead(f);
      const un=parseCaptures(content).filter(c=>!c.processed);
      if(date===todayStr) todayUn=un.length;
      if(date>=todayStr) continue;
      if(un.length===0) continue;
      days++; totalUn+=un.length;
    }
    const p=app.plugins.plugins["atoms"];
    const k=p?.getApiKey?.();
    return JSON.stringify({
      live:true,
      today:todayStr,
      dailyFiles:files.length,
      pastDaysWithUnprocessed:days,
      totalUnprocessed:totalUn,
      todayUnmarkedCount:todayUn,
      plugin:!!p,
      hasKey:!!k
    });
  })()'
)

echo "=== verify.sh OK ==="
