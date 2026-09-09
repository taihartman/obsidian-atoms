import { G2_COPY } from "../i18n/en";

export type PhoneState =
  | { screen: "unpaired"; origin: string }
  | { screen: "pairing"; code: string }
  | { screen: "disclosure" }
  | { screen: "setup-required" }
  | { screen: "loading"; operation: "pairing" }
  | { screen: "pairing-error"; reason: "invalid" | "expired" | "replayed"; origin: string }
  | { screen: "ready" };

export type PhoneHandlers = { connect?(code: string): void; acceptDisclosure?(): void; reconnect?(): void };

function phoneText(state: PhoneState): string {
  switch (state.screen) {
    case "unpaired": return `${G2_COPY.unpaired}\n${G2_COPY.privateTestOrigin(state.origin)}`;
    case "pairing": return `${G2_COPY.pairingCode}: ${state.code}`;
    case "disclosure": return `${G2_COPY.disclosureTitle}\n${G2_COPY.disclosureBody}`;
    case "setup-required": return G2_COPY.setupRequired;
    case "loading": return G2_COPY.pairing;
    case "pairing-error": {
      const error = state.reason === "expired" ? G2_COPY.expiredCode : state.reason === "replayed" ? G2_COPY.replayedCode : G2_COPY.invalidCode;
      return `${error}\n${G2_COPY.unpaired}\n${G2_COPY.privateTestOrigin(state.origin)}`;
    }
    case "ready": return G2_COPY.ready;
  }
}

export function renderPhone(root: HTMLElement, state: PhoneState, handlers: PhoneHandlers = {}): void {
  root.textContent = phoneText(state);
  const document = root.ownerDocument;
  if (!document) return;
  const section = document.createElement("section");
  const heading = document.createElement("h1");
  heading.textContent = phoneText(state);
  section.append(heading);
  if (state.screen === "unpaired" || state.screen === "pairing-error") {
    const input = document.createElement("input");
    input.inputMode = "text";
    input.autocomplete = "one-time-code";
    input.setAttribute("aria-label", G2_COPY.pairingCode);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = G2_COPY.connect;
    button.addEventListener("click", () => handlers.connect?.(input.value));
    section.append(input, button);
  } else if (state.screen === "disclosure") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = G2_COPY.acceptDisclosure;
    button.addEventListener("click", () => handlers.acceptDisclosure?.());
    section.append(button);
  } else if (state.screen === "setup-required") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = G2_COPY.reconnect;
    button.addEventListener("click", () => handlers.reconnect?.());
    section.append(button);
  }
  root.replaceChildren(section);
}
