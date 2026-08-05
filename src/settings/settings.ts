import {
  App,
  type ButtonComponent,
  Modal,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
} from "obsidian";
import type AtomsPlugin from "../plugin/main";
import {
  aggregateTagsFromFileCaches,
  clampShortlistSize,
  DEFAULT_SHORTLIST_K,
  MIN_SHORTLIST_K,
} from "../pipeline/context";
import {
  readDeviceAutoRunState,
  writeAutoRunEnabled,
  writeEgressAck,
} from "../platform/autorun";
import {
  CAPTURE_SHORTCUT_VERSION,
  customCaptureShortcutUrl,
  labelInstallOrUpdate,
  openShortcutInstallUrl,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "./captureShortcut";
import { clampAtomFolder } from "../pipeline/render";
import {
  actionRow,
  backRow,
  destinationRow,
  destructiveRow,
  markDestructive,
  settingRow,
  statusRow,
} from "./rows";
import {
  API_KEY_SECRET_ID_DEFAULT,
  LOCAL_STORAGE_API_KEY,
} from "../shared/types";
import {
  clearPlusSession,
  hasPlusSetupSession,
  readPlusSession,
  setAwaitingCheckout,
  writePlusSession,
  type FilingAuth,
  type PlusEntitlementStatus,
  type PlusSession,
} from "../platform/filingAuth";
import {
  clearPlusRefreshRecord,
  plusRefreshPresentation,
  plusRefreshRowRecord,
  refreshPlusEntitlementRecord,
} from "../platform/plusRefresh";
import { atomsPlusTopUpCopy } from "../home/atomsHomeData";
import {
  DEFAULT_PLUS_BASE_URL,
  requestMagicLink,
  startPlusAccount,
  createCheckout,
  createBillingPortal,
  signOutPlus,
  askMcpUrl,
  askMcpPair,
  askMirrorStatus,
  askMirrorWipe,
  plusFetchRequest,
} from "../platform/plusClient";
import {
  clearAskMirrorDeviceState,
  formatAskMirrorStatusLine,
  formatAskMirrorServerCount,
  mirrorRefusalTitle,
  mirrorRefusalBody,
  readAskMirrorEmail,
  readAskMirrorRefusal,
  saveAskMirrorStatus,
  LS_ASK_MIRROR_LAST_ERROR,
  LS_ASK_MIRROR_LAST_SUCCESS,
  LS_ASK_MIRROR_SERVER_COUNT,
} from "../platform/askMirror";
import { fireAndForgetAsk } from "../shared/fireAndForget";
import { syncNowNotice } from "../shared/mirrorOutcome";
import type { ConfirmRequest, ConfirmVerdict } from "../shared/confirm";
import { requestUrl } from "obsidian";
import {
  addCustomActiveTag,
  approveProposedTag,
  normalizeTag,
  removeActiveTag,
  tagCountsSorted,
} from "../pipeline/vocabulary";

/** Public marketing + pricing page. Source lives in `www/` in this repo. */
export const ATOMS_SITE_URL = "https://tryatoms.app";

/**
 * Everything the Atoms Plus account can be, as one sealed type.
 *
 * The account cluster used to be four hand-maintained `if` branches inside one render method,
 * each rendering its own Refresh status / Sign out / Account rows — which is why those rows
 * drifted apart. Naming the states makes the four mutually exclusive, and `accountRowDescriptor`
 * below makes forgetting one a build failure rather than a blank row.
 */
export type AccountState =
  | { kind: "signedOut" }
  | { kind: "trialIncomplete"; email: string }
  | { kind: "active"; status: PlusEntitlementStatus; remaining?: number }
  | { kind: "exhausted" };

/** What the one main-screen account row says for a given state. */
export interface AccountRowDescriptor {
  name: string;
  desc?: string;
}

/**
 * Which state the device is in. Branch order is load-bearing and matches what the four `if`s
 * used to do: an exhausted Plus session outranks an active one, and a soft (inactive) session
 * still means "finish your trial" even when a BYOK key is present and `resolveFilingAuth`
 * therefore reports `byok`.
 */
export function deriveAccountState(
  auth: FilingAuth,
  session: PlusSession | null,
): AccountState {
  if (auth.mode === "plus") {
    if (auth.status === "exhausted") return { kind: "exhausted" };
    return { kind: "active", status: auth.status, remaining: auth.remaining };
  }
  if (hasPlusSetupSession(session) && session?.status === "inactive") {
    return { kind: "trialIncomplete", email: session.email };
  }
  return { kind: "signedOut" };
}

/**
 * The account row's label, as a returned value rather than a rendered row.
 *
 * That return type is the guard: `noImplicitReturns` says nothing about a switch inside a
 * void-returning renderer, so a fifth `AccountState` would have rendered nothing at all. Here a
 * missing branch leaves `state` non-`never` and fails `npm run build` (this file ships) as well
 * as `npm test`'s `typecheck:test` step.
 */
export function accountRowDescriptor(state: AccountState): AccountRowDescriptor {
  switch (state.kind) {
    case "signedOut":
      return {
        name: "Set up automatic filing",
        desc: "Atoms Plus files your captures for you. Or keep using your own API key — the full app stays yours either way.",
      };
    case "trialIncomplete":
      return {
        name: "Finish trial setup",
        desc: `${state.email} — complete checkout to start the 14-day trial.`,
      };
    case "active": {
      const base = state.status === "trialing" ? "Plus · Trial" : "Plus";
      const remaining =
        typeof state.remaining === "number"
          ? ` · ${state.remaining} filings left`
          : "";
      return { name: `${base}${remaining}` };
    }
    case "exhausted":
      return {
        name: "Monthly limit reached",
        desc: "This month's included filings are used up. Your allotment starts over on your next billing date.",
      };
  }
  const _exhaustive: never = state;
  return _exhaustive;
}

function settingHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl).setName(name).setHeading();
}

function loadLocal(app: App, key: string): unknown {
  return app.loadLocalStorage(key) as unknown;
}

/**
 * The three consents, and the three disclosures that carry them (KTD7).
 *
 * They are never unified. The egress ack covers this vault's own key sending captures to
 * Anthropic; the Ask privacy ack covers bodies stored on Atoms Plus servers, decryptable at
 * rest in v1; the write ack covers Claude or ChatGPT creating files in the vault. Merging any
 * two would let agreeing to one silently authorize another, so each has its own sheet and each
 * sheet writes exactly its own field.
 */
const EGRESS_ACK_TITLE = "Data egress acknowledgment";
const EGRESS_DISCLOSURE =
  'Atoms will send my vault title graph and each capture to the Anthropic API over TLS, unattended — when Obsidian opens, when it returns to the foreground, and when I tap "Sync everything now", which classifies even when automatic filing is turned off.';

const ASK_PRIVACY_ACK_TITLE = "Ask privacy acknowledgment";
const ASK_PRIVACY_DISCLOSURE =
  "(1) only Atoms/ leaves this device; (2) bodies are stored on Atoms Plus servers; (3) the host can decrypt at rest in v1 (not zero-knowledge); (4) when I chat in Claude, Anthropic receives tool results (titles, snippets, bodies); when I chat in ChatGPT, OpenAI receives them; (5) Wipe deletes the cloud mirror, pending outbox writes, and connector tokens; (6) turning Ask off does not wipe.";

const ASK_WRITE_ACK_TITLE = "Vault write acknowledgment";
const ASK_WRITE_DISCLOSURE =
  "Claude or ChatGPT can queue new atom bodies to Atoms Plus, and this vault will write them as new files under my Atoms folder. New files only — existing bodies are never rewritten. This is a separate consent from the Ask privacy acknowledgment, and turning it off stops the writes without touching the mirror.";

/**
 * Which screen the settings tab is showing. `main` is the list the user lands on; every other
 * value is a destination reached from it.
 *
 * A destination is a re-render of `containerEl` under a different route, not a new Obsidian
 * view and not a modal: the tab already empties and rebuilds itself on every toggle, so routing
 * costs one field and a switch, while a second view type would need its own lifecycle,
 * registration, and mobile back handling to say the same thing.
 */
export type SettingsRoute =
  | "main"
  | "account"
  | "vocabulary"
  | "connect"
  | "advanced";

/** Destination title, shown on its entry row and again on its back row. */
const DESTINATION_TITLES: Record<Exclude<SettingsRoute, "main">, string> = {
  account: "Account",
  vocabulary: "Tag vocabulary",
  connect: "Connect Claude or ChatGPT",
  advanced: "Advanced",
};

export class AtomsSettingTab extends PluginSettingTab {
  plugin: AtomsPlugin;
  private customTagDraft = "";
  private route: SettingsRoute = "main";
  /**
   * The consent sheet currently up, so closing Settings can close it. Without this handle a
   * sheet outlives the screen whose toggle opened it, and its verdict lands on a tab that has
   * already reset its route.
   */
  private openSheet: ConsentSheetModal | null = null;

  constructor(app: App, plugin: AtomsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Scroll parent for Settings tab content (Obsidian vertical tabs). */
  private settingsScrollEl(): HTMLElement | null {
    const vertical = this.containerEl.closest(".vertical-tab-content");
    if (vertical instanceof HTMLElement) return vertical;
    const parent = this.containerEl.parentElement;
    return parent instanceof HTMLElement ? parent : null;
  }

  /**
   * Full re-render while keeping scroll position (toggles/buttons must not jump to top).
   */
  private redisplay(): void {
    const scroller = this.settingsScrollEl();
    const top = scroller?.scrollTop ?? 0;
    this.display();
    const restore = () => {
      const el = this.settingsScrollEl();
      if (el) el.scrollTop = top;
    };
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
  }

  /**
   * Walk into a destination, or back out of one. Deliberately not `redisplay()`: that restores
   * the scroll position, which is right for a toggle re-rendering the screen the user is
   * already reading and wrong here — a destination is a screen they have not seen yet, so it
   * starts at the top.
   */
  private openRoute(route: SettingsRoute): void {
    this.route = route;
    this.display();
    const scroller = this.settingsScrollEl();
    if (scroller) scroller.scrollTop = 0;
  }

  /**
   * A visit to Settings ends when the tab is hidden, so the next one starts on the main list
   * rather than dropping the user back into whichever destination they last opened.
   */
  hide(): void {
    this.route = "main";
    // Closing Settings mid-decision is a decline, not a half-written ack: `close()` reaches the
    // sheet's `onClose`, which settles it the same way Escape does.
    this.openSheet?.close();
    this.openSheet = null;
    super.hide();
  }

  /**
   * Put a disclosure in front of the user at the moment of decision.
   *
   * Every exit that is not the accept button — Cancel, Escape, a click outside, Settings
   * closing — arrives as `declined`, because the toggle has already flipped visually by the
   * time the sheet opens and an unhandled dismissal is the path that silently grants consent.
   */
  private presentConsent(spec: ConsentSheetSpec): void {
    const sheet = new ConsentSheetModal(this.app, {
      ...spec,
      onVerdict: (verdict) => {
        this.openSheet = null;
        spec.onVerdict(verdict);
      },
    });
    this.openSheet = sheet;
    sheet.open();
  }

  /**
   * The record of an ack already granted: what it was, when, and the way back out.
   *
   * An `actionRow` rather than a `statusRow` + button, because `statusRow` deliberately carries
   * no control — reaching Review from it would mean widening that kind, and the withdrawal is
   * the whole point of the line.
   */
  private renderAckRecord(
    containerEl: HTMLElement,
    record: {
      name: string;
      at: string;
      disclosure: string;
      onWithdraw: () => void | Promise<void>;
    },
  ): void {
    const day = record.at.slice(0, 10);
    actionRow(containerEl, {
      name: record.name,
      desc: `Acknowledged ${day}`,
      label: "Review",
      onClick: () =>
        this.presentConsent({
          title: record.name,
          disclosure: record.disclosure,
          granted: `Acknowledged ${day}.`,
          onVerdict: (verdict) => {
            if (verdict !== "withdrawn") return;
            void record.onWithdraw();
          },
        }),
    });
  }

  /** Enabling the mirror is one write plus one sync; disabling it also drops the write ack. */
  private async setAskMirrorEnabled(enabled: boolean): Promise<void> {
    this.plugin.settings.askEnabled = enabled;
    if (!enabled) this.plugin.settings.askWriteAckAt = "";
    await this.plugin.saveSettings();
    if (enabled) fireAndForgetAsk(this.plugin.syncAskMirror({ force: false }));
    this.redisplay();
  }

  /** Grant (timestamp) or withdraw ("") the consent for Claude or ChatGPT to write here. */
  private async setAskWriteAck(at: string): Promise<void> {
    this.plugin.settings.askWriteAckAt = at;
    await this.plugin.saveSettings();
    if (at) fireAndForgetAsk(this.plugin.applyAskOutbox());
    this.redisplay();
  }

  /**
   * Imperative settings UI. Declarative PluginSettingTab.getSettingDefinitions
   * (Obsidian 1.13+ settings search) is a separate migration — not this claim.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const route = this.route;
    switch (route) {
      case "main":
        this.renderMainScreen(containerEl);
        return;
      case "account":
        this.renderDestination(containerEl, route, (el) => this.renderAccountDestination(el));
        return;
      case "vocabulary":
        this.renderDestination(containerEl, route, (el) => this.renderVocabularyDestination(el));
        return;
      case "connect":
        this.renderDestination(containerEl, route, (el) => this.renderConnectDestination(el));
        return;
      case "advanced":
        this.renderDestination(containerEl, route, (el) => this.renderAdvancedDestination(el));
        return;
    }
    // `noImplicitReturns` does not police a switch inside a void method, so a route added to
    // `SettingsRoute` without a branch above would render a blank screen rather than fail to
    // build. This makes it a compile error instead.
    const _exhaustive: never = route;
    return _exhaustive;
  }

  /** Back row first, then whatever that destination owns. */
  private renderDestination(
    containerEl: HTMLElement,
    route: Exclude<SettingsRoute, "main">,
    renderBody: (containerEl: HTMLElement) => void,
  ): void {
    backRow(containerEl, {
      name: DESTINATION_TITLES[route],
      onBack: () => this.openRoute("main"),
    });
    renderBody(containerEl);
  }

  /** Placeholder body for a destination whose rows have not moved in yet. */
  private renderEmptyDestination(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Nothing here yet.",
      cls: "setting-item-description",
    });
  }

  private renderConnectDestination(containerEl: HTMLElement): void {
    this.renderEmptyDestination(containerEl);
  }

  private renderAdvancedDestination(containerEl: HTMLElement): void {
    this.renderEmptyDestination(containerEl);
  }

  private renderMainScreen(containerEl: HTMLElement): void {
    const version = this.plugin.manifest.version ?? "?";
    settingHeading(containerEl, "Atoms");
    containerEl.createEl("p", {
      text: `Version ${version} · Capture with your shortcut; Process turns past bullets into linked atoms.`,
      cls: "setting-item-description",
    });

    // Everyday use first → billing → AI features → advanced
    this.renderCaptureSection(containerEl);
    this.renderModelSection(containerEl);
    this.renderAutoRunSection(containerEl);
    this.renderPlusSection(containerEl);
    this.renderAskSection(containerEl);
    this.renderApiSection(containerEl);
    this.renderVocabularyEntry(containerEl);
    this.renderDevHints(containerEl);
    this.renderDestinationEntries(containerEl);
  }

  /**
   * The vocabulary is the one cluster with no ceiling: a row per active tag, per proposal, and
   * per tag the vault already uses. On the main screen it is a single row carrying the only
   * number a user reads it for — how many tags the model may apply.
   */
  private renderVocabularyEntry(containerEl: HTMLElement): void {
    const active = this.plugin.settings.activeVocabulary.length;
    destinationRow(containerEl, {
      name: `${DESTINATION_TITLES.vocabulary} — ${active} active`,
      onOpen: () => this.openRoute("vocabulary"),
    });
  }

  /**
   * The remaining ways off the main screen. Grouped in one block, and last, only because the
   * rows they lead to have not moved yet — U6 relocates each destination's content and places
   * its entry row where that content used to sit.
   */
  private renderDestinationEntries(containerEl: HTMLElement): void {
    for (const route of ["connect", "advanced"] as const) {
      destinationRow(containerEl, {
        name: DESTINATION_TITLES[route],
        onOpen: () => this.openRoute(route),
      });
    }
  }

  /**
   * Pull latest Plus entitlement into device session and record the outcome so
   * the next `display()` can say what happened (the Notice alone was a no-op).
   * @returns true if session was updated from the service
   */
  private async refreshPlusEntitlement(opts?: {
    quiet?: boolean;
  }): Promise<boolean> {
    const session = readPlusSession(this.app);
    if (!session) {
      if (!opts?.quiet) new Notice("No Plus session on this device");
      return false;
    }
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const record = await refreshPlusEntitlementRecord(
      this.app,
      { baseUrl: base, request: plusFetchRequest },
      session,
    );
    if (!opts?.quiet) new Notice(`Atoms Plus: ${record.message}`, 8000);
    return record.kind === "ok";
  }

  /** Shared magic-link request — signed-out form and the expired-session row. */
  private async sendPlusMagicLink(email: string): Promise<void> {
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const r = await requestMagicLink(
      { baseUrl: base, request: plusFetchRequest },
      email,
    );
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    new Notice(
      "Check your email for a sign-in link. Then return here and tap Refresh status.",
      10000,
    );
  }

  /**
   * Inline result of the last "Refresh status" press. Expired sessions get the
   * sign-in link right here — no hunting for "Advanced: paste session".
   */
  private renderPlusRefreshOutcome(containerEl: HTMLElement): void {
    const record = plusRefreshRowRecord(this.app);
    if (!record) return;
    const view = plusRefreshPresentation(record);
    const email = record.email;
    if (view.recovery === "magic-link" && email) {
      actionRow(containerEl, {
        name: view.title,
        desc: view.detail,
        label: "Send me a sign-in link",
        onClick: () => this.sendPlusMagicLink(email),
      });
      return;
    }
    statusRow(containerEl, { name: view.title, value: view.detail });
  }

  /** Open the Stripe billing portal for the session on this device. */
  private async openBillingPortal(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) {
      new Notice("No Plus session on this device");
      return;
    }
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const r = await createBillingPortal(
      { baseUrl: base, request: plusFetchRequest },
      session.sessionToken,
    );
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    window.open(r.url, "_blank");
  }

  /** Buy additional filings for the current period. */
  private async openTopUpCheckout(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) {
      new Notice("No Plus session on this device");
      return;
    }
    const topUp = atomsPlusTopUpCopy();
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const r = await createCheckout(
      { baseUrl: base, request: plusFetchRequest },
      session.sessionToken,
      "topup_50",
    );
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    if (r.url) {
      window.open(r.url, "_blank");
      new Notice(
        `${topUp.title}: complete checkout in the browser, then tap Refresh status.`,
        8000,
      );
    } else {
      new Notice(
        `${topUp.title}: ${topUp.price} · ${topUp.detail}. ${topUp.body}`,
        6000,
      );
    }
    this.redisplay();
  }

  /**
   * Drop the Plus session from this device. Tells the service first when there is a token to
   * tell it about — the old exhausted and trial branches skipped that call and only the active
   * branch made it, which is exactly the kind of drift one code path removes.
   */
  private async signOutOfPlus(): Promise<void> {
    const session = readPlusSession(this.app);
    if (session) {
      const base =
        this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
      await signOutPlus(
        { baseUrl: base, request: plusFetchRequest },
        session.sessionToken,
      );
    }
    clearPlusSession(this.app);
    clearPlusRefreshRecord(this.app);
    new Notice("Atoms Plus signed out on this device");
    this.redisplay();
  }

  /** Value of the account destination's text input carrying this dataset flag. */
  private accountInput(containerEl: HTMLElement, flag: string): string {
    const input = containerEl.querySelector(`input[data-${flag}]`);
    return input instanceof HTMLInputElement ? input.value.trim() : "";
  }

  private accountState(): AccountState {
    return deriveAccountState(
      this.plugin.resolveFilingAuth(),
      readPlusSession(this.app),
    );
  }

  /**
   * Atoms Plus — mock SSOT docs/design-handoff/atoms-plus/index.html (v3).
   *
   * One row, whatever the account is doing. The four states used to be four `if` branches that
   * each rendered their own Refresh status / Sign out / Account rows; now the state picks a
   * label and everything you can *do* to the account lives one tap in.
   */
  private renderPlusSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Atoms Plus");
    const row = accountRowDescriptor(this.accountState());
    destinationRow(containerEl, {
      name: row.name,
      desc: row.desc,
      onOpen: () => this.openRoute("account"),
    });
  }

  /**
   * Account management. Every action is written once and the state decides which are offered —
   * the opposite of the four branches this replaced, where "Refresh status" existed three times
   * with three different descriptions.
   */
  private renderAccountDestination(containerEl: HTMLElement): void {
    const state = this.accountState();

    this.renderPlusRefreshOutcome(containerEl);
    if (state.kind === "signedOut") {
      this.renderSignedOutAccount(containerEl);
    } else {
      this.renderSignedInAccount(containerEl, state);
    }

    containerEl.createEl("p", {
      text: "When you use Plus, captures are sent securely to Anthropic under our account. We don’t train on your notes.",
      cls: "setting-item-description",
    });
  }

  private renderSignedInAccount(
    containerEl: HTMLElement,
    state: Exclude<AccountState, { kind: "signedOut" }>,
  ): void {
    const session = readPlusSession(this.app);
    statusRow(containerEl, {
      name: "Status",
      value: accountRowDescriptor(state).name,
    });
    const email =
      state.kind === "trialIncomplete" ? state.email : (session?.email ?? "");
    // "Signed in as", not "Account": the back row leading this screen is already named Account.
    if (email) statusRow(containerEl, { name: "Signed in as", value: email });
    if (state.kind !== "trialIncomplete") {
      statusRow(containerEl, {
        name: "Plan",
        value: session?.periodEnd
          ? `Renews ${session.periodEnd.slice(0, 10)}`
          : "Monthly or yearly — see Manage subscription",
      });
    }

    if (state.kind === "trialIncomplete") {
      actionRow(containerEl, {
        name: "Finish trial setup",
        desc: "Complete Stripe checkout (card for the 14-day trial). Return here and status updates automatically.",
        label: "Finish trial setup",
        onClick: () => this.finishTrialCheckout(),
      });
    }
    if (state.kind === "exhausted") {
      actionRow(containerEl, {
        name: "Get more filings",
        desc: "Buy additional filings now instead of waiting for your next billing date.",
        label: "Get more",
        onClick: () => this.openTopUpCheckout(),
      });
    }

    actionRow(containerEl, {
      name: "Refresh status",
      desc: "After checkout, a top-up, or a sign-in link, pull the latest plan from the Plus service.",
      label: "Refresh status",
      onClick: () => this.refreshAndRedisplay(),
    });
    if (state.kind !== "trialIncomplete") {
      actionRow(containerEl, {
        name: "Manage subscription",
        desc: "Change plan, update your card, or cancel in the billing portal.",
        label: "Manage subscription",
        onClick: () => this.openBillingPortal(),
      });
    }
    destructiveRow(containerEl, {
      name: "Sign out",
      desc: "Remove the Plus session from this device only.",
      label: "Sign out",
      onClick: () => this.signOutOfPlus(),
    });

    containerEl.createEl("p", {
      text: "To use your own API key instead, add it under API Key. Plus is optional.",
      cls: "setting-item-description",
    });
  }

  private renderSignedOutAccount(containerEl: HTMLElement): void {
    actionRow(containerEl, {
      name: "Skip the API key",
      desc: "Atoms Plus files your captures for you. Or keep using your own key. It’s free forever, and the full app stays yours either way.",
      label: "See plans",
      onClick: () => {
        window.open(ATOMS_SITE_URL, "_blank");
      },
    });

    settingRow(containerEl, {
      name: "Email",
      desc: "Start a free trial (card required). Checkout opens in your browser — then return to Obsidian.",
      control: {
        kind: "text",
        configure: (text) => {
          text.setPlaceholder("you@example.com").inputEl.dataset.plusEmail = "1";
        },
      },
    });
    actionRow(containerEl, {
      name: "Start free trial",
      label: "Start free trial",
      onClick: () => this.startTrial(containerEl),
    });

    settingRow(containerEl, {
      name: "Sign in on another device",
      desc: "Already subscribed? Email a one-time link. Open it, then tap Refresh status here.",
      control: {
        kind: "text",
        configure: (text) => {
          text.setPlaceholder("you@example.com").inputEl.dataset.plusMagicEmail =
            "1";
        },
      },
    });
    actionRow(containerEl, {
      name: "Send sign-in link",
      label: "Send sign-in link",
      onClick: () => {
        const email = this.accountInput(containerEl, "plus-magic-email");
        if (!email.includes("@")) {
          new Notice("Enter a valid email first");
          return;
        }
        return this.sendPlusMagicLink(email);
      },
    });

    // Restore fallback — only when the sign-in link plus Refresh status did not take.
    settingRow(containerEl, {
      name: "Advanced: paste session",
      desc: "Only if Refresh status does not work after the sign-in link.",
      control: {
        kind: "text",
        configure: (text) => {
          text.setPlaceholder("sess_…").inputEl.dataset.plusSession = "1";
        },
      },
    });
    actionRow(containerEl, {
      name: "Save session",
      label: "Save session",
      onClick: () => this.savePastedSession(containerEl),
    });
  }

  /** Start a Plus account for the typed email and open its trial checkout. */
  private async startTrial(containerEl: HTMLElement): Promise<void> {
    const email = this.accountInput(containerEl, "plus-email");
    if (!email.includes("@")) {
      new Notice("Enter a valid email first");
      return;
    }
    try {
      const base =
        this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
      const started = await startPlusAccount(
        { baseUrl: base, request: plusFetchRequest },
        email,
      );
      if (!started.ok) {
        if ("needsMagicLink" in started && started.needsMagicLink) {
          new Notice(
            "This email already has Plus — send a sign-in link below.",
            8000,
          );
          return;
        }
        new Notice(`Atoms Plus: ${started.message}`);
        return;
      }
      writePlusSession(this.app, started.session);
      await this.openTrialCheckout(started.session);
    } finally {
      this.redisplay();
    }
  }

  /** Resume the interrupted trial checkout for the session already on this device. */
  private async finishTrialCheckout(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) {
      new Notice("No Plus session on this device");
      return;
    }
    try {
      await this.openTrialCheckout(session);
    } finally {
      this.redisplay();
    }
  }

  private async refreshAndRedisplay(): Promise<void> {
    await this.refreshPlusEntitlement();
    this.redisplay();
  }

  /** Adopt a session token pasted by hand, after verifying it against the Plus service. */
  private async savePastedSession(containerEl: HTMLElement): Promise<void> {
    const sessionToken = this.accountInput(containerEl, "plus-session");
    if (!sessionToken.startsWith("sess_")) {
      new Notice("Session should look like sess_…");
      return;
    }
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    try {
      const res = await requestUrl({
        url: `${base.replace(/\/+$/, "")}/v1/me`,
        method: "GET",
        headers: { authorization: `Bearer ${sessionToken}` },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300 || !res.json) {
        new Notice("Session not accepted. Request a fresh sign-in link.", 8000);
        return;
      }
      const j = res.json as Record<string, unknown>;
      const email = String(j.email || "").trim();
      if (!email) {
        new Notice("Plus service returned no email for this session.");
        return;
      }
      const status =
        j.status === "active" ||
        j.status === "trialing" ||
        j.status === "exhausted" ||
        j.status === "inactive"
          ? j.status
          : "unknown";
      writePlusSession(this.app, {
        sessionToken,
        email,
        status,
        remaining: typeof j.remaining === "number" ? j.remaining : undefined,
        periodEnd: typeof j.periodEnd === "string" ? j.periodEnd : undefined,
        refreshedAt: Date.now(),
      });
      // Fresh session — the old "sign-in needed" row no longer applies.
      clearPlusRefreshRecord(this.app);
      new Notice("Atoms Plus session saved on this device");
      this.redisplay();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      new Notice(`Could not reach Plus service (${msg})`, 8000);
    }
  }

  private async openTrialCheckout(session: {
    sessionToken: string;
  }): Promise<void> {
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    new Notice("Updating subscription…", 4000);
    const r = await createCheckout(
      { baseUrl: base, request: plusFetchRequest },
      session.sessionToken,
      "start_trial",
    );
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    if (r.url) {
      setAwaitingCheckout(this.app, true);
      window.open(r.url, "_blank");
      new Notice(
        "Complete checkout in the browser, then return here — status updates automatically.",
        12000,
      );
    } else {
      new Notice("Trial updated. Refreshing…");
      await this.refreshPlusEntitlement({ quiet: true });
    }
  }

  private renderCaptureSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Capture");

    const acked = readShortcutAck((k) => loadLocal(this.app, k));
    const custom = customCaptureShortcutUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
    const installUrl = resolveCaptureShortcutInstallUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
    const urlSet = Boolean(installUrl);

    new Setting(containerEl)
      .setName("Daily capture format")
      .setDesc(
        "Write top-level bullets in your daily note: “- thought…”. Today’s note is never auto-processed; use Atoms home → Preview after midnight (or past dailies).",
      );

    // Optional on purpose: a value here outranks the constant forever, so a
    // user who fills it in with our own default stops receiving shipped link
    // updates. Keep the copy pointed at "leave this empty".
    new Setting(containerEl)
      .setName("Custom shortcut link")
      .setDesc(
        custom
          ? "Using your own link. Clear it (or press Use built-in) to go back to the shortcut Atoms ships and keep getting updates to it."
          : `Optional — leave empty. Atoms ships the Capture Atom shortcut (v${CAPTURE_SHORTCUT_VERSION}) and keeps it current for you. Only paste here if you modified the shortcut and made your own iCloud link (Share → Copy iCloud Link). See docs/capture-shortcut.md.`,
      )
      .addText((text) =>
        text
          .setPlaceholder("Using the shortcut Atoms ships")
          .setValue(custom)
          .onChange(async (value) => {
            // Filter on the way in, not on the way out. Storing a link we ship
            // would pin this device to it forever, and normalising at render
            // instead would mean an unawaited write racing this awaited one.
            this.plugin.settings.captureShortcutInstallUrl =
              customCaptureShortcutUrl(value);
            await this.plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Use the shortcut Atoms ships")
          .setDisabled(!custom)
          .onClick(async () => {
            this.plugin.settings.captureShortcutInstallUrl = "";
            await this.plugin.saveSettings();
            new Notice("Back to the built-in Capture Atom shortcut");
            this.redisplay();
          }),
      );

    new Setting(containerEl)
      .setName("Capture Atom shortcut")
      .setDesc(
        urlSet
          ? `Install or update Capture Atom, the iOS shortcut (v${CAPTURE_SHORTCUT_VERSION}). Opens ${custom ? "your custom link" : "the link Atoms ships"} — Shortcuts.app still needs confirm. Acked: ${acked ?? "never"}.`
          : `No link to open — the built-in is unset in this build, so paste your own iCloud URL above. Version tag: ${CAPTURE_SHORTCUT_VERSION}.`,
      )
      .addButton((btn) =>
        btn
          .setButtonText(labelInstallOrUpdate(acked))
          .setDisabled(!urlSet)
          .onClick(() => {
            if (!urlSet) {
              new Notice(
                "No shortcut link to open — paste your own iCloud link above.",
              );
              return;
            }
            const ok = openShortcutInstallUrl(installUrl);
            if (!ok) {
              new Notice(
                "Shortcut link must be an https://www.icloud.com/shortcuts/… URL",
              );
              return;
            }
            writeShortcutAck(
              (k, v) => this.app.saveLocalStorage(k, v),
              CAPTURE_SHORTCUT_VERSION,
            );
            new Notice(
              `Opened capture shortcut v${CAPTURE_SHORTCUT_VERSION} — add it in Shortcuts`,
            );
            this.redisplay();
          }),
      );

    new Setting(containerEl)
      .setName("Open today's daily")
      .setDesc("Jump to (or create) today’s Daily Notes file — does not process it.")
      .addButton((btn) =>
        btn.setButtonText("Open today").onClick(() => {
          void this.plugin.openTodaysDailyFromHome();
        }),
      );
  }

  private renderApiSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Your API key (optional)");
    containerEl.createEl("p", {
      text: "Only if you are not using Atoms Plus. Process sends titles, tags, and capture text to Anthropic over TLS. Your notes are never rewritten — only new atom files and markers.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        "SecretStorage on this vault + device only (not synced). Switching vaults or clearing app data (e.g. emulator pm clear) drops the key — re-enter once per vault. Secret ids: lowercase alphanumeric with dashes.",
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.apiKeySecretId)
          .onChange(async (value) => {
            this.plugin.settings.apiKeySecretId = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc(
        "Checks whether Obsidian can reach the internet and the Anthropic API from this device. Safe — does not log your key.",
      )
      .addButton((btn) =>
        btn.setButtonText("Test connection").onClick(() => {
          void this.plugin.runTestConnection();
        }),
      );

    new Setting(containerEl)
      .setName("Device-local key fallback")
      .setDesc(
        "Only if SecretStorage fails: non-synced local storage (still never data.json).",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useDeviceLocalKeyFallback)
          .onChange(async (value) => {
            this.plugin.settings.useDeviceLocalKeyFallback = value;
            if (!value) {
              this.app.saveLocalStorage(LOCAL_STORAGE_API_KEY, null);
            }
            await this.plugin.saveSettings();
            this.redisplay();
          }),
      );

    if (this.plugin.settings.useDeviceLocalKeyFallback) {
      const stored = loadLocal(this.app, LOCAL_STORAGE_API_KEY);
      const localKey = typeof stored === "string" ? stored : "";
      new Setting(containerEl)
        .setName("Device-local API key")
        .setDesc("This device only. Prefer SecretStorage.")
        .addText((text) => {
          text
            .setPlaceholder("sk-ant-…")
            .setValue(localKey)
            .onChange((value) => {
              this.app.saveLocalStorage(
                LOCAL_STORAGE_API_KEY,
                value.trim() ? value.trim() : null,
              );
            });
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
        });
    }

    containerEl.createEl("p", {
      text: `Tip: secret id example — ${API_KEY_SECRET_ID_DEFAULT}`,
      cls: "setting-item-description",
    });
  }

  private renderAutoRunSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Auto-run (this device)");
    containerEl.createEl("p", {
      text: "Stored only on this device (not synced via data.json). Default off. Turning it on asks for a one-time acknowledgment — unattended runs send titles + captures to Anthropic.",
      cls: "setting-item-description",
    });

    const load = (k: string): unknown => loadLocal(this.app, k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);

    settingRow(containerEl, {
      name: "Auto-run on open",
      desc: "When enabled: once per calendar day after layout + metadata are ready. Caps work per launch; offline fails silently until next day.",
      control: {
        kind: "toggle",
        configure: (toggle) =>
          toggle.setValue(state.enabled && state.egressAcked).onChange((on) => {
            if (!on || state.egressAcked) {
              writeAutoRunEnabled(save, on);
              this.redisplay();
              return;
            }
            this.presentConsent({
              title: EGRESS_ACK_TITLE,
              disclosure: EGRESS_DISCLOSURE,
              onVerdict: (verdict) => {
                // Anything short of an explicit accept leaves the toggle exactly where the
                // sheet found it: off, and unacknowledged.
                writeEgressAck(save, verdict === "accepted");
                writeAutoRunEnabled(save, verdict === "accepted");
                this.redisplay();
              },
            });
          }),
      },
    });

    // Rendered from the ack itself rather than from the toggle above it: an ack recorded
    // against a feature that is currently off is still a live consent, and still revocable.
    if (state.egressAcked) {
      actionRow(containerEl, {
        name: EGRESS_ACK_TITLE,
        // Device-local, and stored as a boolean — there is no timestamp to name here.
        desc: "Acknowledged on this device",
        label: "Review",
        onClick: () =>
          this.presentConsent({
            title: EGRESS_ACK_TITLE,
            disclosure: EGRESS_DISCLOSURE,
            granted: "Acknowledged on this device.",
            onVerdict: (verdict) => {
              if (verdict !== "withdrawn") return;
              writeEgressAck(save, false);
              writeAutoRunEnabled(save, false);
              this.redisplay();
            },
          }),
      });
    }

    new Setting(containerEl)
      .setName("Sync automatically on resume")
      .setDesc(
        "When you return to Obsidian, drain the inbox, apply the Ask outbox, push the mirror, and file if automatic filing is on. Device-local only. Manual Sync everything now still works when this is off.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.getResumeEnabled()).onChange((on) => {
          this.plugin.setResumeEnabled(on);
          this.redisplay();
        }),
      );

    new Setting(containerEl)
      .setName("Sync everything now")
      .setDesc(
        "Run drain → outbox → mirror → filing now (ignores resume cooldowns). Filing still needs the catch-up notice on Atoms home when present.",
      )
      .addButton((btn) =>
        btn.setButtonText("Sync everything now").setCta().onClick(() => {
          void this.plugin.runSyncEverythingNow();
        }),
      );

    if (state.lastRunDay) {
      containerEl.createEl("p", {
        text: `Last auto-run day (this device): ${state.lastRunDay}`,
        cls: "setting-item-description",
      });
    }
    const catchLine = this.plugin.getLastCatchupLine();
    if (catchLine) {
      containerEl.createEl("p", {
        text: catchLine,
        cls: "setting-item-description",
      });
    }
  }

  private renderModelSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Filing");

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Anthropic model id. Default: claude-sonnet-5.")
      .addText((text) =>
        text
          .setPlaceholder("claude-sonnet-5")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || "claude-sonnet-5";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Atom folder")
      .setDesc(
        "Flat single folder for atom notes (e.g. Atoms). Paths with .. or subfolders are rejected.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Atoms")
          .setValue(this.plugin.settings.atomFolder)
          .onChange(async (value) => {
            this.plugin.settings.atomFolder = clampAtomFolder(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Notes considered per capture")
      .setDesc(
        "How many of your existing notes each capture is compared against before Atoms picks what to link. Raise it to search more of your vault; each capture then costs a little more to file. Default 400. Blank or unreadable resets to 400; anything under 1 is treated as 1.",
      )
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_SHORTLIST_K);
        text
          .setPlaceholder(String(DEFAULT_SHORTLIST_K))
          .setValue(String(clampShortlistSize(this.plugin.settings.shortlistSize)))
          .onChange(async (value) => {
            this.plugin.settings.shortlistSize = clampShortlistSize(value);
            await this.plugin.saveSettings();
          });
        // Typing "40" on the way to "400" must not fight the user, so the field is only
        // rewritten once they leave it — showing the number that will actually be used.
        text.inputEl.addEventListener("blur", () => {
          text.setValue(String(clampShortlistSize(this.plugin.settings.shortlistSize)));
        });
      });

    new Setting(containerEl)
      .setName("Also consider linked notes")
      .setDesc(
        "When on, Atoms also considers notes linked from the ones a capture already matched, so a related note can be suggested even when it shares no words with what you wrote. On by default.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expandLinkedNotes !== false)
          .onChange(async (on) => {
            this.plugin.settings.expandLinkedNotes = on;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Reconsider capture")
      .setDesc(
        "Experimental. Command palette → Reconsider capture: ask again about one skipped line (noise/task marker) under the cursor. Off by default.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableReconsiderCapture === true)
          .onChange(async (on) => {
            this.plugin.settings.enableReconsiderCapture = on;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hub projection")
      .setDesc(
        "When on, Process / Update / backfill write a managed section at the end of person hub notes listing linked atoms under your existing headings. Your text outside the markers is never changed. If Ask mirror is on, updated hub notes sync vault→cloud like other linked hubs. Off by default.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableHubProjection === true)
          .onChange(async (on) => {
            this.plugin.settings.enableHubProjection = on;
            await this.plugin.saveSettings();
          }),
      );
  }

  /**
   * Active tags, anything a classify run proposed, and what the vault already uses. The three
   * groups keep the behavior they had on the main screen; only their address changed.
   */
  private renderVocabularyDestination(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Active tags may be applied by the model. #person, #preferences, and #relationship always work (smart defaults). Proposed tags need one-tap approval. People: link to a hub note (e.g. Alex); atoms stay flat — use backlinks, not AI folders.",
      cls: "setting-item-description",
    });

    settingHeading(containerEl, "Active");
    const active = [...this.plugin.settings.activeVocabulary].sort((a, b) =>
      a.localeCompare(b),
    );

    for (const tag of active) {
      settingRow(containerEl, {
        name: `#${tag}`,
        desc: "Active — eligible for classification",
        control: {
          kind: "toggle",
          configure: (toggle) =>
            toggle.setValue(true).onChange(async (on) => {
              if (on) return;
              this.plugin.settings.activeVocabulary = removeActiveTag(
                tag,
                this.plugin.settings.activeVocabulary,
              );
              await this.plugin.saveSettings();
              this.redisplay();
            }),
        },
      });
    }

    // Field and button were one row, which the grammar allows only one right edge for. Splitting
    // them keeps both rather than dropping the field or committing on every keystroke.
    settingRow(containerEl, {
      name: "Add a custom tag",
      desc: "Lowercase, no # required.",
      control: {
        kind: "text",
        configure: (text) =>
          text
            .setPlaceholder("e.g. health")
            .setValue(this.customTagDraft)
            .onChange((v) => {
              this.customTagDraft = v;
            }),
      },
    });
    actionRow(containerEl, {
      name: "Add to Active",
      label: "Add",
      onClick: async () => {
        const t = normalizeTag(this.customTagDraft);
        if (!t) return;
        this.plugin.settings.activeVocabulary = addCustomActiveTag(
          t,
          this.plugin.settings.activeVocabulary,
        );
        this.customTagDraft = "";
        await this.plugin.saveSettings();
        this.redisplay();
      },
    });

    // Proposed tags awaiting approval
    const proposed = this.plugin.settings.proposedTags ?? [];
    if (proposed.length > 0) {
      settingHeading(containerEl, "Proposed (approve to activate)");
      for (const tag of proposed) {
        // Approve and dismiss were two buttons on one row; same split, same reason as above.
        actionRow(containerEl, {
          name: `#${tag}`,
          desc: "From classify runs — not applied until approved",
          label: "Approve",
          onClick: async () => {
            const next = approveProposedTag(
              tag,
              this.plugin.settings.activeVocabulary,
              this.plugin.settings.proposedTags,
            );
            this.plugin.settings.activeVocabulary = next.activeVocabulary;
            this.plugin.settings.proposedTags = next.proposedTags;
            await this.plugin.saveSettings();
            this.redisplay();
          },
        });
        destructiveRow(containerEl, {
          name: `Dismiss #${tag}`,
          label: "Dismiss",
          onClick: async () => {
            this.plugin.settings.proposedTags =
              this.plugin.settings.proposedTags.filter(
                (t) => normalizeTag(t) !== normalizeTag(tag),
              );
            await this.plugin.saveSettings();
            this.redisplay();
          },
        });
      }
    }

    // Found in vault
    settingHeading(containerEl, "Found in your vault");
    const files = this.app.vault.getMarkdownFiles();
    const caches = files.map((f) => ({
      path: f.path,
      cache: this.app.metadataCache.getFileCache(f),
    }));
    const counts = aggregateTagsFromFileCaches(caches);
    const ranked = tagCountsSorted(counts).slice(0, 30);
    const activeSet = new Set(active.map(normalizeTag));

    if (ranked.length === 0) {
      containerEl.createEl("p", {
        text: "No tags found in vault yet.",
        cls: "setting-item-description",
      });
    }

    for (const { tag, count } of ranked) {
      if (activeSet.has(tag)) continue;
      actionRow(containerEl, {
        name: `#${tag}`,
        desc: `${count} use(s) — tap to promote to Active`,
        label: "Activate",
        onClick: async () => {
          this.plugin.settings.activeVocabulary = addCustomActiveTag(
            tag,
            this.plugin.settings.activeVocabulary,
          );
          await this.plugin.saveSettings();
          this.redisplay();
        },
      });
    }
  }

  /**
   * Ask — remote MCP for Claude / ChatGPT (Plus). No in-plugin chat.
   */
  private renderAskSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Ask (Claude + ChatGPT)");
    const session = readPlusSession(this.app);
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const mcpUrl = askMcpUrl(base);

    containerEl.createEl("p", {
      text: "Cloud copy of Atoms/ on Plus — for chat search in Claude or ChatGPT. When Obsidian is open online, hand-edits and deletes push automatically. Full orphan cleanup is Sync now. Not a second library you maintain by hand.",
      cls: "setting-item-description",
    });

    if (!session) {
      containerEl.createEl("p", {
        text: "Sign in to Atoms Plus above first.",
        cls: "setting-item-description",
      });
      return;
    }

    const ack = Boolean(this.plugin.settings.askPrivacyAckAt);
    settingRow(containerEl, {
      name: "Enable Ask mirror",
      desc: "Keep the cloud Atoms/ copy current while Obsidian is open (vault events + Process/Update).",
      control: {
        kind: "toggle",
        configure: (tog) =>
          tog.setValue(this.plugin.settings.askEnabled).onChange((on) => {
            if (!on) {
              void this.setAskMirrorEnabled(false);
              return;
            }
            if (ack) {
              void this.setAskMirrorEnabled(true);
              return;
            }
            this.presentConsent({
              title: ASK_PRIVACY_ACK_TITLE,
              disclosure: ASK_PRIVACY_DISCLOSURE,
              onVerdict: (verdict) => {
                if (verdict !== "accepted") {
                  this.redisplay();
                  return;
                }
                this.plugin.settings.askPrivacyAckAt = new Date().toISOString();
                void this.setAskMirrorEnabled(true);
              },
            });
          }),
      },
    });

    if (ack) {
      this.renderAckRecord(containerEl, {
        name: ASK_PRIVACY_ACK_TITLE,
        at: this.plugin.settings.askPrivacyAckAt,
        disclosure: ASK_PRIVACY_DISCLOSURE,
        onWithdraw: async () => {
          this.plugin.settings.askPrivacyAckAt = "";
          this.plugin.settings.askEnabled = false;
          // Withdrawing consent to store bodies in the cloud also withdraws consent for the
          // cloud to write back into the vault: the narrower ack cannot outlive the one it
          // was granted on top of.
          this.plugin.settings.askWriteAckAt = "";
          await this.plugin.saveSettings();
          this.redisplay();
        },
      });
    }

    const writeAck = Boolean(this.plugin.settings.askWriteAckAt);
    settingRow(containerEl, {
      name: "Allow filing from Claude or ChatGPT",
      desc: "When on, this vault applies create/continue outbox items under your Atoms folder (new files only; never rewrites existing bodies). Requires Ask mirror enabled.",
      control: {
        kind: "toggle",
        configure: (tog) =>
          tog
            .setValue(writeAck)
            .setDisabled(!ack || !this.plugin.settings.askEnabled)
            .onChange((on) => {
              if (!on) {
                void this.setAskWriteAck("");
                return;
              }
              if (!this.plugin.settings.askEnabled) {
                new Notice("Enable Ask mirror first");
                this.redisplay();
                return;
              }
              this.presentConsent({
                title: ASK_WRITE_ACK_TITLE,
                disclosure: ASK_WRITE_DISCLOSURE,
                onVerdict: (verdict) => {
                  if (verdict !== "accepted") {
                    this.redisplay();
                    return;
                  }
                  void this.setAskWriteAck(new Date().toISOString());
                },
              });
            }),
      },
    });

    if (writeAck) {
      this.renderAckRecord(containerEl, {
        name: ASK_WRITE_ACK_TITLE,
        at: this.plugin.settings.askWriteAckAt,
        disclosure: ASK_WRITE_DISCLOSURE,
        // The narrower of the two Ask consents: withdrawing it stops vault writes and leaves
        // the mirror exactly as it was.
        onWithdraw: () => this.setAskWriteAck(""),
      });
    }

    new Setting(containerEl)
      .setName("MCP connector URL")
      .setDesc(
        "Same URL for both. Claude → Settings → Connectors → Add custom connector. ChatGPT → Settings → Apps & connectors (Developer mode) → add this URL → complete OAuth.",
      )
      .addText((text) => {
        text.setValue(mcpUrl).setDisabled(true);
        text.inputEl.classList.add("atoms-settings-mcp-url-input");
      })
      .addButton((btn) =>
        btn.setButtonText("Copy").onClick(async () => {
          try {
            await navigator.clipboard.writeText(mcpUrl);
            new Notice("MCP URL copied");
          } catch {
            new Notice("Could not copy — select the URL field and copy");
          }
        }),
      );

    // Status line from device-local stamps (N = last known server count)
    const lastOk = String(
      (this.app.loadLocalStorage(LS_ASK_MIRROR_LAST_SUCCESS) as unknown) ?? "",
    );
    const lastErr = String(
      (this.app.loadLocalStorage(LS_ASK_MIRROR_LAST_ERROR) as unknown) ?? "",
    ).trim();
    const serverCount = formatAskMirrorServerCount(
      (k) => this.app.loadLocalStorage(k) as unknown,
    );
    const relative = (iso: string) => {
      if (!iso) return "never";
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return "never";
      const sec = Math.round((Date.now() - t) / 1000);
      if (sec < 60) return "just now";
      if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
      if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
      return `${Math.floor(sec / 86400)}d ago`;
    };
    // A refusal outranks a push error: the mirror did not converge and the
    // user needs to know deletion was withheld, not that a request failed.
    const refused =
      readAskMirrorRefusal(
        (k) => this.app.loadLocalStorage(k) as unknown,
      ).count > 0;
    const mirrorEmail =
      readAskMirrorEmail((k) => this.app.loadLocalStorage(k) as unknown) ||
      session.email ||
      "";
    const statusLine = formatAskMirrorStatusLine({
      serverCount,
      email: mirrorEmail,
      relativeLastOk: relative(lastOk),
      lastErr: refused ? "" : lastErr,
      refused,
    });
    containerEl.createEl("p", {
      text: statusLine,
      cls: lastErr || refused
        ? "setting-item-description atoms-ask-mirror-error"
        : "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Link Claude / ChatGPT")
      .setDesc(
        "Generate a short pairing code for the connector authorize page. Your Claude/ChatGPT account email need not match Atoms Plus — the code binds the Plus account shown above. Codes expire quickly and are secrets (do not share). After pairing, disconnect/reconnect the connector if counts still look stale.",
      )
      .addButton((btn) =>
        btn.setButtonText("Get pairing code").onClick(async () => {
          if (!this.plugin.settings.askEnabled) {
            new Notice("Enable Ask mirror first");
            return;
          }
          btn.setDisabled(true);
          try {
            const r = await askMcpPair(
              { baseUrl: base, request: plusFetchRequest },
              session.sessionToken,
            );
            if (!r.ok) {
              new Notice(`Pairing: ${r.message}`);
              return;
            }
            const raw = r.code.replace(/-/g, "");
            const display =
              raw.length === 8
                ? `${raw.slice(0, 4)}-${raw.slice(4)}`
                : r.code;
            try {
              await navigator.clipboard.writeText(display);
              new Notice(
                `Pairing code ${display} copied — paste on the connector authorize page (expires soon)`,
              );
            } catch {
              new Notice(
                `Pairing code: ${display} — paste on the connector authorize page (expires soon)`,
              );
            }
          } finally {
            btn.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc(
        "Full refresh from this device’s Atoms/ (orphans removed on Plus). Multi-device: incomplete vault here can delete cloud rows for atoms only on another device until Obsidian Sync catches up.",
      )
      .addButton((btn) =>
        btn.setButtonText("Sync now").setCta().onClick(async () => {
          const outcome = await this.plugin.syncAskMirror({ force: true });
          // Four distinct outcomes. "joined" is not a zero-work success, and a
          // refusal must never read as "reconciled" in the loudest channel the
          // user is watching (R7). Failure is null here only because a forced
          // push always toasts its own failure — it ignores the background
          // dedupe flag precisely so this gesture is never silent.
          const msg = syncNowNotice(outcome);
          if (msg) new Notice(msg);
          // Refresh either way so the status line reflects what just happened.
          this.redisplay();
        }),
      );

    new Setting(containerEl)
      .setName("Cloud mirror status")
      .setDesc("Refresh server atom count (what Claude/ChatGPT can see).")
      .addButton((btn) =>
        btn.setButtonText("Refresh").onClick(async () => {
          const r = await askMirrorStatus(
            { baseUrl: base, request: plusFetchRequest },
            session.sessionToken,
          );
          if (!r.ok) {
            new Notice(`Ask: ${r.message}`);
            return;
          }
          saveAskMirrorStatus(
            (k, v) => this.app.saveLocalStorage(k, v),
            r,
          );
          const as = r.email ? ` as ${r.email}` : "";
          new Notice(`Ask mirror: ${r.count} atom(s)${as}`);
          this.redisplay();
        }),
      );

    new Setting(containerEl)
      .setName("Wipe cloud copy")
      .setDesc(
        "Delete mirrored atoms, pending Ask writes (outbox), and revoke Ask connector tokens for this account. Does not delete vault files.",
      )
      .addButton((btn) =>
        markDestructive(btn.setButtonText("Wipe"))
          .onClick(() => {
            const modal = new Modal(this.app);
            modal.titleEl.setText("Wipe cloud copy?");
            modal.contentEl.createEl("p", {
              text: "Wipe cloud atom mirror, pending Ask writes, and revoke Ask connector access (Claude + ChatGPT)? Local vault files are kept.",
            });
            new Setting(modal.contentEl)
              .addButton((b) =>
                b.setButtonText("Cancel").onClick(() => modal.close()),
              )
              .addButton((b) =>
                markDestructive(b.setButtonText("Wipe"))
                  .setCta()
                  .onClick(() => {
                    modal.close();
                    void (async () => {
                      const r = await askMirrorWipe(
                        { baseUrl: base, request: plusFetchRequest },
                        session.sessionToken,
                      );
                      if (!r.ok) {
                        new Notice(`Ask: ${r.message}`);
                        return;
                      }
                      // One owner for the reset. Re-listing the keys here is
                      // how the wipe and the gate's readers drift — and a wipe
                      // that leaves a *parseable* count behind hands the gate a
                      // fabricated authority for the cloud it just emptied.
                      clearAskMirrorDeviceState((k, v) =>
                        this.app.saveLocalStorage(k, v),
                      );
                      await this.plugin.saveSettings();
                      new Notice("Ask mirror wiped");
                      this.redisplay();
                    })();
                  }),
              );
            modal.open();
          }),
      );

    new Setting(containerEl)
      .setName("Self-host Ask")
      .setDesc(
        "Run plus-service yourself + Plus URL override + OAuth MCP. Opens DIY guide.",
      )
      .addButton((btn) =>
        btn.setButtonText("Docs").onClick(() => {
          window.open(
            "https://github.com/taihartman/obsidian-atoms/blob/master/docs/ask-self-host.md",
            "_blank",
          );
        }),
      );
  }

  private renderDevHints(containerEl: HTMLElement) {
    settingHeading(containerEl, "Advanced");
    containerEl.createEl("p", {
      text: "Leave these alone unless you self-host or dogfood a local Plus server.",
      cls: "setting-item-description",
    });

    // Override only for local dogfood. Shipping builds leave this empty → DEFAULT_PLUS_BASE_URL.
    new Setting(containerEl)
      .setName("Plus service URL override")
      .setDesc(
        `Empty = production (${DEFAULT_PLUS_BASE_URL}). Local: http://127.0.0.1:8787`,
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_PLUS_BASE_URL)
          .setValue(this.plugin.settings.plusBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.plusBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}

/** How a consent sheet ended. Only `accepted` grants; only `withdrawn` revokes. */
export type ConsentVerdict = "accepted" | "declined" | "withdrawn";

/** What a consent sheet says, and who hears how it ended. */
export interface ConsentSheetSpec {
  title: string;
  disclosure: string;
  /** Set when reviewing an ack already granted — the sheet then offers withdrawal, not accept. */
  granted?: string;
  onVerdict: (verdict: ConsentVerdict) => void;
}

/**
 * A disclosure at the moment of decision, and the surface that takes it back (KTD4).
 *
 * The three permanent acknowledgment toggles this replaces were the only controls that could
 * clear an ack, so the review shape carries `Withdraw acknowledgment`: a consent that can be
 * granted but not withdrawn would be worse than the row it replaced.
 *
 * `answered` is what separates accept from dismissal. `onClose` fires for *every* close,
 * including the one an accept triggers, so it settles as `declined` only when nothing has
 * settled yet — which makes Escape, a click outside, and Settings closing all declines, and
 * leaves an accepted sheet accepted.
 */
export class ConsentSheetModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly spec: ConsentSheetSpec,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const reviewing = this.spec.granted !== undefined;
    contentEl.createEl("h2", { text: this.spec.title });
    contentEl.createEl("p", { text: `I understand: ${this.spec.disclosure}` });
    if (this.spec.granted !== undefined) {
      contentEl.createEl("p", {
        text: this.spec.granted,
        cls: "setting-item-description",
      });
    }

    const buttons = new Setting(contentEl).addButton((btn) =>
      // "Close" reads as leaving a record alone; "Cancel" as abandoning a decision.
      btn.setButtonText(reviewing ? "Close" : "Cancel").onClick(() => this.answer("declined")),
    );
    if (reviewing) {
      buttons.addButton((btn) =>
        markDestructive(btn.setButtonText("Withdraw acknowledgment")).onClick(() =>
          this.answer("withdrawn"),
        ),
      );
      return;
    }
    buttons.addButton((btn) =>
      btn
        .setButtonText("I understand")
        .setCta()
        .onClick(() => this.answer("accepted")),
    );
  }

  onClose() {
    this.contentEl.empty();
    // Closing without choosing is a decline, never consent — and never a withdrawal either.
    this.answer("declined");
  }

  private answer(verdict: ConsentVerdict): void {
    if (this.answered) return;
    this.answered = true;
    this.spec.onVerdict(verdict);
    this.close();
  }
}

/**
 * The gesture that releases a deletion refusal (KTD15 / U1).
 *
 * It names the concrete counts because reconcile hard-deletes server-side —
 * no tombstone, no retention window, no recovery beyond re-uploading from a
 * vault that, by definition, may not hold the atoms. Dismissing counts as a
 * refusal, never as consent.
 */
export class AskMirrorDeleteConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private readonly request: ConfirmRequest,
    private readonly onVerdict: (verdict: ConfirmVerdict) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    // The copy is per-reason. Hard-coding the scan-incomplete wording made the
    // dialog lie on the other two: a first sync with no recorded cloud count
    // has nothing to do with a shrinking scan, and the tripwire is about this
    // vault holding far fewer atoms than the cloud.
    contentEl.createEl("h2", { text: mirrorRefusalTitle(this.request.reason) });
    contentEl.createEl("p", { text: mirrorRefusalBody(this.request.reason) });
    contentEl.createEl("p", {
      text: `Atoms this device has synced before: ${this.request.evidenceCount}`,
    });
    contentEl.createEl("p", {
      text: `Atoms found in this vault right now: ${this.request.scannedCount}`,
    });
    contentEl.createEl("p", {
      // Always a fresh number — the dialog is not posed without one.
      text: `Cloud count right now: ${this.request.lastKnownServerCount}`,
    });
    contentEl.createEl("p", {
      text: "Deleting from the cloud cannot be undone — the only way back is re-uploading from this vault. Confirm only if you meant to delete these atoms.",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Wait for sync").onClick(() => {
          this.answer("declined");
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Delete from cloud")
          .setWarning()
          .onClick(() => {
            this.answer("confirmed");
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
    // Closing without choosing is a dismissal, not consent.
    this.answer("dismissed");
  }

  private answer(verdict: ConfirmVerdict): void {
    if (this.answered) return;
    this.answered = true;
    this.onVerdict(verdict);
    if (verdict !== "dismissed") this.close();
  }
}
