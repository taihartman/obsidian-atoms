import { FuzzySuggestModal, Notice, TFile, type App } from "obsidian";
import {
  applyOpenLoopFm,
  isOpenNowContent,
  isProposalCandidate,
  openLoopMeta,
} from "./openLoops";
import { clampAtomFolder, listAtomPaths } from "../pipeline/render";
import type { OpenLoopFm } from "../shared/openLoop";

type Row = { path: string; title: string; content: string };

async function loadAtomRows(app: App, atomFolder: string): Promise<Row[]> {
  const folder = clampAtomFolder(atomFolder);
  const paths = [...listAtomPaths(app, folder)];
  const rows: Row[] = [];
  for (const path of paths) {
    const af = app.vault.getAbstractFileByPath(path);
    if (!(af instanceof TFile)) continue;
    const content = await app.vault.read(af);
    rows.push({
      path,
      title: af.basename.replace(/\.md$/i, ""),
      content,
    });
  }
  return rows;
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
    const meta = openLoopMeta(item.content);
    const src = meta?.source === "user" ? "you" : "inferred";
    return `${item.title} · ${src}`;
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
      evt instanceof KeyboardEvent && evt.shiftKey
        ? true
        : evt instanceof MouseEvent && evt.shiftKey;
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
    const open = all.filter((r) => isOpenNowContent(r.content));
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
    new Notice(accept ? `Marked open loop: ${row.title}` : `Not a loop: ${row.title}`);
  };

  new OpenLoopsReviewModal(app, proposals, write).open();
}
