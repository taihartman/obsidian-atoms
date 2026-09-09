export type ReadItem = { id: string; title: string };
export type ReadPage = { text: string; position: { offset: number; next_offset: number | null } };
export type RecentResponse = { items: ReadItem[]; next_offset: number | null; coverage_complete: boolean };
export type ReadApi = {
  recent(offset?: number): Promise<RecentResponse>;
  fetch(id: string, offset: number): Promise<ReadPage>;
};

export class ReadFlow {
  private items: ReadItem[] = [];
  private selectedIndex = 0;
  private coverageComplete = true;
  private page: ReadPage | null = null;

  constructor(private readonly api: ReadApi) {}

  async loadRecent(offset = 0) {
    const response = await this.api.recent(offset);
    this.items = response.items;
    this.coverageComplete = response.coverage_complete;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.items.length - 1));
    return this.backToList();
  }

  select(index: number): void {
    if (Number.isInteger(index) && index >= 0 && index < this.items.length) this.selectedIndex = index;
  }

  async openSelected(): Promise<ReadPage> {
    const selected = this.items[this.selectedIndex];
    if (!selected) throw new Error("no_selection");
    this.page = await this.api.fetch(selected.id, 0);
    return this.page;
  }

  async nextPage(): Promise<ReadPage> {
    const selected = this.items[this.selectedIndex];
    if (!selected || !this.page || this.page.position.next_offset == null) throw new Error("no_next_page");
    this.page = await this.api.fetch(selected.id, this.page.position.next_offset);
    return this.page;
  }

  backToList() {
    this.page = null;
    return { items: [...this.items], selectedIndex: this.selectedIndex, coverageComplete: this.coverageComplete };
  }
}
