/**
 * Pipeline generation stamp on linker-written atoms.
 * Bump CURRENT when Process/Refresh model surfaces change (prompt/schema/enrich).
 */
export const CURRENT_ATOMS_QUALITY = 2;

/** Unstamped / missing → treat as 0 (eligible for refresh). */
export function parseAtomsQuality(content: string): number {
  if (!content.startsWith("---")) return 0;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(/^atoms-quality:\s*(\d+)\s*$/m);
  if (!m?.[1]) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

export function isEligibleForRefresh(content: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  if (!/^generated-by:\s*linker\s*$/m.test(fm)) return false;
  return parseAtomsQuality(content) < CURRENT_ATOMS_QUALITY;
}

/** YYYY-MM-DD in local time for quality-updated. */
export function qualityUpdatedDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
