import type { ClassificationPerson, PersonRole } from "../shared/types";

/**
 * Pipeline generation stamp so older atoms can be refreshed to Process parity.
 * Bump CURRENT when Process/Update behavior that should re-touch old notes changes.
 */

/** Bump when Process/Update should re-touch older atoms (e.g. self-link ban). */
export const CURRENT_ATOMS_QUALITY = 8;

const GENERATED_BY_RE = /^generated-by:\s*linker\s*$/m;
const QUALITY_RE = /^atoms-quality:\s*(\d+)\s*$/m;

/** Local calendar YYYY-MM-DD. */
export function localDateYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local wall clock `YYYY-MM-DDTHH:mm:ss` (library Recents / parseCreatedMs). */
export function localDateTimeStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${mi}:${s}`;
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

const PEOPLE_KEY_RE = /^atoms-people:(.*)$/;
const PEOPLE_NAME_RE = /^\s{2}-\s+name:\s*(.+?)\s*$/;
const PEOPLE_ROLE_RE = /^\s{4}role:\s*([a-z]+)\s*$/;
const PERSON_ROLES = new Set<PersonRole>([
  "subject",
  "mentioned",
  "recommender",
]);

/** Frontmatter lines for `atoms-people` (empty list stays explicit). */
export function atomsPeopleLines(people: ClassificationPerson[]): string[] {
  if (!people.length) return ["atoms-people: []"];
  const lines = ["atoms-people:"];
  for (const p of people) {
    lines.push(`  - name: ${JSON.stringify(p.name)}`);
    lines.push(`    role: ${p.role}`);
  }
  return lines;
}

/**
 * Parse `atoms-people` from an atom's frontmatter.
 *
 * Returns `null` when the key is absent — a legacy atom written before the
 * field existed, which must fall back to the heuristic path — and `[]` when the
 * key is present but empty, meaning the model found nobody. Collapsing the two
 * would put every legacy atom back on the buggy guesser (KTD6).
 */
export function parseAtomsPeople(
  content: string,
): ClassificationPerson[] | null {
  const fm = frontmatterBlock(content);
  if (!fm) return null;
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((l) => PEOPLE_KEY_RE.test(l));
  if (start === -1) return null;
  const inline = lines[start]!.match(PEOPLE_KEY_RE)![1]!.trim();
  if (inline) return inline === "[]" ? [] : null;

  const people: ClassificationPerson[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const name = lines[i]!.match(PEOPLE_NAME_RE)?.[1];
    if (!name) break;
    const role = lines[i + 1]?.match(PEOPLE_ROLE_RE)?.[1] as
      | PersonRole
      | undefined;
    if (!role || !PERSON_ROLES.has(role)) break;
    people.push({ name: unquoteYaml(name), role });
    i++;
  }
  return people;
}

function unquoteYaml(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
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
