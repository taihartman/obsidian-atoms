import { FuzzySuggestModal, Notice, TFile, type App } from "obsidian";
import {
  applyOpenLoopFm,
  collectRedeemedParentKeys,
  isOpenNowContent,
  isProposalCandidate,
  openLoopMeta,
} from "./openLoops";
import { clampAtomFolder, listAtomPaths } from "../pipeline/render";
import type { OpenLoopFm } from "../shared/openLoop";

type Row = {
  path: string;
  title: string;
  content: string;
  label: string;
};

async function loadAtomRows(app: App, atomFolder: string): Promise<Row[]> {
  const folder = clampAtomFolder(atomFolder);
  const paths = [...listAtomPaths(app, folder)];
  const files = paths
    .map((path) => app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile);

  const contents = await Promise.all(
    files.map(async (file) => {
      const content =
        typeof app.vault.cachedRead === "function"
          ? await app.vault.cachedRead(file)
          : await app.vault.read(file);
      return { file, content };
    }),
  );

  return contents.map(({ file, content }) => {
    const title = file.basename.replace(/\.md$/i, "");
    const meta = openLoopMeta(content);
    const src = meta?.source === "user" ? "you" : meta ? "inferred" : "";
    const label = src ? `${title} · ${src}` : title;
    return { path: file.path, title, content, label };
  });
}

class OpenLoopsBrowseModal extends FuzzySuggestModal<Row> {
  constructor(
    app: App,
    private rows: Row[],
  ) {
    super(app);
    this.setPlaceholder("Notes left for later");
  }

  getItems(): Row[] {
    return this.rows;
  }

  getItemText(item: Row): string {
    return item.label;
  }

  onChooseItem(item: Row): void {
    const f = this.app.vault.getAbstractFileByPath(item.path);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  }
}

class OpenLoopsReviewModal extends FuzzySuggestModal<Row> {
  constructor(
    app: App,
    private rows: Row[],
    private onPick: (row: Row, accept: boolean) => Promise<void>,
  ) {
    super(app);
    this.setPlaceholder("Review proposals — Enter accept · Shift+Enter skip");
  }

  getItems(): Row[] {
    return this.rows;
  }

  getItemText(item: Row): string {
    return item.title;
  }

  onChooseItem(item: Row, evt: MouseEvent | KeyboardEvent): void {
    const skip =
      (evt instanceof KeyboardEvent && evt.shiftKey) ||
      (evt instanceof MouseEvent && evt.shiftKey);
    void this.onPick(item, !skip);
  }
}

export async function runOpenLoopsCommand(
  app: App,
  atomFolder: string,
  mode: "browse" | "review",
): Promise<void> {
  const all = await loadAtomRows(app, atomFolder);
  if (mode === "browse") {
    const redeemed = collectRedeemedParentKeys(all);
    const open = all.filter((r) =>
      isOpenNowContent(r.content, redeemed.has(r.title.toLowerCase())),
    );
    if (!open.length) {
      new Notice("No open loops right now.");
      return;
    }
    new OpenLoopsBrowseModal(app, open).open();
    return;
  }

  const proposals = all.filter((r) =>
    isProposalCandidate(r.content, r.title),
  );
  if (!proposals.length) {
    new Notice("No open-loop proposals.");
    return;
  }

  const write = async (row: Row, accept: boolean) => {
    const next: OpenLoopFm = accept
      ? { state: "active", source: "user" }
      : { state: "not_a_loop", source: "user" };
    const content = applyOpenLoopFm(row.content, next);
    const f = app.vault.getAbstractFileByPath(row.path);
    if (!(f instanceof TFile)) return;
    await app.vault.modify(f, content);
    new Notice(
      accept ? `Marked open loop: ${row.title}` : `Not a loop: ${row.title}`,
    );
  };

  new OpenLoopsReviewModal(app, proposals, write).open();
}
