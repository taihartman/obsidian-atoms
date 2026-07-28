import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { PersonHubDetail } from "../shared/types";
import { membershipKeysForAtom } from "./entityOrbitIndex";
import {
  projectHubMarkdown,
  type HubProjectionEntry,
} from "./hubProjection";
import { parseHubSections } from "./hubSections";
import { discoverPersonHubs } from "./enrich/people";

export type HubProjectionPlanItem = {
  hubTitle: string;
  path: string;
  previous: string;
  next: string;
  changed: boolean;
};

export type HubProjectionError = {
  hubTitle: string;
  path?: string;
  reason: string;
};

export type HubProjectionPlan = {
  writes: HubProjectionPlanItem[];
  errors: HubProjectionError[];
};

export type AtomForProjection = {
  title: string;
  content: string;
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

/**
 * Pure plan: which hub files would change given atoms + hub contents.
 */
export function planHubProjection(opts: {
  enabled: boolean;
  touchedHubTitles: string[];
  atoms: AtomForProjection[];
  hubs: Map<
    string,
    { title: string; path: string; content: string; sections?: string[] }
  >;
}): HubProjectionPlan {
  const writes: HubProjectionPlanItem[] = [];
  const errors: HubProjectionError[] = [];
  if (!opts.enabled) return { writes, errors };

  const touch = new Set(
    opts.touchedHubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  if (!touch.size) return { writes, errors };

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

  for (const [low, entries] of byHub) {
    const hub = opts.hubs.get(low);
    if (!hub) {
      errors.push({ hubTitle: low, reason: "hub-file-missing" });
      continue;
    }
    const sections = hub.sections ?? parseHubSections(hub.content);
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

  return { writes, errors };
}

/**
 * Live vault: regenerate managed blocks for touched person hubs.
 */
export async function runHubProjectionForHubs(opts: {
  app: App;
  enabled: boolean;
  atomFolder: string;
  touchedHubTitles: string[];
  personHubDetails?: PersonHubDetail[];
}): Promise<{ wrote: number; errors: HubProjectionError[] }> {
  if (!opts.enabled || !opts.touchedHubTitles.length) {
    return { wrote: 0, errors: [] };
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

  const caches = opts.app.vault.getMarkdownFiles().map((f) => ({
    path: f.path,
    cache: opts.app.metadataCache.getFileCache(f),
  }));
  const discovered = discoverPersonHubs(caches);
  const hubs = new Map<
    string,
    { title: string; path: string; content: string; sections?: string[] }
  >();

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
      });
    } catch {
      /* skip */
    }
  }

  const plan = planHubProjection({
    enabled: true,
    touchedHubTitles: opts.touchedHubTitles,
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

  return { wrote, errors: plan.errors };
}

/** Collect person hub titles hard-linked from atom contents. */
export function hubTitlesFromAtomContents(
  contents: string[],
  personHubTitles: string[],
): string[] {
  const hubLow = new Set(
    personHubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const out = new Set<string>();
  const canon = new Map(
    personHubTitles.map((t) => [t.trim().toLowerCase(), t.trim()]),
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
