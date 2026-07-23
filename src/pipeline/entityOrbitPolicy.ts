/**
 * Surfaceability policy for entity orbits (Also about strip).
 */

import type { EntityOrbit, OrbitMember } from "./entityOrbitIndex";
import { normalizeOrbitId } from "./entityOrbitIndex";
import { isSoftEntityKey } from "./softKeys";

export const ORBIT_MIN_MEMBERS = 3;

export function isSurfaceableOrbit(
  orbit: EntityOrbit,
  personHubTitles?: Set<string> | string[],
): boolean {
  if (orbit.members.length < ORBIT_MIN_MEMBERS) return false;
  if (isSoftEntityKey(orbit.label) || isSoftEntityKey(orbit.id)) return false;
  if (personHubTitles) {
    const set =
      personHubTitles instanceof Set
        ? personHubTitles
        : new Set(
            [...personHubTitles].map((t) => t.trim().toLowerCase()).filter(Boolean),
          );
    if (set.has(normalizeOrbitId(orbit.label)) || set.has(orbit.id)) {
      // Person hubs may still form orbits for multi-membership pick;
      // exclusivity is applied at atom level in siblingsForAtom.
    }
  }
  return true;
}

function personSet(
  personHubTitles?: Set<string> | string[],
): Set<string> {
  if (!personHubTitles) return new Set();
  if (personHubTitles instanceof Set) {
    return new Set(
      [...personHubTitles].map((t) => t.trim().toLowerCase()).filter(Boolean),
    );
  }
  return new Set(
    personHubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
}

/**
 * Orbits containing this atom that may show Also about.
 * If every surfaceable key is a person hub, return [] (person invite owns).
 */
export function siblingsForAtom(
  path: string,
  orbits: EntityOrbit[],
  opts: { personHubTitles?: Set<string> | string[] } = {},
): { orbit: EntityOrbit; others: OrbitMember[] }[] {
  const persons = personSet(opts.personHubTitles);
  const hits: { orbit: EntityOrbit; others: OrbitMember[] }[] = [];

  for (const orbit of orbits) {
    if (!isSurfaceableOrbit(orbit)) continue;
    if (!orbit.members.some((m) => m.path === path)) continue;
    const others = orbit.members.filter((m) => m.path !== path);
    if (!others.length) continue;
    hits.push({ orbit, others });
  }

  if (!hits.length) return [];

  const allPerson = hits.every(
    (h) =>
      persons.has(h.orbit.id) || persons.has(normalizeOrbitId(h.orbit.label)),
  );
  if (allPerson && persons.size > 0) return [];

  // Prefer non-person orbits
  const nonPerson = hits.filter(
    (h) =>
      !persons.has(h.orbit.id) &&
      !persons.has(normalizeOrbitId(h.orbit.label)),
  );
  const pool = nonPerson.length ? nonPerson : hits;

  pool.sort((a, b) => {
    const mc = b.orbit.members.length - a.orbit.members.length;
    if (mc !== 0) return mc;
    const da = maxDate(a.others);
    const db = maxDate(b.others);
    if (da !== db) return db.localeCompare(da);
    return a.orbit.label.localeCompare(b.orbit.label);
  });

  return pool;
}

function maxDate(members: OrbitMember[]): string {
  let best = "";
  for (const m of members) {
    const d = (m.sourceDate ?? "").trim();
    if (d > best) best = d;
  }
  return best;
}

export function pickPrimaryOrbit(
  path: string,
  orbits: EntityOrbit[],
  opts: { personHubTitles?: Set<string> | string[] } = {},
): { orbit: EntityOrbit; others: OrbitMember[] } | null {
  const list = siblingsForAtom(path, orbits, opts);
  return list[0] ?? null;
}

export function sortSiblingRows(others: OrbitMember[]): OrbitMember[] {
  return [...others].sort((a, b) => {
    const da = (a.sourceDate ?? "").trim();
    const db = (b.sourceDate ?? "").trim();
    if (da !== db) return db.localeCompare(da);
    return a.title.localeCompare(b.title);
  });
}
