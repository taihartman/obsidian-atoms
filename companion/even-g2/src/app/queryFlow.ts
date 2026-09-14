export type QuerySource = { id: string; title: string };
export type QueryView =
  | { state: "answered"; answer: string; sources: QuerySource[] }
  | { state: "closest_matches"; matches: QuerySource[] }
  | { state: "setup_required" | "limit_reached" | "unavailable" };

export type QueryApi = { query(question: string): Promise<QueryView> };

export class QueryFlow {
  private view: QueryView | null = null;

  constructor(private readonly api: QueryApi) {}

  async ask(question: string): Promise<QueryView> {
    this.view = await this.api.query(question);
    return this.view;
  }

  openSource(index: number): string | null {
    if (this.view?.state !== "answered") return null;
    return this.view.sources[index]?.id ?? null;
  }
}
