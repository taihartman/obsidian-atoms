/** Open/close markers for managed hub blocks (also used when stripping taxonomy). */
export const GENERATED_OPEN = "<!-- atoms:generated v=1 -->";
export const GENERATED_CLOSE = "<!-- /atoms:generated -->";

/**
 * Extract human H2 headings from a person hub note for taxonomy.
 * Ignores H1, fenced code, and headings inside a managed generated block.
 * First occurrence wins when duplicate H2 text appears.
 */
export function parseHubSections(markdown: string): string[] {
  const text = markdown ?? "";
  const lines = text.split("\n");
  const out: string[] = [];
  const seen = new Set<string>();
  let inFence = false;
  let inGenerated = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (trimmed === GENERATED_OPEN || trimmed.startsWith("<!-- atoms:generated")) {
      inGenerated = true;
      continue;
    }
    if (trimmed === GENERATED_CLOSE || trimmed === "<!-- /atoms:generated -->") {
      inGenerated = false;
      continue;
    }
    if (inGenerated) continue;

    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m?.[1]) continue;
    const title = m[1].replace(/\s+#+\s*$/, "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
}
