/**
 * Open Obsidian Global Graph filtered to the atom closed neighborhood.
 */

import { Notice, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { isUnderAtomFolder } from "../home/atomsHomeData";
import {
  atomFolderGraphQuery,
  buildClosedNeighborhood,
  collectAtomSeedPaths,
  parseSourceNoteName,
  toGraphSearchQuery,
  type GraphQueryResult,
} from "./atomGraphSet";

type GraphEngineLoose = {
  filterOptions?: {
    search?: {
      setValue?: (v: string) => void;
      inputEl?: HTMLInputElement;
      value?: string;
    };
    searchChange?: (v: string) => void;
  };
  updateSearch?: () => void;
  setFilter?: (v: string) => void;
};

type GraphViewLoose = {
  dataEngine?: GraphEngineLoose;
  engine?: GraphEngineLoose;
  renderer?: { setData?: (...args: unknown[]) => void };
  update?: () => void;
  onResize?: () => void;
};

function isTFile(f: unknown): f is TFile {
  return f instanceof TFile;
}

function outboundPaths(app: App, path: string): string[] {
  const map = app.metadataCache.resolvedLinks[path];
  return map ? Object.keys(map) : [];
}

function inboundPaths(app: App, path: string): string[] {
  const out: string[] = [];
  const resolved = app.metadataCache.resolvedLinks;
  for (const [src, targets] of Object.entries(resolved)) {
    if (targets && targets[path] != null) out.push(src);
  }
  return out;
}

/** Body wikilinks only (not frontmatter), resolved to vault paths. */
function bodyOutboundPaths(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache?.links?.length) return [];
  const out: string[] = [];
  for (const l of cache.links) {
    const dest = app.metadataCache.getFirstLinkpathDest(l.link, file.path);
    if (dest) out.push(dest.path);
  }
  return out;
}

function sourceTargetPath(app: App, file: TFile, content: string): string | null {
  const name = parseSourceNoteName(content);
  if (!name) return null;
  const dest = app.metadataCache.getFirstLinkpathDest(name, file.path);
  return dest?.path ?? null;
}

/**
 * Best-effort set of the Graph view search filter.
 * Public API does not expose this; try common internal shapes.
 */
export function applyGraphSearchFilter(
  view: unknown,
  query: string,
): boolean {
  if (!view || typeof view !== "object") return false;
  const v = view as GraphViewLoose;
  try {
    const engines = [v.dataEngine, v.engine].filter(Boolean);
    for (const eng of engines) {
      if (!eng) continue;
      if (typeof eng.setFilter === "function") {
        eng.setFilter(query);
        eng.updateSearch?.();
        return true;
      }
      const search = eng.filterOptions?.search;
      if (search) {
        if (typeof search.setValue === "function") {
          search.setValue(query);
        } else if (search.inputEl) {
          search.inputEl.value = query;
          search.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        } else if ("value" in search) {
          (search as { value: string }).value = query;
        } else {
          continue;
        }
        eng.filterOptions?.searchChange?.(query);
        eng.updateSearch?.();
        v.update?.();
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function openGraphLeaf(app: App): Promise<WorkspaceLeaf | null> {
  const existing = app.workspace.getLeavesOfType("graph");
  if (existing[0]) {
    await app.workspace.revealLeaf(existing[0]);
    return existing[0];
  }
  try {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "graph", active: true });
    await app.workspace.revealLeaf(leaf);
    return leaf;
  } catch {
    try {
      const cmds = (
        app as App & {
          commands?: { executeCommandById?: (id: string) => boolean };
        }
      ).commands;
      const ok = cmds?.executeCommandById?.("graph:open");
      if (ok === false) return null;
      await new Promise((r) => setTimeout(r, 50));
      return app.workspace.getLeavesOfType("graph")[0] ?? null;
    } catch {
      return null;
    }
  }
}

function noticeForQuery(
  result: GraphQueryResult,
  applied: boolean,
  folderFallback: boolean,
): void {
  if (folderFallback) {
    new Notice(
      "Opened atom folder graph. Could not apply the full connection filter.",
      6000,
    );
    return;
  }
  if (!applied) {
    new Notice(
      "Opened Graph. Filter could not be set automatically — use the graph search box.",
      6000,
    );
    return;
  }
  if (result.mode === "capped" && result.omittedExternal > 0) {
    new Notice(
      `Atom graph open. ${result.omittedExternal} linked note${result.omittedExternal === 1 ? "" : "s"} omitted (graph search limit).`,
      5000,
    );
  }
}

/**
 * Build closed neighborhood from vault, open Global Graph, apply filter.
 */
export async function runOpenAtomGraph(
  app: App,
  atomFolder: string,
): Promise<void> {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  const mdFiles = app.vault.getMarkdownFiles();

  const fileInputs: { path: string; content: string }[] = [];
  const contentByPath = new Map<string, string>();
  for (const f of mdFiles) {
    if (!isUnderAtomFolder(f.path, folder)) continue;
    try {
      const content = await app.vault.cachedRead(f);
      fileInputs.push({ path: f.path, content });
      contentByPath.set(f.path, content);
    } catch {
      /* skip unreadable */
    }
  }

  const seedPaths = collectAtomSeedPaths(fileInputs, folder);
  if (seedPaths.length === 0) {
    new Notice("No atoms yet — file some captures first.");
    return;
  }

  const outboundBySeed: Record<string, string[]> = {};
  const bodyOutboundBySeed: Record<string, string[]> = {};
  const sourceTargetBySeed: Record<string, string | null> = {};
  const inboundBySeed: Record<string, string[]> = {};

  for (const path of seedPaths) {
    outboundBySeed[path] = outboundPaths(app, path);
    inboundBySeed[path] = inboundPaths(app, path);
    const file = app.vault.getAbstractFileByPath(path);
    if (isTFile(file)) {
      bodyOutboundBySeed[path] = bodyOutboundPaths(app, file);
      const content = contentByPath.get(path) ?? "";
      sourceTargetBySeed[path] = sourceTargetPath(app, file, content);
    } else {
      bodyOutboundBySeed[path] = [];
      sourceTargetBySeed[path] = null;
    }
  }

  const neighborhood = buildClosedNeighborhood({
    seedPaths,
    outboundBySeed,
    bodyOutboundBySeed,
    sourceTargetBySeed,
    inboundBySeed,
  });

  const queryResult = toGraphSearchQuery(neighborhood, folder);
  const leaf = await openGraphLeaf(app);
  if (!leaf) {
    new Notice("Graph view unavailable on this device.");
    return;
  }

  // Allow view to mount
  await new Promise((r) => setTimeout(r, 30));

  let applied = applyGraphSearchFilter(leaf.view, queryResult.query);
  let folderFallback = false;

  if (!applied) {
    const folderQ = atomFolderGraphQuery(folder);
    applied = applyGraphSearchFilter(leaf.view, folderQ);
    folderFallback = applied;
    if (!applied) {
      // Graph open but no filter API — still better than whole vault claim
      noticeForQuery(queryResult, false, false);
      return;
    }
  }

  noticeForQuery(queryResult, true, folderFallback);
}
