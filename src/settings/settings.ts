import {
  App,
  type ButtonComponent,
  Modal,
  Notice,
  PluginSettingTab,
  type RequestUrlParam,
  type RequestUrlResponse,
  SecretComponent,
  Setting,
} from "obsidian";
import {
  anthropicConnectivityOk,
  runApiKeyReachabilityCheck,
  type ConnectivityReport,
} from "../platform/connectivity";
import type AtomsPlugin from "../plugin/main";
import {
  aggregateTagsFromFileCaches,
} from "../pipeline/context";
import {
  readDeviceAutoRunState,
  writeAutoRunEnabled,
  writeEgressAck,
} from "../platform/autorun";
import { clearEgressNoticeAcked, LAST_CATCHUP_LABEL } from "../platform/resume";
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
  plusIsExhausted,
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
  if (plusIsExhausted(auth)) return { kind: "exhausted" };
  if (auth.mode === "plus") {
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

/**
 * The request the API-key row's check goes through. Injectable so a test can answer it without a
 * network; production leaves it unset and `runApiKeyReachabilityCheck` falls back to `requestUrl`.
 */
export type ConnectivityRequest = (
  params: RequestUrlParam,
) => Promise<RequestUrlResponse>;

/**
 * Everything the Anthropic API key row can say about the key it currently resolves.
 *
 * Four outcomes plus a pending state, not a boolean: "this key is wrong" and "this device is
 * offline" ask opposite things of the user, and this row is the only place either is now
 * reported — it replaced the standalone *Test connection* row.
 */
export type ApiKeyState =
  | { kind: "absent" }
  | { kind: "checking" }
  | { kind: "malformed" }
  | { kind: "unreachable" }
  | { kind: "rejected" }
  | { kind: "ok" };

/**
 * Whether a resolved secret is shaped like an Anthropic key at all. Checked before the request,
 * so a typo is reported as a typo rather than spending a round trip to come back as a rejection.
 */
export function looksLikeAnthropicKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.startsWith("sk-ant-") && trimmed.length >= 16;
}

/**
 * Read the row's verdict off the structured report rather than re-deriving reachability.
 *
 * The Anthropic probe's HTTP status is the load-bearing part: 401/403 is a server that answered
 * and refused the key, which is a different sentence from a probe that never got a status at all.
 */
export function apiKeyStateFromReport(report: ConnectivityReport): ApiKeyState {
  const probe = report.probes.find((p) => p.id === "anthropic_api");
  if (!probe) return { kind: "unreachable" };
  const status = probe.detail?.status;
  if (status === 401 || status === 403) return { kind: "rejected" };
  if (anthropicConnectivityOk(probe)) return { kind: "ok" };
  return { kind: "unreachable" };
}

/** One sentence per state — the row's whole report, in the row itself. */
export function apiKeyStatusText(state: ApiKeyState): string {
  switch (state.kind) {
    case "absent":
      return "No key saved on this device yet.";
    case "checking":
      return "Checking this key…";
    case "malformed":
      return "That does not look like an Anthropic API key — keys start with sk-ant-.";
    case "unreachable":
      return "Could not reach Anthropic from this device, so the key was not checked. Try again when you are online.";
    case "rejected":
      return "Anthropic answered, but rejected this key. Check that it is current and has credit.";
    case "ok":
      return "This key works — Anthropic answered from this device.";
  }
  const _exhaustive: never = state;
  return _exhaustive;
}

/**
 * How long a settled check stays good.
 *
 * Long enough that the flurry of `redisplay()` calls every other row on this screen triggers
 * costs nothing — a check per toggle would be a request storm. Short enough that a user who
 * fixes their connection while Settings is open sees the row catch up on the next re-render.
 */
const API_KEY_RECHECK_MS = 60_000;

/**
 * How long a check may claim to still be in flight.
 *
 * `requestUrl` has no timeout of its own, so a probe that never settles never resolves the
 * promise the row is waiting on. Past this, the next render asks again rather than repainting
 * a "Checking" that is not going to change.
 */
const API_KEY_CHECK_TIMEOUT_MS = 15_000;

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
  /**
   * Set by `hide()` and cleared by the next `display()`. Closing Settings settles any open sheet
   * as a decline, and every decline path ends in `redisplay()` — which would rebuild the screen
   * the user just closed and, with the key cache freshly cleared, ask Anthropic about it again.
   * The decline still runs; only its re-render is dropped.
   *
   * A latch rather than a flag held for the body of `hide()`, because half the doors into
   * `redisplay()` are `await`ed continuations — a refresh whose request is still in flight, a
   * toggle whose save has not landed — and those resolve long after `hide()` has returned. The
   * next real visit calls `display()`, which is the only thing that clears it; an exception
   * thrown inside `hide()` therefore cannot strand the tab non-rendering either.
   */
  private hiding = false;
  /**
   * The last answer the API-key row got, and when. Keyed by the key it was about, so a new key
   * is always a fresh question and a re-render of the same key is not.
   */
  private apiKeyCheck: { key: string; state: ApiKeyState; at: number } | null =
    null;
  /**
   * Where to write that answer. A field rather than a captured element because a check in flight
   * outlives the row that started it: any toggle on the screen re-renders the tab, and the
   * result must land on the row the user is now looking at.
   */
  private apiKeyStatusEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: AtomsPlugin,
    private readonly deps: { request?: ConnectivityRequest } = {},
  ) {
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
    // Nothing to keep on screen once the tab is closing; see `hiding`.
    if (this.hiding) return;
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
    this.hiding = true;
    this.route = "main";
    // A new visit re-asks whether the key works. Without this, a user who saved a key offline
    // would see that verdict forever — the row's only other trigger is saving the key again.
    this.apiKeyCheck = null;
    this.apiKeyStatusEl = null;
    // Closing Settings mid-decision is a decline, not a half-written ack: `close()` reaches the
    // sheet's `onClose`, which settles it the same way Escape does.
    this.openSheet?.close();
    this.openSheet = null;
    super.hide();
    // Not cleared here — `display()` owns that, so continuations landing after this returns
    // still find the tab closed.
  }

  /**
   * Put a disclosure in front of the user at the moment of decision.
   *
   * Every exit that is not the accept button — Cancel, Escape, a click outside, Settings
   * closing — arrives as `declined`, because the toggle has already flipped visually by the
   * time the sheet opens and an unhandled dismissal is the path that silently grants consent.
   */
  private presentConsent(spec: ConsentSheetSpec): void {
    // One sheet at a time: an unclosed predecessor would be orphaned by the assignment below,
    // outliving the handle that is meant to be able to settle it as a decline.
    this.openSheet?.close();
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
    // Ahead of the save, so a withdrawal that lands during it has already destroyed the DOM
    // whose handlers still close over the state this gesture was rendered under.
    this.redisplay();
    await this.plugin.saveSettings();
    // Read live rather than from `enabled`: the save is an await, and a withdrawal landing
    // inside it turns both the consent and the mirror off. The push is the egress itself, so
    // it answers to the state now, not to the gesture that started it.
    if (this.askMirrorPermitted()) {
      fireAndForgetAsk(this.plugin.syncAskMirror({ force: false }));
    }
  }

  /** Whether the mirror may push right now: enabled, and under a privacy ack still granted. */
  private askMirrorPermitted(): boolean {
    return (
      this.plugin.settings.askEnabled &&
      Boolean(this.plugin.settings.askPrivacyAckAt)
    );
  }

  /** Grant (timestamp) or withdraw ("") the consent for Claude or ChatGPT to write here. */
  private async setAskWriteAck(at: string): Promise<void> {
    this.plugin.settings.askWriteAckAt = at;
    // Ahead of the save, so a withdrawal that lands during it has already replaced the screen
    // whose handlers still hold the granted state.
    this.redisplay();
    await this.plugin.saveSettings();
    // Live, for the same reason the mirror push is: applying the outbox writes files, and the
    // ack authorizing that may have been withdrawn while this was waiting on disk.
    if (this.plugin.settings.askWriteAckAt) {
      fireAndForgetAsk(this.plugin.applyAskOutbox());
    }
  }

  /**
   * Imperative settings UI. Declarative PluginSettingTab.getSettingDefinitions
   * (Obsidian 1.13+ settings search) is a separate migration — not this claim.
   */
  display(): void {
    // A real render is what re-opens the tab, whether it is Obsidian showing it again or a
    // route walk. Anything that arrived late from the last visit has already been dropped.
    this.hiding = false;
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

  /**
   * Everything it takes to connect Claude or ChatGPT to the mirror, and the wipe that undoes it.
   *
   * The destructive row sits beside what it destroys rather than in a general danger zone: the
   * cloud copy is what these rows are about, so the way to delete it belongs with them.
   */
  private renderConnectDestination(containerEl: HTMLElement): void {
    const session = readPlusSession(this.app);
    if (!session) {
      containerEl.createEl("p", {
        text: "Sign in to Atoms Plus first.",
        cls: "setting-item-description",
      });
      return;
    }
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const mcpUrl = askMcpUrl(base);

    const status = this.mirrorStatusLine(session.email);
    containerEl.createEl("p", {
      text: status.line,
      cls: status.failing
        ? "setting-item-description atoms-ask-mirror-error"
        : "setting-item-description",
    });

    // An action row rather than a read-only field plus a Copy button: two affordances on one row
    // is the thing the grammar forbids, and a disabled input cannot be selected on most
    // platforms anyway — so the URL lives in the description, where it can be read and selected.
    actionRow(containerEl, {
      name: "MCP connector URL",
      desc: `${mcpUrl} — same URL for both. Claude → Settings → Connectors → Add custom connector. ChatGPT → Settings → Apps & connectors (Developer mode) → add this URL → complete OAuth.`,
      label: "Copy",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(mcpUrl);
          new Notice("MCP URL copied");
        } catch {
          new Notice(`MCP URL: ${mcpUrl}`);
        }
      },
    });

    actionRow(containerEl, {
      name: "Link Claude / ChatGPT",
      desc: "Generate a short pairing code for the connector authorize page. Your Claude/ChatGPT account email need not match Atoms Plus — the code binds the Plus account shown above. Codes expire quickly and are secrets (do not share). After pairing, disconnect/reconnect the connector if counts still look stale.",
      label: "Get pairing code",
      onClick: async () => {
        if (!this.plugin.settings.askEnabled) {
          new Notice("Turn on Ask mirror first");
          return;
        }
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
          raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : r.code;
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
      },
    });

    actionRow(containerEl, {
      name: "Sync now",
      desc: "Full refresh from this device’s Atoms/ (orphans removed on Plus). Multi-device: incomplete vault here can delete cloud rows for atoms only on another device until Obsidian Sync catches up.",
      label: "Sync now",
      onClick: async () => {
        const outcome = await this.plugin.syncAskMirror({ force: true });
        // Four distinct outcomes. "joined" is not a zero-work success, and a refusal must never
        // read as "reconciled" in the loudest channel the user is watching (R7). Failure is null
        // here only because a forced push always toasts its own failure — it ignores the
        // background dedupe flag precisely so this gesture is never silent.
        const msg = syncNowNotice(outcome);
        if (msg) new Notice(msg);
        // Refresh either way so the status line reflects what just happened.
        this.redisplay();
      },
    });

    actionRow(containerEl, {
      name: "Cloud mirror status",
      desc: "Refresh server atom count (what Claude/ChatGPT can see).",
      label: "Refresh",
      onClick: async () => {
        const r = await askMirrorStatus(
          { baseUrl: base, request: plusFetchRequest },
          session.sessionToken,
        );
        if (!r.ok) {
          new Notice(`Ask: ${r.message}`);
          return;
        }
        saveAskMirrorStatus((k, v) => this.app.saveLocalStorage(k, v), r);
        const as = r.email ? ` as ${r.email}` : "";
        new Notice(`Ask mirror: ${r.count} atom(s)${as}`);
        this.redisplay();
      },
    });

    destructiveRow(containerEl, {
      name: "Wipe cloud copy",
      desc: "Delete mirrored atoms, pending Ask writes (outbox), and revoke Ask connector tokens for this account. Does not delete vault files.",
      label: "Wipe",
      onClick: () => this.confirmWipeCloudCopy(base, session.sessionToken),
    });
  }

  /**
   * The wipe itself, behind the confirmation it must never lose.
   *
   * Returns a promise settling when the question is answered, so `destructiveRow`'s in-flight
   * guard covers the whole confirm lifetime. Returning `void` left the one destructive row on
   * the screen able to stack two confirm modals on a double-tap.
   */
  private confirmWipeCloudCopy(base: string, sessionToken: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText("Wipe cloud copy?");
      modal.contentEl.createEl("p", {
        text: "Wipe cloud atom mirror, pending Ask writes, and revoke Ask connector access (Claude + ChatGPT)? Local vault files are kept.",
      });
      // Cancel, Escape, and a click outside all arrive here. The wipe path closes the modal too,
      // and settles on the request instead — the row must stay held for that, not just for the
      // question.
      let wiping = false;
      modal.onClose = () => {
        if (!wiping) resolve();
      };
      new Setting(modal.contentEl)
        .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
        .addButton((b) =>
          markDestructive(b.setButtonText("Wipe"))
            .setCta()
            .onClick(() => {
              wiping = true;
              modal.close();
              void (async () => {
                const r = await askMirrorWipe(
                  { baseUrl: base, request: plusFetchRequest },
                  sessionToken,
                );
                if (!r.ok) {
                  new Notice(`Ask: ${r.message}`);
                  return;
                }
                // One owner for the reset. Re-listing the keys here is how the wipe and the
                // gate's readers drift — and a wipe that leaves a *parseable* count behind hands
                // the gate a fabricated authority for the cloud it just emptied.
                clearAskMirrorDeviceState((k, v) =>
                  this.app.saveLocalStorage(k, v),
                );
                await this.plugin.saveSettings();
                new Notice("Ask mirror wiped");
                this.redisplay();
              })().finally(resolve);
            }),
        );
      modal.open();
    });
  }

  /**
   * The two rows that are nobody's everyday business.
   *
   * R5 rules what may be here: no gate on money, cloud egress, or vault writes. *Model* affects
   * what a capture costs but cannot enable spend, and *Plus service URL override* redirects where
   * already-enabled egress goes rather than turning any on — inert until a main-screen gate is on.
   * Both are here on the record rather than by silence.
   *
   * The device-local key rows are *not* here, though they read as plumbing: `getApiKey()` falls
   * back to that key, so the pair is a complete credential path that enables Anthropic spend —
   * and the toggle is also the only thing that deletes the stored key. R5 puts both on the main
   * screen, under the API-key section.
   */
  private renderAdvancedDestination(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Leave these alone unless you self-host or dogfood a local Plus server.",
      cls: "setting-item-description",
    });

    settingRow(containerEl, {
      name: "Model",
      desc: "Anthropic model id. Default: claude-sonnet-5.",
      control: {
        kind: "text",
        configure: (text) =>
          text
            .setPlaceholder("claude-sonnet-5")
            .setValue(this.plugin.settings.model)
            .onChange(async (value) => {
              this.plugin.settings.model = value.trim() || "claude-sonnet-5";
              await this.plugin.saveSettings();
            }),
      },
    });

    // Override only for local dogfood. Shipping builds leave this empty → DEFAULT_PLUS_BASE_URL.
    settingRow(containerEl, {
      name: "Plus service URL override",
      desc: `Empty = production (${DEFAULT_PLUS_BASE_URL}). Local: http://127.0.0.1:8787`,
      control: {
        kind: "text",
        configure: (text) =>
          text
            .setPlaceholder(DEFAULT_PLUS_BASE_URL)
            .setValue(this.plugin.settings.plusBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.plusBaseUrl = value.trim();
              await this.plugin.saveSettings();
            }),
      },
    });
  }

  private renderMainScreen(containerEl: HTMLElement): void {
    const version = this.plugin.manifest.version ?? "?";
    settingHeading(containerEl, "Atoms");
    containerEl.createEl("p", {
      text: `Version ${version} · Capture with your shortcut; Process turns past bullets into linked atoms.`,
      cls: "setting-item-description",
    });

    // The plan's main-screen table, in its order: who you are → what you capture → where it
    // lands → what the model may say → who else can read it → when it runs → keys → advanced.
    // Ask sits under Plus because it is the only cluster a signed-out install does not render.
    this.renderPlusSection(containerEl);
    this.renderCaptureSection(containerEl);
    this.renderModelSection(containerEl);
    this.renderVocabularyEntry(containerEl);
    this.renderAskSection(containerEl);
    this.renderAutoRunSection(containerEl);
    this.renderApiSection(containerEl);
    this.renderAdvancedEntry(containerEl);
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

  /** Where the dev hints used to sit, in the same place and with the same name. */
  private renderAdvancedEntry(containerEl: HTMLElement): void {
    destinationRow(containerEl, {
      name: DESTINATION_TITLES.advanced,
      onOpen: () => this.openRoute("advanced"),
    });
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
          // A Plus bearer token, treated the way the API key field treats a key.
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
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

    // The section's intro, not a row: it names no preference and offers no control, so it was a
    // row with an empty right edge. As prose it is exempt from the row grammar.
    containerEl.createEl("p", {
      text: "Write top-level bullets in your daily note: “- thought…”. Today’s note is never auto-processed; use Atoms home → Preview after midnight (or past dailies).",
      cls: "setting-item-description",
    });

    // Optional on purpose: a value here outranks the constant forever, so a
    // user who fills it in with our own default stops receiving shipped link
    // updates. Keep the copy pointed at "leave this empty".
    //
    // Stays a direct `Setting` rather than a `settingRow`, and is not the ratchet's next
    // target: R2 bans a row wearing two *grammars* — a toggle and a button, a chevron and a
    // toggle — and a text field with a small inline reset is not one of those pairs. The reset
    // only exists to clear the field beside it, so forcing this through the builder would mean
    // splitting one coherent row in two.
    const shortcutUrlRow = new Setting(containerEl)
      .setName("iCloud shortcut link")
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
    // The reset icon shares the control edge with the field, and the field loses: unclassed, it
    // collapsed to about 54px and showed "Usi" of its placeholder. The class is what `styles.css`
    // needs to give the input back its width.
    shortcutUrlRow.settingEl.addClass("atoms-capture-shortcut-url");

    actionRow(containerEl, {
      name: "Capture Atom shortcut",
      desc: urlSet
        ? `Install or update Capture Atom, the iOS shortcut (v${CAPTURE_SHORTCUT_VERSION}). Opens ${custom ? "your custom link" : "the link Atoms ships"} — Shortcuts.app still needs confirm. Acked: ${acked ?? "never"}.`
        : `No link to open — the built-in is unset in this build, so paste your own iCloud URL above. Version tag: ${CAPTURE_SHORTCUT_VERSION}.`,
      label: labelInstallOrUpdate(acked),
      disabled: !urlSet,
      onClick: () => {
        // Kept behind the disabled button rather than removed: `urlSet` is read once at render,
        // so this is the row's own answer if it is ever pressed without a link behind it.
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
      },
    });
  }

  private renderApiSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Your API key (optional)");
    containerEl.createEl("p", {
      text: "Only if you are not using Atoms Plus. Process sends titles, tags, and capture text to Anthropic over TLS. Your notes are never rewritten — only new atom files and markers.",
      cls: "setting-item-description",
    });

    // Still a direct `new Setting(`: the control is a `SecretComponent`, which the row grammar's
    // toggle/text/dropdown union does not carry, and the row needs its own element to report the
    // check into. Both are reasons this one row cannot go through a builder as it stands.
    const setting = new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        // The secret-id example lives here rather than in a paragraph below the row: as prose it
        // sat between this row and the fallback toggle that answers for the same key, splitting
        // a pair that belongs together. It describes this field, so it belongs to this field.
        `SecretStorage on this vault + device only (not synced). Switching vaults or clearing app data (e.g. emulator pm clear) drops the key — re-enter once per vault. Secret ids: lowercase alphanumeric with dashes, e.g. ${API_KEY_SECRET_ID_DEFAULT}.`,
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.apiKeySecretId)
          .onChange(async (value) => {
            this.plugin.settings.apiKeySecretId = value;
            await this.plugin.saveSettings();
            // Saving is the moment the answer can change, so it is the moment to re-ask.
            this.checkApiKey();
          }),
      );
    this.apiKeyStatusEl = setting.descEl.createDiv({
      cls: "atoms-api-key-status",
    });
    this.checkApiKey();

    // Plumbing by tone, a credential path by effect: `getApiKey()` falls back to this key, so
    // the pair below can enable Anthropic spend on its own — which R5 keeps on the main screen
    // rather than behind Advanced. The toggle is also the only thing that deletes the key.
    settingRow(containerEl, {
      name: "Device-local key fallback",
      desc: "Only if SecretStorage fails: non-synced local storage (still never data.json). Turning this off deletes the key stored on this device.",
      control: {
        kind: "toggle",
        configure: (toggle) =>
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
      },
    });

    if (this.plugin.settings.useDeviceLocalKeyFallback) {
      const stored = loadLocal(this.app, LOCAL_STORAGE_API_KEY);
      const localKey = typeof stored === "string" ? stored : "";
      settingRow(containerEl, {
        name: "Device-local API key",
        desc: "This device only. Prefer SecretStorage.",
        control: {
          kind: "text",
          configure: (text) => {
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
          },
        },
      });
    }
  }

  /** Put the current verdict on the row, wherever that row is now. */
  private paintApiKeyStatus(state: ApiKeyState): void {
    if (this.apiKeyStatusEl) {
      this.apiKeyStatusEl.setText(apiKeyStatusText(state));
    }
  }

  /**
   * Answer "does this key work?" on the row itself — on render as well as on save, because a save
   * is the only other trigger and a key saved while offline would otherwise never be re-checked.
   *
   * Cached by the key it was about and expired by {@link API_KEY_RECHECK_MS}, so the re-renders
   * every other row on this screen provokes reuse the answer instead of firing a request apiece.
   * A check already in flight for the same key is likewise joined rather than duplicated.
   */
  private checkApiKey(): void {
    const key = (this.plugin.getApiKey() ?? "").trim();
    if (!key) {
      this.apiKeyCheck = null;
      this.paintApiKeyStatus({ kind: "absent" });
      return;
    }
    if (!looksLikeAnthropicKey(key)) {
      // A typo is not a network question — this costs no request.
      this.apiKeyCheck = { key, state: { kind: "malformed" }, at: Date.now() };
      this.paintApiKeyStatus({ kind: "malformed" });
      return;
    }

    const cached = this.apiKeyCheck;
    if (cached?.key === key) {
      const age = Date.now() - cached.at;
      // A check in flight is joined rather than duplicated — but only while it is plausibly
      // still in flight. A request that never settles would otherwise leave the row reading
      // "Checking" for the life of the tab, since nothing else ever expires that state.
      const fresh =
        cached.state.kind === "checking"
          ? age < API_KEY_CHECK_TIMEOUT_MS
          : age < API_KEY_RECHECK_MS;
      if (fresh) {
        this.paintApiKeyStatus(cached.state);
        return;
      }
    }

    this.apiKeyCheck = { key, state: { kind: "checking" }, at: Date.now() };
    this.paintApiKeyStatus({ kind: "checking" });
    void runApiKeyReachabilityCheck({ apiKey: key, request: this.deps.request })
      .then(apiKeyStateFromReport)
      // A thrown probe is still an answer: it means this device could not ask.
      .catch((): ApiKeyState => ({ kind: "unreachable" }))
      .then((state) => {
        // A newer key owns the row now; this result is about a question nobody is asking.
        if (this.apiKeyCheck?.key !== key) return;
        this.apiKeyCheck = { key, state, at: Date.now() };
        this.paintApiKeyStatus(state);
      });
  }

  private renderAutoRunSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Automatic filing (this device)");
    containerEl.createEl("p", {
      text: "Stored only on this device (not synced via data.json). Default off. Turning it on asks for a one-time acknowledgment — unattended runs send titles + captures to Anthropic.",
      cls: "setting-item-description",
    });

    const load = (k: string): unknown => loadLocal(this.app, k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);

    settingRow(containerEl, {
      name: "File automatically when Obsidian opens",
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
              // Two device-local booleans satisfy the egress gate, and this row is the only
              // surface that withdraws either. Clearing one would leave the other still
              // permitting "Sync everything now" — which the disclosure just above names.
              clearEgressNoticeAcked(save);
              this.redisplay();
            },
          }),
      });
    }

    settingRow(containerEl, {
      name: "Sync when you return to Obsidian",
      desc: "When you return to Obsidian, drain the inbox, apply the Ask outbox, push the mirror, and file if automatic filing is on. Device-local only. Manual Sync everything now still works when this is off.",
      control: {
        kind: "toggle",
        configure: (toggle) =>
          toggle.setValue(this.plugin.getResumeEnabled()).onChange((on) => {
            this.plugin.setResumeEnabled(on);
            this.redisplay();
          }),
      },
    });

    actionRow(containerEl, {
      name: "Sync everything now",
      desc: "Run drain → outbox → mirror → filing now (ignores resume cooldowns). Filing still needs the catch-up notice on Atoms home when present.",
      label: "Sync everything now",
      // Returned rather than fire-and-forget: that is what engages `actionRow`'s in-flight
      // guard, and a full sync is long enough that a second tap used to start a second one.
      onClick: () => this.plugin.runSyncEverythingNow(),
    });

    // Both are name-plus-value facts, which is what `statusRow` is for. As paragraphs they read
    // as prose the user has to parse for the value buried in it.
    if (state.lastRunDay) {
      statusRow(containerEl, {
        name: "Last auto-run day (this device)",
        value: state.lastRunDay,
      });
    }
    const catchLine = this.plugin.getLastCatchupLine();
    if (catchLine) {
      statusRow(containerEl, {
        name: LAST_CATCHUP_LABEL,
        // The formatter owns one line for Atoms home, which prints it whole. Splitting it on
        // the label it single-sources keeps the two surfaces saying the same thing.
        value: catchLine.slice(LAST_CATCHUP_LABEL.length + 1),
      });
    }
  }

  private renderModelSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Filing");

    settingRow(containerEl, {
      name: "Atom folder",
      desc: "Flat single folder for atom notes (e.g. Atoms). Paths with .. or subfolders are rejected.",
      control: {
        kind: "text",
        configure: (text) =>
          text
            .setPlaceholder("Atoms")
            .setValue(this.plugin.settings.atomFolder)
            .onChange(async (value) => {
              this.plugin.settings.atomFolder = clampAtomFolder(value);
              await this.plugin.saveSettings();
            }),
      },
    });

    settingRow(containerEl, {
      name: "List atoms in person notes",
      desc: "When on, Process / Update / backfill write a managed section at the end of person hub notes listing linked atoms under your existing headings. Your text outside the markers is never changed. If Ask mirror is on, updated hub notes sync vault→cloud like other linked hubs. Off by default.",
      control: {
        kind: "toggle",
        configure: (toggle) =>
          toggle
            .setValue(this.plugin.settings.enableHubProjection === true)
            .onChange(async (on) => {
              this.plugin.settings.enableHubProjection = on;
              await this.plugin.saveSettings();
            }),
      },
    });
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
    const activeSet = new Set(active.map(normalizeTag));
    // Filtered before the empty state is decided, not inside the render loop: a vault whose
    // every tag is already active ranks non-empty and still renders no rows, which used to
    // leave this heading sitting over nothing.
    const promotable = tagCountsSorted(counts)
      .slice(0, 30)
      .filter(({ tag }) => !activeSet.has(tag));

    if (promotable.length === 0) {
      containerEl.createEl("p", {
        text: counts.size
          ? "Every tag your vault uses is already active."
          : "No tags found in vault yet.",
        cls: "setting-item-description",
      });
    }

    for (const { tag, count } of promotable) {
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
   * What the mirror last did, from device-local stamps (N = last known server count).
   *
   * Read by two screens now — the main screen's entry row says it in one line, the destination
   * prints it above the rows that change it — so it is computed once here rather than twice.
   *
   * Named for the line it returns rather than for the mirror, because `askMirrorStatus` is
   * already the network call this file imports from `platform/plusClient`.
   */
  private mirrorStatusLine(sessionEmail: string): { line: string; failing: boolean } {
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
      sessionEmail ||
      "";
    return {
      line: formatAskMirrorStatusLine({
        serverCount,
        email: mirrorEmail,
        relativeLastOk: relative(lastOk),
        lastErr: refused ? "" : lastErr,
        refused,
      }),
      failing: Boolean(lastErr) || refused,
    };
  }

  /**
   * The Ask privacy ack on record, and the way back out of it.
   *
   * Its own method because it renders in two places — under the mirror toggle when signed in,
   * and on its own when signed out — and both must be the same row. Rendered off the timestamp
   * alone, never off the session or the toggle above it.
   */
  private renderAskPrivacyAckRecord(containerEl: HTMLElement): void {
    if (!this.plugin.settings.askPrivacyAckAt) return;
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
        // Before the save, so any handler still holding the granted state loses its DOM while
        // this is waiting on disk.
        this.redisplay();
        await this.plugin.saveSettings();
      },
    });
  }

  /** The vault-write ack on record. Withdrawing it leaves the mirror exactly as it was. */
  private renderAskWriteAckRecord(containerEl: HTMLElement): void {
    if (!this.plugin.settings.askWriteAckAt) return;
    this.renderAckRecord(containerEl, {
      name: ASK_WRITE_ACK_TITLE,
      at: this.plugin.settings.askWriteAckAt,
      disclosure: ASK_WRITE_DISCLOSURE,
      onWithdraw: () => this.setAskWriteAck(""),
    });
  }

  /**
   * Ask — remote MCP for Claude / ChatGPT (Plus). No in-plugin chat.
   */
  private renderAskSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Ask (Claude + ChatGPT)");
    const session = readPlusSession(this.app);

    containerEl.createEl("p", {
      text: "Cloud copy of Atoms/ on Plus — for chat search in Claude or ChatGPT. When Obsidian is open online, hand-edits and deletes push automatically. Full orphan cleanup is Sync now. Not a second library you maintain by hand.",
      cls: "setting-item-description",
    });

    if (!session) {
      containerEl.createEl("p", {
        text: "Sign in to Atoms Plus above first.",
        cls: "setting-item-description",
      });
      // Signing out leaves both acks on record — deliberately, so signing back in does not
      // re-ask. A consent on record with no way out is not a consent, and the next sign-in may
      // be a *different* Plus account, so the withdrawal surface outlives the session exactly
      // as the egress ack's does.
      this.renderAskPrivacyAckRecord(containerEl);
      this.renderAskWriteAckRecord(containerEl);
      return;
    }

    const ack = Boolean(this.plugin.settings.askPrivacyAckAt);
    settingRow(containerEl, {
      name: "Ask mirror",
      desc: "Keep the cloud Atoms/ copy current while Obsidian is open (vault events + Process/Update).",
      control: {
        kind: "toggle",
        configure: (tog) =>
          tog.setValue(this.plugin.settings.askEnabled).onChange((on) => {
            if (!on) {
              void this.setAskMirrorEnabled(false);
              return;
            }
            // Live rather than the render-time `ack` above: this handler can outlive the
            // screen it was built on — a withdrawal elsewhere leaves it holding a consent that
            // no longer exists, and it would re-enable the mirror without asking.
            if (this.plugin.settings.askPrivacyAckAt) {
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

    this.renderAskPrivacyAckRecord(containerEl);

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
              // Both preconditions checked here rather than resting on the invariant that the
              // mirror cannot be on without the privacy ack: this is the write site, and the
              // narrower consent must never be granted on top of one that is gone.
              if (
                !this.plugin.settings.askEnabled ||
                !this.plugin.settings.askPrivacyAckAt
              ) {
                new Notice("Turn on Ask mirror first");
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

    this.renderAskWriteAckRecord(containerEl);

    // The plumbing — connector URL, pairing, sync, status, wipe — is one destination now. Its
    // entry row carries the mirror's status line, so the main screen still says at a glance
    // whether the cloud copy is current.
    const status = this.mirrorStatusLine(session.email);
    destinationRow(containerEl, {
      name: DESTINATION_TITLES.connect,
      desc: status.line,
      onOpen: () => this.openRoute("connect"),
    });
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
        // Through the helper like every other destructive button: it prefers `setDestructive`
        // (Obsidian 1.13+) and falls back to `setWarning` against the manifest's 1.11.4 floor.
        markDestructive(btn.setButtonText("Delete from cloud")).onClick(() => {
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
