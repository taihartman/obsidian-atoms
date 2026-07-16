/**
 * Pipeline generation stamp so older atoms can be refreshed to Process parity.
 * Bump CURRENT when Process/Update behavior that should re-touch old notes changes.
 */

export const CURRENT_ATOMS_QUALITY = 2;

const GENERATED_BY_RE = /^generated-by:\s*linker\s*$/m;
const QUALITY_RE = /^atoms-quality:\s*(\d+)\s*$/m;

/** Local calendar YYYY-MM-DD. */
export function localDateYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Frontmatter block only (includes opening ---). */
export function frontmatterBlock(content: string): string {
  if (!content.startsWith("---")) return "";
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content.slice(0, 800);
  return content.slice(0, end + 4);
}

export function isLinkerGenerated(content: string): boolean {
  return GENERATED_BY_RE.test(frontmatterBlock(content));
}

/**
 * Parsed quality integer. Missing / unstamped → 0 (eligible when CURRENT > 0).
 */
export function parseAtomsQuality(content: string): number {
  const fm = frontmatterBlock(content);
  const m = fm.match(QUALITY_RE);
  if (!m?.[1]) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Eligible for Update notes when linker-generated and below CURRENT. */
export function isEligibleForUpdate(
  content: string,
  current: number = CURRENT_ATOMS_QUALITY,
): boolean {
  if (!isLinkerGenerated(content)) return false;
  return parseAtomsQuality(content) < current;
}

export function qualityStampLines(
  today: string = localDateYmd(),
  quality: number = CURRENT_ATOMS_QUALITY,
): { quality: number; updated: string; lines: string[] } {
  return {
    quality,
    updated: today,
    lines: [`atoms-quality: ${quality}`, `quality-updated: ${today}`],
  };
}
