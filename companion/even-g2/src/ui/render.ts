import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import type { AppState } from "../app/state";
import { G2_COPY } from "../i18n/en";
import { truncateUtf8 } from "./paginate";

export type GlassesView = { width: 576; height: 288; text: string; items: string[]; selectedIndex: number };

function errorView(state: Extract<AppState, { screen: "error" }>): GlassesView {
  return page(G2_COPY.errors[state.reason], [G2_COPY.actions[state.primaryAction]], 0);
}

function page(text: string, items: readonly string[] = [], selectedIndex = 0): GlassesView {
  const labels = items.map((item) => truncateUtf8(item, 63));
  return { width: 576, height: 288, text, items: labels, selectedIndex: Math.min(selectedIndex, Math.max(0, labels.length - 1)) };
}

export function renderGlasses(state: AppState): GlassesView {
  switch (state.screen) {
    case "checking": return page(G2_COPY.checking);
    case "unpaired": return page(G2_COPY.unpaired, [G2_COPY.connect]);
    case "setup-required": return page(G2_COPY.setupRequired, [G2_COPY.reconnect]);
    case "root": return page(G2_COPY.appName, ROOT_ITEMS, state.selectedIndex);
    case "starting-recording": return page(G2_COPY.checking);
    case "recording": return page(state.purpose === "create" ? G2_COPY.recording : G2_COPY.askRecording);
    case "loading": {
      const labels = { pairing: G2_COPY.pairing, transcribing: G2_COPY.preparing, preparing: G2_COPY.preparing, querying: G2_COPY.preparing, recent: G2_COPY.recentLoading, committing: G2_COPY.queued };
      return page(labels[state.operation]);
    }
    case "confirmation": return page(`Create “${state.title}”?${state.message ? `\n${state.message}` : ""}`, [G2_COPY.create, G2_COPY.tryAgain], state.selectedIndex);
    case "queued": return page(state.stillQueued ? `${G2_COPY.stillQueued}${state.acceptedAt ? ` · ${state.acceptedAt}` : ""}` : G2_COPY.queued, [G2_COPY.actions.wait]);
    case "saved": return page(state.title ? `${G2_COPY.saved}\n${state.title}` : G2_COPY.saved, [G2_COPY.actions.return]);
    case "answer": return page(state.answer, [...state.sources.map((source) => source.title), G2_COPY.actions.return], state.selectedIndex);
    case "closest-matches": return page(G2_COPY.weakEvidence, [...state.matches.map((match) => match.title), G2_COPY.actions.return], state.selectedIndex);
    case "recent": return page(state.coverageComplete ? G2_COPY.sources : `${G2_COPY.sources} · ${G2_COPY.errors.stale}`, [...state.items.map((item) => item.title), G2_COPY.actions.return], state.selectedIndex);
    case "body": return page(`${state.title}\n${state.pages[state.pageIndex] ?? ""}`, state.pages.length > 1 ? [`${state.pageIndex + 1}/${state.pages.length}`] : [G2_COPY.actions.return]);
    case "empty": return page(state.kind === "recent" ? G2_COPY.noRecent : G2_COPY.noSources, [G2_COPY.actions.return]);
    case "recovery": return page(G2_COPY.recovered, state.kind === "queued" ? [G2_COPY.actions.wait] : [G2_COPY.actions.retry, G2_COPY.actions.discard]);
    case "discard-confirmation": return page(G2_COPY.discard, [G2_COPY.discardAction, G2_COPY.actions.return], state.selectedIndex);
    case "error": return errorView(state);
  }
}

const ROOT_ITEMS: readonly string[] = G2_COPY.root;
const TEXT_ID = 1;
const LIST_ID = 2;

function containers(view: GlassesView) {
  const hasList = view.items.length > 0;
  return {
    containerTotalNum: hasList ? 2 : 1,
    textObject: [new TextContainerProperty({
      containerID: TEXT_ID, containerName: "atoms-state", xPosition: 0, yPosition: 0,
      width: 576, height: hasList ? 174 : 288, content: view.text, isEventCapture: hasList ? 0 : 1,
    })],
    listObject: hasList ? [new ListContainerProperty({
      containerID: LIST_ID, containerName: "atoms-actions", xPosition: 0, yPosition: 176,
      width: 576, height: 112, isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({ itemCount: view.items.length, itemWidth: 576, isItemSelectBorderEn: 1, itemName: view.items }),
    })] : undefined,
  };
}

export class EvenGlassesRenderer {
  private started = false;
  private renderTail: Promise<void> = Promise.resolve();
  constructor(private readonly bridge: Pick<EvenAppBridge, "createStartUpPageContainer" | "rebuildPageContainer">) {}

  render(state: AppState): Promise<void> {
    const content = containers(renderGlasses(state));
    const rendered = this.renderTail.then(() => this.renderContent(content));
    this.renderTail = rendered.catch(() => undefined);
    return rendered;
  }

  private async renderContent(content: ReturnType<typeof containers>): Promise<void> {
    if (!this.started) {
      const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(content));
      if (result !== StartUpPageCreateResult.success) throw new Error("startup_page_unavailable");
      this.started = true;
      return;
    }
    if (!await this.bridge.rebuildPageContainer(new RebuildPageContainer(content))) throw new Error("page_rebuild_failed");
  }
}
