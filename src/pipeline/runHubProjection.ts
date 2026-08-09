import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { PersonHubDetail } from "../shared/types";
import { membershipKeysForAtom } from "./entityOrbitIndex";
import {
  projectHubMarkdown,
  type HubProjectionEntry,
} from "./hubProjection";
import {
  GENERATED_CLOSE,
  GENERATED_OPEN,
  parseHubSections,
} from "./hubSections";
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
  const sectionSet = new Set(sections);
  return raw.map((e) => {
    const sec = (e.section ?? "").trim();
    if (sec && sectionSet.has(sec)) return e;
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
      const hasMatching = entries.some(
        (e) => (e.section ?? "").trim() && sections.includes(e.section!.trim()),
      );
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
    });
  }

  return { writes, errors, skipped };
}

function basenameTitle(path: string): string {
  return titleFromAtomPath(path);
}

/**
 * Resolve list hub files for titles (basename match, unique path preferred).
 */
export function resolveListHubsFromVault(opts: {
  files: { path: string; content: string }[];
  titlesLower: Set<string>;
}): Map<string, HubForProjection> {
  const byTitle = new Map<string, { path: string; content: string }[]>();
  for (const f of opts.files) {
    if (pathInSafetyDenylist(f.path)) continue;
    const title = basenameTitle(f.path);
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
    byTitle.get(low)!.push(f);
  }

  const out = new Map<string, HubForProjection>();
  for (const [low, paths] of byTitle) {
    if (paths.length !== 1) continue;
    const f = paths[0]!;
    const title = basenameTitle(f.path);
    out.set(low, {
      title,
      path: f.path,
      content: f.content,
      sections: parseHubSections(f.content),
      kind: "list",
    });
  }
  return out;
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

  const folder = opts.atomFolder.replace(/\/$/, "") || "Atoms";
  const atomFiles = opts.app.vault
    .getMarkdownFiles()
    .filter((f) => f.path === folder || f.path.startsWith(folder + "/"));

  const atoms: AtomForProjection[] = [];
  for (const f of atomFiles) {
    try {
      const content = await opts.app.vault.read(f);
      atoms.push({ title: titleFromAtomPath(f.path), content });
    } catch {
      /* skip */
    }
  }

  const mdFiles = opts.app.vault.getMarkdownFiles();
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
      hubs.set(low, {
        title: h.canonicalTitle,
        path: h.path,
        content,
        sections: detail?.sections ?? parseHubSections(content),
        kind: "person",
      });
    } catch {
      /* skip */
    }
  }

  let touched = opts.touchedHubTitles.map((t) => t.trim()).filter(Boolean);

  if (opts.fullRegen || !touched.length) {
    const allowed = new Set(
      [...hubs.keys()].concat(
        mdFiles
          .filter((f) => !pathInSafetyDenylist(f.path))
          .map((f) => basenameTitle(f.path).toLowerCase()),
      ),
    );
    const memberTitles = new Set<string>();
    for (const a of atoms) {
      for (const k of membershipKeysForAtom(a.content)) {
        const low = k.trim().toLowerCase();
        if (allowed.has(low) || hubs.has(low)) memberTitles.add(k.trim());
      }
    }
    if (opts.fullRegen) {
      touched = [...memberTitles];
    } else if (!touched.length) {
      return { wrote: 0, filled: 0, skipped: 0, errors: [] };
    }
  }

  const touchLow = new Set(touched.map((t) => t.toLowerCase()));
  const needList = [...touchLow].filter((t) => !hubs.has(t));
  if (needList.length) {
    const fileContents: { path: string; content: string }[] = [];
    for (const f of mdFiles) {
      if (pathInSafetyDenylist(f.path)) continue;
      const low = basenameTitle(f.path).toLowerCase();
      if (!needList.includes(low) && !touchLow.has(low)) continue;
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
      titlesLower: new Set(needList),
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

  let wrote = 0;
  for (const w of plan.writes) {
    if (!w.changed) continue;
    const file = opts.app.vault.getAbstractFileByPath(w.path);
    if (!(file instanceof TFile)) continue;
    try {
      await opts.app.vault.modify(file, w.next);
      wrote += 1;
    } catch {
      plan.errors.push({
        hubTitle: w.hubTitle,
        path: w.path,
        reason: "vault-modify-failed",
      });
    }
  }

  const filled = plan.writes.filter((w) => w.changed).length;
  const skipped = plan.skipped.length;

  return { wrote, filled, skipped, errors: plan.errors };
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

/** Titles of list-shaped vault notes (basename) for touch/context allowlists. */
export async function collectListHubTitles(app: App): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of app.vault.getMarkdownFiles()) {
    if (pathInSafetyDenylist(f.path)) continue;
    try {
      const content = await app.vault.read(f);
      const sections = parseHubSections(content);
      if (!isListHubCandidate({ path: f.path, sections, content })) continue;
      const title = basenameTitle(f.path);
      const low = title.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      out.push(title);
    } catch {
      /* skip */
    }
  }
  return out;
}

export { GENERATED_OPEN, GENERATED_CLOSE };
