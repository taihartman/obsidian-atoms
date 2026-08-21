import {
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  TFile,
  type App,
} from "obsidian";
import {
  applyOpenLoopFm,
  collectRedeemedParentKeys,
  isDismissCandidate,
  isOpenNowContent,
  isProposalCandidate,
  openLoopMeta,
} from "../pipeline/openLoopState";
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

async function writeLoop(
  app: App,
  row: Row,
  next: OpenLoopFm,
  notice: string,
): Promise<void> {
  const content = applyOpenLoopFm(row.content, next);
  if (content === row.content) {
    new Notice("Could not update frontmatter.");
    return;
  }
  const f = app.vault.getAbstractFileByPath(row.path);
  if (!(f instanceof TFile)) return;
  await app.vault.modify(f, content);
  new Notice(notice);
}

class OpenLoopsBrowseModal extends FuzzySuggestModal<Row> {
  constructor(
    app: App,
    private rows: Row[],
  ) {
    super(app);
    this.setPlaceholder("Notes left for later · Enter open · Shift+Enter dismiss inferred");
  }

  getItems(): Row[] {
    return this.rows;
  }

  getItemText(item: Row): string {
    return item.label;
  }

  onChooseItem(item: Row, evt: MouseEvent | KeyboardEvent): void {
    const dismiss =
      (evt instanceof KeyboardEvent && evt.shiftKey) ||
      (evt instanceof MouseEvent && evt.shiftKey);
    if (dismiss && isDismissCandidate(item.content)) {
      void writeLoop(
        this.app,
        item,
        { state: "not_a_loop", source: "user" },
        `Not a loop: ${item.title}`,
      );
      return;
    }
    const f = this.app.vault.getAbstractFileByPath(item.path);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  }
}

/** Explicit Accept / Skip — no modifier+Enter reliance. */
class OpenLoopsReviewModal extends Modal {
  private queue = 0;

  constructor(
    app: App,
    private rows: Row[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Review open-loop proposals" });
    if (this.queue >= this.rows.length) {
      contentEl.createEl("p", { text: "Done. Nothing left in this pass." });
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("Close").onClick(() => this.close()),
      );
      return;
    }
    const row = this.rows[this.queue]!;
    contentEl.createEl("p", {
      text: row.title,
      cls: "mod-bold",
    });
    const snippet = row.content
      .replace(/^---[\s\S]*?\n---\s*/, "")
      .trim()
      .slice(0, 280);
    contentEl.createEl("p", { text: snippet || "(empty body)" });
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Accept as open loop").setCta().onClick(() => {
          void writeLoop(
            this.app,
            row,
            { state: "active", source: "user" },
            `Marked open loop: ${row.title}`,
          ).then(() => {
            this.queue += 1;
            this.render();
          });
        }),
      )
      .addButton((b) =>
        b.setButtonText("Not a loop").onClick(() => {
          void writeLoop(
            this.app,
            row,
            { state: "not_a_loop", source: "user" },
            `Not a loop: ${row.title}`,
          ).then(() => {
            this.queue += 1;
            this.render();
          });
        }),
      )
      .addButton((b) =>
        b.setButtonText("Skip").onClick(() => {
          this.queue += 1;
          this.render();
        }),
      );
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
  new OpenLoopsReviewModal(app, proposals).open();
}
