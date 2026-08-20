import type { App } from "obsidian";
import { Notice, TFile } from "obsidian";
import type { PersonHubDetail } from "../shared/types";
import { membershipKeysForAtom } from "./entityOrbitIndex";
import {
  projectHubMarkdown,
  type HubProjectionEntry,
} from "./hubProjection";
import { parseHubSections } from "./hubSections";
import { discoverPersonHubs } from "./enrich/people";
import {
  hubHasGeneratedDelimiters,
  isListHubCandidate,
  pathInSafetyDenylist,
  shouldWriteNonPersonHub,
} from "./hubQualify";

export type HubProjectionPlanItem = {
  hubTitle: string;
  path: string;
  previous: string;
  next: string;
  changed: boolean;
  /** skipped by non-person write brake */
  skipped?: boolean;
  skipReason?: string;
  /** Entries used for this hub write (preview / Unsorted filter). */
  entries?: HubProjectionEntry[];
  /** Hub H2 taxonomy used for placement. */
  hubSections?: string[];
  kind?: "person" | "list";
};

export type HubProjectionError = {
  hubTitle: string;
  path?: string;
  reason: string;
};

export type HubProjectionPlan = {
  writes: HubProjectionPlanItem[];
  errors: HubProjectionError[];
  skipped: HubProjectionPlanItem[];
};

export type AtomForProjection = {
  title: string;
  content: string;
};

export type HubForProjection = {
  title: string;
  path: string;
  content: string;
  sections?: string[];
  /** person = no R3c brake; list = R3c applies */
  kind?: "person" | "list";
};

function titleFromAtomPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

function parseHubSectionFm(content: string): string | undefined {
  const m = content.match(/^hub-section:\s*(.+)$/m);
  if (!m) return undefined;
  let v = m[1]!.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    try {
      v = JSON.parse(v.includes('"') ? v : `"${v.slice(1, -1)}"`) as string;
    } catch {
      v = v.slice(1, -1);
    }
  }
  const t = String(v).trim();
  return t || undefined;
}

function entriesForHub(
  raw: HubProjectionEntry[],
  sections: string[],
): HubProjectionEntry[] {
  const sectionByLow = new Map(
    sections.map((s) => [s.trim().toLowerCase(), s.trim()] as const),
  );
  return raw.map((e) => {
    const sec = (e.section ?? "").trim();
    if (!sec) return { title: e.title, section: undefined };
    const canon = sectionByLow.get(sec.toLowerCase());
    if (canon) return { title: e.title, section: canon };
    return { title: e.title, section: undefined };
  });
}

/**
 * Pure plan: which hub files would change given atoms + hub contents.
 */
export function planHubProjection(opts: {
  enabled: boolean;
  touchedHubTitles: string[];
  atoms: AtomForProjection[];
  hubs: Map<string, HubForProjection>;
}): HubProjectionPlan {
  const writes: HubProjectionPlanItem[] = [];
  const skipped: HubProjectionPlanItem[] = [];
  const errors: HubProjectionError[] = [];
  if (!opts.enabled) return { writes, errors, skipped };

  const touch = new Set(
    opts.touchedHubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  if (!touch.size) return { writes, errors, skipped };

  const byHub = new Map<string, HubProjectionEntry[]>();
  for (const atom of opts.atoms) {
    const keys = membershipKeysForAtom(atom.content);
    const section = parseHubSectionFm(atom.content);
    const title = atom.title.trim();
    if (!title) continue;
    for (const k of keys) {
      const low = k.trim().toLowerCase();
      if (!touch.has(low)) continue;
      if (!opts.hubs.has(low)) continue;
      if (!byHub.has(low)) byHub.set(low, []);
      byHub.get(low)!.push({ title, section });
    }
  }

  for (const low of touch) {
    if (!byHub.has(low)) byHub.set(low, []);
  }

  for (const [low, rawEntries] of byHub) {
    const hub = opts.hubs.get(low);
    if (!hub) {
      errors.push({ hubTitle: low, reason: "hub-file-missing" });
      continue;
    }
    const sections = hub.sections ?? parseHubSections(hub.content);
    const entries = entriesForHub(rawEntries, sections);
    const kind = hub.kind ?? "person";

    if (kind === "list") {
      const hasMatching = entries.some((e) => !!(e.section ?? "").trim());
      const okWrite = shouldWriteNonPersonHub({
        memberCount: entries.length,
        hasMatchingHubSection: hasMatching,
        hubHasGeneratedDelimiters: hubHasGeneratedDelimiters(hub.content),
      });
      if (!okWrite) {
        skipped.push({
          hubTitle: hub.title,
          path: hub.path,
          previous: hub.content,
          next: hub.content,
          changed: false,
          skipped: true,
          skipReason: "non-person-write-brake",
        });
        continue;
      }
    }

    const projected = projectHubMarkdown(hub.content, entries, sections);
    if (!projected.ok) {
      errors.push({
        hubTitle: hub.title,
        path: hub.path,
        reason: projected.reason,
      });
      continue;
    }
    writes.push({
      hubTitle: hub.title,
      path: hub.path,
      previous: hub.content,
      next: projected.content,
      changed: projected.content !== hub.content,
      entries,
      hubSections: sections,
      kind,
    });
  }

  return { writes, errors, skipped };
}

/**
 * Resolve list hub files for titles (basename match, unique path preferred).
 */
export function resolveListHubsFromVault(opts: {
  files: { path: string; content: string }[];
  titlesLower: Set<string>;
}): Map<string, HubForProjection> {
  const byTitle = new Map<
    string,
    { path: string; content: string; sections: string[] }[]
  >();
  for (const f of opts.files) {
    const title = titleFromAtomPath(f.path);
    const low = title.trim().toLowerCase();
    if (!opts.titlesLower.has(low)) continue;
    const sections = parseHubSections(f.content);
    if (
      !isListHubCandidate({
        path: f.path,
        sections,
        content: f.content,
      })
    ) {
      continue;
    }
    if (!byTitle.has(low)) byTitle.set(low, []);
    byTitle.get(low)!.push({ ...f, sections });
  }

  const out = new Map<string, HubForProjection>();
  for (const [low, paths] of byTitle) {
    if (paths.length !== 1) continue;
    const f = paths[0]!;
    out.set(low, {
      title: titleFromAtomPath(f.path),
      path: f.path,
      content: f.content,
      sections: f.sections,
      kind: "list",
    });
  }
  return out;
}

export type FullHubProjectionBuild = {
  plan: HubProjectionPlan;
  hubs: Map<string, HubForProjection>;
  zeroMemberKnown: number;
};

/**
 * Load atoms + hubs and plan full regen (no vault.modify).
 */
export async function buildFullHubProjectionPlan(opts: {
  app: App;
  enabled: boolean;
  atomFolder: string;
  personHubDetails?: PersonHubDetail[];
}): Promise<FullHubProjectionBuild> {
  const empty: FullHubProjectionBuild = {
    plan: { writes: [], errors: [], skipped: [] },
    hubs: new Map(),
    zeroMemberKnown: 0,
  };
  if (!opts.enabled) return empty;

  const folder = opts.atomFolder.replace(/\/$/, "") || "Atoms";
  const mdFiles = opts.app.vault.getMarkdownFiles();
  const atomFiles = mdFiles.filter(
    (f) => f.path === folder || f.path.startsWith(folder + "/"),
  );

  const atoms: AtomForProjection[] = [];
  for (const f of atomFiles) {
    try {
      const content = await opts.app.vault.read(f);
      atoms.push({ title: titleFromAtomPath(f.path), content });
    } catch {
      /* skip */
    }
  }

  const caches = mdFiles.map((f) => ({
    path: f.path,
    cache: opts.app.metadataCache.getFileCache(f),
  }));
  const discovered = discoverPersonHubs(caches);
  const hubs = new Map<string, HubForProjection>();

  const detailByLow = new Map(
    (opts.personHubDetails ?? []).map((d) => [
      d.canonicalTitle.trim().toLowerCase(),
      d,
    ]),
  );

  for (const h of discovered) {
    const low = h.canonicalTitle.trim().toLowerCase();
    const file = opts.app.vault.getAbstractFileByPath(h.path);
    if (!(file instanceof TFile)) continue;
    try {
      const content = await opts.app.vault.read(file);
      const detail = detailByLow.get(low);
      const fromDetail = detail?.sections ?? [];
      hubs.set(low, {
        title: h.canonicalTitle,
        path: h.path,
        content,
        sections: fromDetail.length ? fromDetail : parseHubSections(content),
        kind: "person",
      });
    } catch {
      /* skip */
    }
  }

  const listTitles = collectListHubTitles(opts.app);
  const allowed = new Set(
    [...hubs.keys()].concat(listTitles.map((t) => t.toLowerCase())),
  );
  const memberTitles = new Set<string>();
  for (const a of atoms) {
    for (const k of membershipKeysForAtom(a.content)) {
      const low = k.trim().toLowerCase();
      if (allowed.has(low)) memberTitles.add(k.trim());
    }
  }
  let zeroMemberKnown = 0;
  for (const low of allowed) {
    if (![...memberTitles].some((t) => t.toLowerCase() === low)) {
      zeroMemberKnown += 1;
    }
  }
  const touched = [...memberTitles];
  if (!touched.length) {
    return { plan: { writes: [], errors: [], skipped: [] }, hubs, zeroMemberKnown };
  }

  const touchLow = new Set(touched.map((t) => t.toLowerCase()));
  const needSet = new Set([...touchLow].filter((t) => !hubs.has(t)));
  if (needSet.size) {
    const fileContents: { path: string; content: string }[] = [];
    for (const f of mdFiles) {
      const low = titleFromAtomPath(f.path).toLowerCase();
      if (!needSet.has(low)) continue;
      try {
        fileContents.push({
          path: f.path,
          content: await opts.app.vault.read(f),
        });
      } catch {
        /* skip */
      }
    }
    const listHubs = resolveListHubsFromVault({
      files: fileContents,
      titlesLower: needSet,
    });
    for (const [k, v] of listHubs) {
      if (!hubs.has(k)) hubs.set(k, v);
    }
  }

  const plan = planHubProjection({
    enabled: true,
    touchedHubTitles: touched,
    atoms,
    hubs,
  });
  return { plan, hubs, zeroMemberKnown };
}

/** Apply planned hub writes to the vault. */
export async function applyHubProjectionPlan(
  app: App,
  plan: HubProjectionPlan,
): Promise<{ wrote: number; errors: HubProjectionError[] }> {
  const errors = [...plan.errors];
  let wrote = 0;
  for (const w of plan.writes) {
    if (!w.changed) continue;
    const file = app.vault.getAbstractFileByPath(w.path);
    if (!(file instanceof TFile)) continue;
    try {
      await app.vault.modify(file, w.next);
      wrote += 1;
    } catch {
      errors.push({
        hubTitle: w.hubTitle,
        path: w.path,
        reason: "vault-modify-failed",
      });
    }
  }
  return { wrote, errors };
}

/**
 * Live vault: regenerate managed blocks for touched hubs (person + list).
 */
export async function runHubProjectionForHubs(opts: {
  app: App;
  enabled: boolean;
  atomFolder: string;
  /** Empty + fullRegen → all hubs with members */
  touchedHubTitles: string[];
  personHubDetails?: PersonHubDetail[];
  /** When true, touch every hub that has ≥1 hard-linked atom member */
  fullRegen?: boolean;
}): Promise<{
  wrote: number;
  filled: number;
  skipped: number;
  errors: HubProjectionError[];
}> {
  if (!opts.enabled) {
    return { wrote: 0, filled: 0, skipped: 0, errors: [] };
  }

  if (opts.fullRegen) {
    const built = await buildFullHubProjectionPlan({
      app: opts.app,
      enabled: true,
      atomFolder: opts.atomFolder,
      personHubDetails: opts.personHubDetails,
    });
    const applied = await applyHubProjectionPlan(opts.app, built.plan);
    const filled = built.plan.writes.filter((w) => w.changed).length;
    return {
      wrote: applied.wrote,
      filled,
      skipped: built.plan.skipped.length + built.zeroMemberKnown,
      errors: applied.errors,
    };
  }

  let touched = opts.touchedHubTitles.map((t) => t.trim()).filter(Boolean);
  if (!touched.length) {
    return { wrote: 0, filled: 0, skipped: 0, errors: [] };
  }

  const folder = opts.atomFolder.replace(/\/$/, "") || "Atoms";
  const mdFiles = opts.app.vault.getMarkdownFiles();
  const atomFiles = mdFiles.filter(
    (f) => f.path === folder || f.path.startsWith(folder + "/"),
  );

  const atoms: AtomForProjection[] = [];
  for (const f of atomFiles) {
    try {
      const content = await opts.app.vault.read(f);
      atoms.push({ title: titleFromAtomPath(f.path), content });
    } catch {
      /* skip */
    }
  }

  const caches = mdFiles.map((f) => ({
    path: f.path,
    cache: opts.app.metadataCache.getFileCache(f),
  }));
  const discovered = discoverPersonHubs(caches);
  const hubs = new Map<string, HubForProjection>();

  const detailByLow = new Map(
    (opts.personHubDetails ?? []).map((d) => [
      d.canonicalTitle.trim().toLowerCase(),
      d,
    ]),
  );

  for (const h of discovered) {
    const low = h.canonicalTitle.trim().toLowerCase();
    const file = opts.app.vault.getAbstractFileByPath(h.path);
    if (!(file instanceof TFile)) continue;
    try {
      const content = await opts.app.vault.read(file);
      const detail = detailByLow.get(low);
      const fromDetail = detail?.sections ?? [];
      hubs.set(low, {
        title: h.canonicalTitle,
        path: h.path,
        content,
        sections: fromDetail.length ? fromDetail : parseHubSections(content),
        kind: "person",
      });
    } catch {
      /* skip */
    }
  }

  const touchLow = new Set(touched.map((t) => t.toLowerCase()));
  const needSet = new Set([...touchLow].filter((t) => !hubs.has(t)));
  if (needSet.size) {
    const fileContents: { path: string; content: string }[] = [];
    for (const f of mdFiles) {
      const low = titleFromAtomPath(f.path).toLowerCase();
      if (!needSet.has(low)) continue;
      try {
        fileContents.push({
          path: f.path,
          content: await opts.app.vault.read(f),
        });
      } catch {
        /* skip */
      }
    }
    const listHubs = resolveListHubsFromVault({
      files: fileContents,
      titlesLower: needSet,
    });
    for (const [k, v] of listHubs) {
      if (!hubs.has(k)) hubs.set(k, v);
    }
  }

  const plan = planHubProjection({
    enabled: true,
    touchedHubTitles: touched,
    atoms,
    hubs,
  });

  const applied = await applyHubProjectionPlan(opts.app, plan);
  const filled = plan.writes.filter((w) => w.changed).length;
  return {
    wrote: applied.wrote,
    filled,
    skipped: plan.skipped.length,
    errors: applied.errors,
  };
}

/** Collect hub titles hard-linked from atom contents ∩ allowed hub titles. */
export function hubTitlesFromAtomContents(
  contents: string[],
  hubTitles: string[],
): string[] {
  const hubLow = new Set(
    hubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const out = new Set<string>();
  const canon = new Map(
    hubTitles.map((t) => [t.trim().toLowerCase(), t.trim()]),
  );
  for (const c of contents) {
    for (const k of membershipKeysForAtom(c)) {
      const low = k.trim().toLowerCase();
      if (hubLow.has(low)) {
        out.add(canon.get(low) ?? k.trim());
      }
    }
  }
  return [...out];
}

function h2FromCache(
  cache: { headings?: { heading: string; level: number }[] } | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of cache?.headings ?? []) {
    if (h.level !== 2) continue;
    const t = (h.heading ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Titles of list-shaped vault notes (basename) via metadata cache — no body read.
 * Named list hubs (Show list / Movie list / Watch list) qualify with no H2.
 */
export function collectListHubTitles(app: App): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of app.vault.getMarkdownFiles()) {
    if (pathInSafetyDenylist(f.path)) continue;
    const sections = h2FromCache(app.metadataCache.getFileCache(f));
    if (!isListHubCandidate({ path: f.path, sections })) continue;
    const title = titleFromAtomPath(f.path);
    const low = title.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(title);
  }
  return out;
}

export function noticeHubProjectionErrors(
  errors: HubProjectionError[],
  limit = 3,
): void {
  for (const err of errors.slice(0, limit)) {
    new Notice(
      `Atoms: hub projection skipped [[${err.hubTitle}]]: ${err.reason}`,
      8000,
    );
  }
}

/**
 * Shared Process/Update/backfill tail: allowlist person+list titles → project.
 */
export async function projectHubsFromAtomContents(opts: {
  app: App;
  enabled: boolean;
  atomFolder: string;
  atomContents: string[];
  personHubTitles: string[];
  personHubDetails?: PersonHubDetail[];
}): Promise<void> {
  if (!opts.enabled || !opts.atomContents.length) return;
  const listTitles = collectListHubTitles(opts.app);
  const allowTitles = [...opts.personHubTitles, ...listTitles];
  const touched = hubTitlesFromAtomContents(opts.atomContents, allowTitles);
  if (!touched.length) return;
  const proj = await runHubProjectionForHubs({
    app: opts.app,
    enabled: true,
    atomFolder: opts.atomFolder,
    touchedHubTitles: touched,
    personHubDetails: opts.personHubDetails,
  });
  noticeHubProjectionErrors(proj.errors);
}
