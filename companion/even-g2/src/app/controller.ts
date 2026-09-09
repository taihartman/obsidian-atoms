import type { EvenAction } from "../platform/even";
import { paginateUtf8Text } from "../ui/paginate";
import type { AppState, Source } from "./state";
import { initialState, reduceAppState } from "./state";

type CreatePort = {
  restore(): Promise<{ state: string; title?: string; message?: string; receipt?: { title: string }; acceptedAt?: string; stillQueued?: boolean }>;
  confirm(): Promise<{ state: string; title?: string; message?: string; receipt?: { title: string }; acceptedAt?: string; stillQueued?: boolean }>;
  prepare?(recordingId: string, capturedAt: string): Promise<{ state: string; title?: string; message?: string }>;
  cancel?(): Promise<unknown>;
  refresh?(): Promise<{ state: string; message?: string; receipt?: { title: string }; acceptedAt?: string; stillQueued?: boolean }>;
};
type QueryPort = { ask(question: string): Promise<{ state: string; answer?: string; sources?: Source[]; matches?: Source[] }>; openSource(index: number): string | null };
type ReadPort = {
  loadRecent(): Promise<{ items: Source[]; selectedIndex: number; coverageComplete: boolean }>;
  openById(id: string): Promise<{ text: string; position: { offset: number; next_offset: number | null } }>;
  nextPage?(): Promise<{ text: string; position: { offset: number; next_offset: number | null } }>;
};

type Dependencies = {
  render(state: AppState): void | Promise<void>;
  stopAudio(): void | Promise<void>;
  closeSockets(): void;
  unsubscribe(): void;
  requestSystemExit?(): void | Promise<void>;
  startRecording?(purpose: "create" | "query"): void | Promise<void>;
  stopRecording?(): Promise<{ purpose: "create" | "query"; recordingId: string; capturedAt: string; transcript: string }>;
  create: CreatePort;
  query: QueryPort;
  read: ReadPort;
};

function requestFailure(error: unknown): Extract<AppState, { screen: "error" }> {
  const message = error instanceof Error ? error.message : "";
  if (message === "setup_required") return { screen: "error", reason: "revoked", primaryAction: "reconnect", selectedIndex: 0 };
  if (message === "microphone_denied") return { screen: "error", reason: "microphone-denied", primaryAction: "retry", selectedIndex: 0 };
  if (message === "limit_reached") return { screen: "error", reason: "limit-reached", primaryAction: "return", selectedIndex: 0 };
  return { screen: "error", reason: "offline", primaryAction: "retry", selectedIndex: 0 };
}

export class G2AppController {
  private state: AppState = initialState();
  private systemExitRequested = false;
  private returnState: AppState | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  snapshot(): AppState { return structuredClone(this.state); }
  requestedSystemExit(): boolean { return this.systemExitRequested; }

  private show(state: AppState): void {
    this.state = state;
    void this.dependencies.render(state);
  }

  async start(status: { paired: boolean; setupReady: boolean; recoveredRecording?: boolean }): Promise<void> {
    if (!status.paired) { this.show({ screen: "unpaired", selectedIndex: 0 }); return; }
    if (!status.setupReady) { this.show({ screen: "setup-required", selectedIndex: 0 }); return; }
    const recovered = await this.dependencies.create.restore();
    if (recovered.state === "prepared") {
      this.show({ screen: "confirmation", title: recovered.title ?? "", message: recovered.message, selectedIndex: 0 });
    } else if (recovered.state === "queued") {
      this.show({ screen: "queued", selectedIndex: 0, acceptedAt: recovered.acceptedAt, stillQueued: recovered.stillQueued });
    } else if (recovered.state === "saved") {
      this.show({ screen: "saved", title: recovered.receipt?.title, selectedIndex: 0 });
    } else if (status.recoveredRecording) {
      this.show({ screen: "recovery", kind: "staged", selectedIndex: 0 });
    } else this.show({ screen: "root", selectedIndex: 0 });
  }

  showRoot(): void { this.show({ screen: "root", selectedIndex: 0 }); }

  async handle(action: EvenAction): Promise<void> {
    if (this.state.screen === "root" && action.kind === "double-click") {
      this.systemExitRequested = true;
      await this.dependencies.requestSystemExit?.();
      return;
    }
    if (action.kind === "scroll-up" && action.envelope !== "list") {
      if (this.state.screen !== "root") await this.back();
      return;
    }
    if (action.kind === "scroll-down" && action.envelope !== "list" && this.state.screen === "body") {
      if (this.state.pageIndex < this.state.pages.length - 1) this.show({ ...this.state, pageIndex: this.state.pageIndex + 1 });
      return;
    }
    if ((action.kind === "scroll-down" || action.kind === "scroll-up") && typeof action.selectedIndex === "number") {
      this.show(reduceAppState(this.state, { type: "select", index: action.selectedIndex }));
      return;
    }
    if (action.kind === "scroll-down" || action.kind === "scroll-up") {
      const direction = action.kind === "scroll-down" ? 1 : -1;
      this.show(reduceAppState(this.state, { type: "select", index: Math.max(0, this.state.selectedIndex + direction) }));
      return;
    }
    if (action.kind !== "click" && action.kind !== "double-click") return;
    if (this.state.screen === "root") {
      const index = action.selectedIndex ?? this.state.selectedIndex;
      const next = reduceAppState(this.state, { type: "select-root", index });
      this.show(next);
      if (next.screen === "recording") {
        try { await this.dependencies.startRecording?.(next.purpose); }
        catch (error) { this.show(requestFailure(error)); }
      }
      else if (next.screen === "loading" && next.operation === "recent") await this.loadRecent();
      return;
    }
    if (this.state.screen === "recording") {
      await this.finishRecording();
      return;
    }
    if (this.state.screen === "confirmation") {
      if ((action.selectedIndex ?? this.state.selectedIndex) !== 0) { await this.dependencies.create.cancel?.(); this.showRoot(); return; }
      this.show(reduceAppState(this.state, { type: "confirm-create" }));
      this.applyCreateView(await this.dependencies.create.confirm());
      return;
    }
    if (this.state.screen === "answer") {
      const index = action.selectedIndex ?? this.state.selectedIndex;
      const id = this.dependencies.query.openSource(index);
      const source = this.state.sources[index];
      if (id && source) await this.openBody(id, source.title, "answer");
      return;
    }
    if (this.state.screen === "closest-matches") {
      const source = this.state.matches[action.selectedIndex ?? this.state.selectedIndex];
      if (source) await this.openBody(source.id, source.title, "answer");
      return;
    }
    if (this.state.screen === "recent") {
      const source = this.state.items[action.selectedIndex ?? this.state.selectedIndex];
      if (source) await this.openBody(source.id, source.title, "recent");
      return;
    }
    if (this.state.screen === "queued") {
      const result = await this.dependencies.create.refresh?.();
      if (result) this.applyCreateView(result);
      return;
    }
    if (this.state.screen === "recovery") {
      if ((action.selectedIndex ?? this.state.selectedIndex) === 0) await this.finishRecording();
      else { await this.dependencies.stopAudio(); this.showRoot(); }
      return;
    }
    if (this.state.screen === "discard-confirmation") {
      if ((action.selectedIndex ?? this.state.selectedIndex) === 0) {
        await this.dependencies.stopAudio();
        await this.dependencies.create.cancel?.();
        this.showRoot();
      } else this.show({ screen: "recording", purpose: "create", selectedIndex: 0 });
      return;
    }
    if (this.state.screen === "error" || this.state.screen === "saved" || this.state.screen === "empty") this.showRoot();
  }

  async submitSpeech(transcript: string): Promise<void> {
    this.show({ screen: "loading", operation: "querying", selectedIndex: 0 });
    try {
      const response = await this.dependencies.query.ask(transcript);
      if (response.state === "answered") this.show({ screen: "answer", answer: response.answer ?? "", sources: response.sources ?? [], selectedIndex: 0 });
      else if (response.state === "closest_matches") this.show(response.matches?.length ? { screen: "closest-matches", matches: response.matches, selectedIndex: 0 } : { screen: "empty", kind: "query", selectedIndex: 0 });
      else this.show({ screen: "error", reason: response.state === "limit_reached" ? "limit-reached" : response.state === "setup_required" ? "revoked" : "unavailable", primaryAction: response.state === "setup_required" ? "reconnect" : "retry", selectedIndex: 0 });
    } catch (error) { this.show(requestFailure(error)); }
  }

  async systemEvent(kind: "foreground-exit" | "system-exit" | "abnormal-exit"): Promise<void> {
    if (kind === "foreground-exit") return;
    await this.dependencies.stopAudio();
    this.dependencies.closeSockets();
    this.dependencies.unsubscribe();
  }

  private async finishRecording(): Promise<void> {
    if (!this.dependencies.stopRecording) return;
    this.show({ screen: "loading", operation: "transcribing", selectedIndex: 0 });
    try {
      const result = await this.dependencies.stopRecording();
      if (result.purpose === "query") await this.submitSpeech(result.transcript);
      else if (this.dependencies.create.prepare) {
        this.show({ screen: "loading", operation: "preparing", selectedIndex: 0 });
        try { this.applyCreateView(await this.dependencies.create.prepare(result.recordingId, result.capturedAt)); }
        catch (error) {
          const failure = requestFailure(error);
          this.show(failure.reason === "offline" ? { screen: "error", reason: "preparation-failed", primaryAction: "retry", selectedIndex: 0 } : failure);
        }
      }
    } catch (error) {
      const failure = requestFailure(error);
      this.show(failure.reason === "offline" ? { screen: "error", reason: "transcription-failed", primaryAction: "retry", selectedIndex: 0 } : failure);
    }
  }

  private async loadRecent(): Promise<void> {
    try {
      const response = await this.dependencies.read.loadRecent();
      this.show(response.items.length ? { screen: "recent", ...response } : { screen: "empty", kind: "recent", selectedIndex: 0 });
    } catch (error) { this.show(requestFailure(error)); }
  }

  private async openBody(id: string, title: string, returnTo: "answer" | "recent"): Promise<void> {
    try {
      let body = await this.dependencies.read.openById(id);
      let text = body.text;
      while (body.position.next_offset != null && this.dependencies.read.nextPage) {
        body = await this.dependencies.read.nextPage();
        text += body.text;
      }
      this.returnState = this.snapshot();
      this.show({ screen: "body", title, pages: paginateUtf8Text(text), pageIndex: 0, selectedIndex: 0, returnTo });
    } catch { this.show({ screen: "error", reason: "stale", primaryAction: "return", selectedIndex: 0 }); }
  }

  private async back(): Promise<void> {
    if (this.state.screen === "recording") {
      this.show({ screen: "discard-confirmation", selectedIndex: 0 });
      return;
    }
    if (this.state.screen === "body" && this.returnState) {
      const previous = this.returnState;
      this.returnState = null;
      this.show(previous);
      return;
    }
    if (this.state.screen === "confirmation") await this.dependencies.create.cancel?.();
    this.showRoot();
  }

  private applyCreateView(view: { state: string; title?: string; message?: string; receipt?: { title: string }; acceptedAt?: string; stillQueued?: boolean }): void {
    if (view.state === "prepared") this.show({ screen: "confirmation", title: view.title ?? "", message: view.message, selectedIndex: 0 });
    else if (view.state === "queued") this.show({ screen: "queued", selectedIndex: 0, acceptedAt: view.acceptedAt, stillQueued: view.stillQueued });
    else if (view.state === "saved") this.show({ screen: "saved", title: view.receipt?.title, selectedIndex: 0 });
    else if (view.state === "title_collision") this.show({ screen: "error", reason: "title-collision", primaryAction: "retry", selectedIndex: 0 });
    else if (view.state === "proposal_expired") this.show({ screen: "error", reason: "proposal-expired", primaryAction: "retry", selectedIndex: 0 });
    else if (view.state === "commit_unknown") this.show({ screen: "error", reason: "commit-unknown", primaryAction: "wait", selectedIndex: 0 });
    else if (view.state === "revoked") this.show({ screen: "error", reason: "revoked", primaryAction: "reconnect", selectedIndex: 0 });
    else this.show({ screen: "error", reason: "preparation-failed", primaryAction: "retry", selectedIndex: 0 });
  }
}
