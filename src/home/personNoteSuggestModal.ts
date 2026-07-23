import { App, FuzzySuggestModal, TFile } from "obsidian";
import { isSoftEntityKey } from "../pipeline/softKeys";

/**
 * Pick an existing vault note to treat as the person note for invite "Already have them".
 * Prefer Social/People paths; exclude soft index titles and the atom folder.
 */
export class PersonNoteSuggestModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];

  constructor(
    app: App,
    private readonly atomFolder: string,
    private readonly onPick: (file: TFile) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder("Choose the person note you already have…");
    const folder = atomFolder.replace(/\/$/, "") || "Atoms";
    this.files = app.vault.getMarkdownFiles().filter((f) => {
      const base = f.basename.trim().toLowerCase();
      if (!base || isSoftEntityKey(base)) return false;
      if (PERSON_INDEX_TITLES.has(base)) return false;
      const p = f.path.replace(/\\/g, "/");
      if (p === folder || p.startsWith(folder + "/")) return false;
      // skip daily-like basenames
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.basename)) return false;
      return true;
    });
    this.files.sort((a, b) => {
      const sa = peoplePathScore(a.path);
      const sb = peoplePathScore(b.path);
      if (sa !== sb) return sb - sa;
      return a.path.localeCompare(b.path);
    });
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    void this.onPick(item);
  }
}

const PERSON_INDEX_TITLES = new Set([
  "people",
  "social",
  "index",
  "home",
  "tags",
  "archive",
  "templates",
]);

function peoplePathScore(path: string): number {
  const p = `/${path.replace(/\\/g, "/")}`;
  if (p.includes("/Social/")) return 30;
  if (p.includes("/People/")) return 25;
  if (p.includes("/Personal notes/")) return 10;
  return 0;
}
