/**
 * Shared doubles for the daily-note pipeline tests (write path + preview path).
 *
 * Deliberately writable: files created during a run become real files, so collision policy,
 * marker appends and "preview wrote nothing" are all observable rather than assumed.
 */
import { vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import * as dni from "obsidian-daily-notes-interface";
import type { ClassificationResult } from "../../src/shared/types";
import { MetadataContextProvider } from "../../src/pipeline/context";

export function mdFile(path: string): TFile {
  // `TFile`'s constructor takes no arguments in `obsidian.d.ts`; the path is assigned rather
  // than passed so this helper typechecks against the real API, not only against the mock.
  const f = new TFile();
  f.path = path;
  f.basename = (path.split("/").pop() ?? path).replace(/\.md$/, "");
  (f as TFile & { extension: string }).extension = "md";
  return f;
}

export interface VaultDouble {
  app: App;
  read: (path: string) => string | undefined;
  paths: () => string[];
  writes: () => number;
}

export function fakeVault(seed: Record<string, string>): VaultDouble {
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();
  const folders = new Set<string>();
  let writes = 0;
  for (const [path, content] of Object.entries(seed)) {
    files.set(path, mdFile(path));
    contents.set(path, content);
  }

  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) =>
        files.get(path) ?? (folders.has(path) ? { path } : null),
      cachedRead: async (f: { path: string }) => contents.get(f.path) ?? "",
      read: async (f: { path: string }) => contents.get(f.path) ?? "",
      create: async (path: string, content: string) => {
        writes += 1;
        files.set(path, mdFile(path));
        contents.set(path, content);
      },
      createFolder: async (path: string) => {
        writes += 1;
        folders.add(path);
      },
      modify: async (f: { path: string }, content: string) => {
        writes += 1;
        contents.set(f.path, content);
      },
    },
    metadataCache: {
      getFileCache: () => null,
    },
  };

  return {
    app: app as unknown as App,
    read: (path: string) => contents.get(path),
    paths: () => [...files.keys()],
    writes: () => writes,
  };
}

/** Point the daily-notes interface at the seeded daily files. */
export function stubDailyNotes(
  dailies: Array<{ path: string; date: string }>,
): void {
  vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(true);
  const byPath = new Map(dailies.map((d) => [d.path, d.date]));
  vi.spyOn(dni, "getAllDailyNotes").mockReturnValue(
    Object.fromEntries(dailies.map((d) => [d.date, mdFile(d.path)])) as never,
  );
  vi.spyOn(dni, "getDateFromFile").mockImplementation(
    ((file: { path: string }) => {
      const date = byPath.get(file.path);
      return date ? { format: () => date } : null;
    }) as never,
  );
}

export const atomResult = (
  title: string,
  links: ClassificationResult["links"] = [],
): ClassificationResult => ({
  verdict: "atom",
  title,
  tags: ["idea"],
  proposed_tags: [],
  links,
});

/**
 * Classify double. Records the rendered context blocks of every request and replies with the
 * queued result, so what the model actually *saw* is assertable.
 */
export function fakeClassify(results: ClassificationResult[]) {
  /** messages[0] flattened — block A + block B, as the model reads it. */
  const contextBlocks: string[] = [];
  /** messages[0].content, block by block — for cache-breakpoint assertions. */
  const contextParts: Array<Array<{ text?: string; cache_control?: unknown }>> =
    [];
  const captures: string[] = [];
  let i = 0;
  const request = async (opts: { body?: string }) => {
    const body = JSON.parse(opts.body ?? "{}") as {
      messages: Array<{
        content: Array<{ text?: string; cache_control?: unknown }>;
      }>;
    };
    const parts = body.messages[0]?.content ?? [];
    contextParts.push(parts);
    contextBlocks.push(parts.map((c) => c.text ?? "").join(""));
    captures.push(body.messages[1]?.content?.[0]?.text ?? "");
    const result = results[Math.min(i, results.length - 1)]!;
    i += 1;
    return {
      status: 200,
      json: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        usage: {},
      },
    };
  };
  return { request, contextBlocks, contextParts, captures };
}

export const contextProviderFor = (app: App) =>
  new MetadataContextProvider(app, () => ["idea"]);
