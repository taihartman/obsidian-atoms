import { G2_COPY } from "../i18n/en";

export const ROOT_ACTIONS = G2_COPY.root;
export type RootAction = typeof ROOT_ACTIONS[number];
export type ErrorReason = keyof typeof G2_COPY.errors;
export type PrimaryAction = keyof typeof G2_COPY.actions;
export type Source = { id: string; title: string };

export type AppState =
  | { screen: "checking" | "unpaired" | "setup-required" | "root"; selectedIndex: number }
  | { screen: "recording"; purpose: "create" | "query"; selectedIndex: number; transcript?: string }
  | { screen: "loading"; operation: "pairing" | "transcribing" | "preparing" | "querying" | "recent" | "committing"; selectedIndex: number }
  | { screen: "confirmation"; title: string; selectedIndex: number; message?: string }
  | { screen: "queued"; selectedIndex: number; acceptedAt?: string; stillQueued?: boolean }
  | { screen: "saved"; selectedIndex: number; title?: string }
  | { screen: "answer"; answer: string; sources: Source[]; selectedIndex: number }
  | { screen: "closest-matches"; matches: Source[]; selectedIndex: number }
  | { screen: "recent"; items: Source[]; selectedIndex: number; coverageComplete: boolean }
  | { screen: "body"; title: string; pages: string[]; pageIndex: number; selectedIndex: number; returnTo: "answer" | "recent" }
  | { screen: "empty"; kind: "recent" | "query"; selectedIndex: number }
  | { screen: "recovery"; kind: "staged" | "prepared" | "queued"; selectedIndex: number }
  | { screen: "discard-confirmation"; selectedIndex: number }
  | { screen: "error"; reason: ErrorReason; primaryAction: PrimaryAction; selectedIndex: number };

export type AppEvent =
  | { type: "select-root"; index: number }
  | { type: "select"; index: number }
  | { type: "prepared"; title: string; message?: string }
  | { type: "confirm-create" }
  | { type: "fail"; reason: ErrorReason }
  | { type: "back" };

export function initialState(): AppState {
  return { screen: "checking", selectedIndex: 0 };
}

function actionFor(reason: ErrorReason): PrimaryAction {
  if (reason === "revoked") return "reconnect";
  if (reason === "commit-unknown") return "wait";
  if (reason === "recovery-full") return "discard";
  if (reason === "stale") return "return";
  return "retry";
}

export function reduceAppState(state: AppState, event: AppEvent): AppState {
  if (event.type === "fail") return { screen: "error", reason: event.reason, primaryAction: actionFor(event.reason), selectedIndex: 0 };
  if (event.type === "select") return { ...state, selectedIndex: Math.max(0, event.index) };
  if (event.type === "select-root" && state.screen === "root") {
    if (event.index === 0) return { screen: "recording", purpose: "create", selectedIndex: 0 };
    if (event.index === 1) return { screen: "recording", purpose: "query", selectedIndex: 0 };
    if (event.index === 2) return { screen: "loading", operation: "recent", selectedIndex: 0 };
    return state;
  }
  if (event.type === "prepared" && state.screen === "recording") return { screen: "confirmation", title: event.title, selectedIndex: 0, message: event.message };
  if (event.type === "confirm-create" && state.screen === "confirmation") return { screen: "loading", operation: "committing", selectedIndex: 0 };
  if (event.type === "back") {
    if (state.screen === "recording") return { screen: "discard-confirmation", selectedIndex: 0 };
    if (state.screen !== "checking" && state.screen !== "unpaired" && state.screen !== "setup-required" && state.screen !== "root") return { screen: "root", selectedIndex: 0 };
  }
  return state;
}

export function allStableStates(): AppState[] {
  const base: AppState[] = [
    { screen: "checking", selectedIndex: 0 }, { screen: "unpaired", selectedIndex: 0 },
    { screen: "setup-required", selectedIndex: 0 }, { screen: "root", selectedIndex: 0 },
    { screen: "recording", purpose: "create", selectedIndex: 0 }, { screen: "recording", purpose: "query", selectedIndex: 0 },
    { screen: "loading", operation: "transcribing", selectedIndex: 0 },
    { screen: "confirmation", title: "A walk thought", selectedIndex: 0 },
    { screen: "queued", selectedIndex: 0 }, { screen: "queued", selectedIndex: 0, stillQueued: true },
    { screen: "saved", selectedIndex: 0, title: "A walk thought" },
    { screen: "answer", answer: "The launch is Friday.", sources: [{ id: "one", title: "Launch" }], selectedIndex: 0 },
    { screen: "closest-matches", matches: [{ id: "one", title: "Launch" }], selectedIndex: 0 },
    { screen: "recent", items: [{ id: "one", title: "Launch" }], selectedIndex: 0, coverageComplete: false },
    { screen: "body", title: "Launch", pages: ["Friday"], pageIndex: 0, selectedIndex: 0, returnTo: "recent" },
    { screen: "empty", kind: "recent", selectedIndex: 0 },
    { screen: "empty", kind: "query", selectedIndex: 0 },
    { screen: "recovery", kind: "staged", selectedIndex: 0 },
    { screen: "recovery", kind: "prepared", selectedIndex: 0 },
    { screen: "recovery", kind: "queued", selectedIndex: 0 },
    { screen: "discard-confirmation", selectedIndex: 0 },
  ];
  return base.concat((Object.keys(G2_COPY.errors) as ErrorReason[]).map((reason) => ({ screen: "error", reason, primaryAction: actionFor(reason), selectedIndex: 0 })));
}
