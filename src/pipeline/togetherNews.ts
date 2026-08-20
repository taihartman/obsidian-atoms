/**
 * Together news picker: one unseen join onto an accepted hub, plus a
 * durable told-set. Home chrome lives in U4; this module is the data.
 */

import { membershipKeysForAtom } from "./entityOrbitIndex";
import { isNamedListHubTitle } from "./hubInvite";
import { pathInSafetyDenylist } from "./hubQualify";
import { isDailyBasenameKey } from "./softKeys";

export const LS_TOGETHER_NEWS_TOLD = "atoms-together-news-told-v1";

export type ToldStore = {
  load: () => string | null;
  save: (raw: string) => void;
};

export type TogetherNewsAtom = {
  path: string;
  title: string;
  content: string;
  sourceDate: string | null;
};

export type AcceptedHub = {
  title: string;
  path: string;
  kind: "person" | "list";
};

export type TogetherNewsCard = {
  hubTitle: string;
  hubPath: string;
  newestTitle: string;
  newestPath: string;
  newestSourceDate: string | null;
};

export function joinId(hubTitle: string, memberPath: string): string {
  return `${hubTitle.trim().toLowerCase()}::${memberPath}`;
}

export function togetherNewsCopy(opts: {
  newestTitle: string;
  hubTitle: string;
}): {
  kicker: string;
  title: string;
  supporting: string;
  openLabel: string;
  notNowLabel: string;
} {
  return {
    kicker: "Together",
    title: opts.newestTitle.trim() || "Untitled",
    supporting: opts.hubTitle.trim(),
    openLabel: "Open",
    notNowLabel: "Not now",
  };
}

export function collectAcceptedHubs(opts: {
  files: { path: string; basename: string }[];
  personHubs: { title: string; path: string }[];
}): AcceptedHub[] {
  const out: AcceptedHub[] = [];
  const seen = new Set<string>();
  for (const p of opts.personHubs) {
    const low = p.title.trim().toLowerCase();
    if (!low || seen.has(low)) continue;
    seen.add(low);
    out.push({ title: p.title.trim(), path: p.path, kind: "person" });
  }
  for (const f of opts.files) {
    if (pathInSafetyDenylist(f.path)) continue;
    const title = f.basename.trim();
    if (!isNamedListHubTitle(title)) continue;
    const low = title.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push({ title, path: f.path, kind: "list" });
  }
  return out;
}

function readTold(store: ToldStore): Set<string> | null {
  const raw = store.load();
  if (raw == null || raw === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return null;
  }
}

function writeTold(store: ToldStore, ids: Iterable<string>): void {
  store.save(JSON.stringify([...ids]));
}

function hubByTitle(hubs: AcceptedHub[]): Map<string, AcceptedHub> {
  const map = new Map<string, AcceptedHub>();
  for (const h of hubs) {
    map.set(h.title.trim().toLowerCase(), h);
  }
  return map;
}

type Join = {
  hub: AcceptedHub;
  memberPath: string;
  memberTitle: string;
  sourceDate: string | null;
};

function currentJoins(
  atoms: TogetherNewsAtom[],
  acceptedHubs: AcceptedHub[],
): Join[] {
  const hubs = hubByTitle(acceptedHubs);
  const out: Join[] = [];
  const seen = new Set<string>();
  for (const atom of atoms) {
    for (const key of membershipKeysForAtom(atom.content)) {
      if (isDailyBasenameKey(key)) continue;
      const hub = hubs.get(key.trim().toLowerCase());
      if (!hub) continue;
      const id = joinId(hub.title, atom.path);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        hub,
        memberPath: atom.path,
        memberTitle: atom.title,
        sourceDate: atom.sourceDate,
      });
    }
  }
  return out;
}

function excludedSet(titles: string[]): Set<string> {
  return new Set(titles.map((t) => t.trim().toLowerCase()).filter(Boolean));
}

function newerJoin(a: Join, b: Join): Join {
  const da = a.sourceDate ?? "";
  const db = b.sourceDate ?? "";
  if (da !== db) return da > db ? a : b;
  return a.memberPath < b.memberPath ? a : b;
}

export function pickTogetherNews(opts: {
  listingOn: boolean;
  atoms: TogetherNewsAtom[];
  acceptedHubs: AcceptedHub[];
  told: ToldStore;
  excludedHubTitles: string[];
}): TogetherNewsCard | null {
  if (!opts.listingOn) return null;
  const joins = currentJoins(opts.atoms, opts.acceptedHubs);
  let told = readTold(opts.told);
  if (told == null) {
    writeTold(
      opts.told,
      joins.map((j) => joinId(j.hub.title, j.memberPath)),
    );
    return null;
  }
  const blocked = excludedSet(opts.excludedHubTitles);
  let best: Join | null = null;
  for (const j of joins) {
    if (blocked.has(j.hub.title.trim().toLowerCase())) continue;
    if (told.has(joinId(j.hub.title, j.memberPath))) continue;
    best = best ? newerJoin(best, j) : j;
  }
  if (!best) return null;
  return {
    hubTitle: best.hub.title,
    hubPath: best.hub.path,
    newestTitle: best.memberTitle,
    newestPath: best.memberPath,
    newestSourceDate: best.sourceDate,
  };
}

export function consumeTogetherNews(opts: {
  hubTitle: string;
  atoms: TogetherNewsAtom[];
  acceptedHubs: AcceptedHub[];
  told: ToldStore;
}): void {
  const want = opts.hubTitle.trim().toLowerCase();
  const told = readTold(opts.told) ?? new Set<string>();
  for (const j of currentJoins(opts.atoms, opts.acceptedHubs)) {
    if (j.hub.title.trim().toLowerCase() !== want) continue;
    told.add(joinId(j.hub.title, j.memberPath));
  }
  writeTold(opts.told, told);
}

export function seedToldForAllCurrent(opts: {
  atoms: TogetherNewsAtom[];
  acceptedHubs: AcceptedHub[];
  told: ToldStore;
}): void {
  const told = readTold(opts.told) ?? new Set<string>();
  for (const j of currentJoins(opts.atoms, opts.acceptedHubs)) {
    told.add(joinId(j.hub.title, j.memberPath));
  }
  writeTold(opts.told, told);
}

export function stampToldJoins(
  told: ToldStore,
  hubTitle: string,
  memberPaths: string[],
): void {
  const ids = readTold(told) ?? new Set<string>();
  for (const path of memberPaths) {
    if (!path) continue;
    ids.add(joinId(hubTitle, path));
  }
  writeTold(told, ids);
}

export function localToldStore(app: {
  loadLocalStorage: (key: string) => unknown;
  saveLocalStorage: (key: string, value: unknown) => void;
}): ToldStore {
  return {
    load: () => {
      const raw = app.loadLocalStorage(LS_TOGETHER_NEWS_TOLD);
      return typeof raw === "string" ? raw : null;
    },
    save: (raw) => {
      app.saveLocalStorage(LS_TOGETHER_NEWS_TOLD, raw);
    },
  };
}
