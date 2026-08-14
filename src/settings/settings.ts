import {
  App,
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
  readEgressAckVersion,
  setAutomaticFilingEnabled,
  writeAutoRunEnabled,
  writeEgressAck,
} from "../platform/autorun";
import {
  clearEgressNoticeAcked,
  LAST_CATCHUP_LABEL,
  readEgressNoticeAcked,
} from "../platform/resume";
import { CAPTURE_ATOM_VERSION } from "../shared/mobileInstall";
import {
  customCaptureShortcutUrl,
  labelCaptureShortcutCta,
  openShortcutInstallUrl,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "./captureShortcut";
import { markDestructive } from "./destructiveButton";
import { askSignOutAllApproval } from "./plusSignOutAllConfirmModal";
import {
  ackStampIsReal,
  settleAckRecords,
  type AckStanding,
  ASK_PRIVACY_ACK_VERSION,
  ASK_WRITE_ACK_VERSION,
  askAckStanding,
  askMirrorPermitted,
  askPrivacyAckIsCurrent,
  askWriteAckIsCurrent,
} from "../shared/askAck";
import {
  ASK_PRIVACY_ACK_TITLE,
  ASK_PRIVACY_DISCLOSURE,
  ASK_WRITE_ACK_TITLE,
  ASK_WRITE_DISCLOSURE,
  ConsentSheetModal,
  type ConsentSheetSpec,
  EGRESS_ACK_TITLE,
  egressConsentSpec,
} from "./consent";
import { clampAtomFolder } from "../pipeline/render";
import {
  actionRow,
  backRow,
  type ButtonRowSpec,
  confirmSheet,
  destinationRow,
  destructiveRow,
  formActionsRow,
  type FormActionsRowSpec,
  formRow,
  type FormRowSpec,
  group,
  InFlightActions,
  settingRow,
  statusRow,
} from "./rows";
import {
  API_KEY_SECRET_ID_DEFAULT,
  LOCAL_STORAGE_API_KEY,
} from "../shared/types";
import { formatUsd, PLUS_PRICING } from "../shared/plusPricing";
import {
  clearPlusSession,
  hasPlusSetupSession,
  latestPendingSignIn,
  parsePlusPlan,
  plusIsExhausted,
  plusLapse,
  readPlusSession,
  recordPendingSignIn,
  setAwaitingCheckout,

  type FilingAuth,
  type PlusEntitlementStatus,
  type PlusLapseKind,
  type PlusSession,
} from "../platform/filingAuth";
import { generateVerifier, hasWebCrypto, s256Challenge } from "../platform/pkce";
import {
  clearPlusRefreshRecord,
  plusRefreshPresentation,
  plusRefreshRowRecord,
  refreshPlusEntitlementRecord,
} from "../platform/plusRefresh";
import { openSettingsTab } from "../platform/obsidianSettings";
import { appHasDailyNotesPluginLoaded } from "obsidian-daily-notes-interface";
import {
  atomsPlusTopUpCopy,
  CORE_PLUGINS_SETTINGS_TAB_ID,
  firstDaySetupCopy,
  type SetupStep,
} from "../home/atomsHomeData";
import {
  DEFAULT_PLUS_BASE_URL,
  requestMagicLink,
  startPlusAccount,
  createCheckout,
  createBillingPortal,
  signOutPlus,
  signOutAllDevices,
  askMcpUrl,
  askMcpPair,
  askMirrorStatus,
  askMirrorWipe,
  plusFetchRequest,
} from "../platform/plusClient";
import {
  type AskMirrorOffReason,
  disarmAskMirror,
  formatAskMirrorStatusLine,
  formatAskMirrorServerCount,
  mirrorRefusalTitle,
  mirrorRefusalBody,
  readAskMirrorEmail,
  readAskMirrorRefusal,
  saveAskMirrorStatus,
  LS_ASK_MIRROR_LAST_ERROR,
  LS_ASK_MIRROR_LAST_SUCCESS,
} from "../platform/askMirror";
import { installPlusSession } from "../platform/plusSessionInstall";
import { fireAndForgetAsk } from "../shared/fireAndForget";
import { syncNowNotice } from "../shared/mirrorOutcome";
import type { ConfirmRequest, ConfirmVerdict } from "../shared/confirm";
import { requestUrl } from "obsidian";
import {
  addCustomActiveTag,
  approveProposedTag,
  checkCustomTag,
  normalizeTag,
  removeActiveTag,
  tagCountsSorted,
} from "../pipeline/vocabulary";

/** Public marketing + pricing page. Source lives in `www/` in this repo. */
export const ATOMS_SITE_URL = "https://tryatoms.app";

/** DIY Ask runbook. Advanced opens this so a non-Plus user can host plus-service. */
export const ATOMS_ASK_SELF_HOST_URL =
  "https://github.com/taihartman/obsidian-atoms/blob/master/docs/ask-self-host.md";

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
  | { kind: "subscribeIncomplete"; email: string }
  | { kind: "active"; status: PlusEntitlementStatus; remaining?: number }
  // `lapseKind`, not the raw plan: `plusLapse` already answered "trial or subscription", and
  // three surfaces read this state. Re-deriving it from `plan` at each of them is how two of
  // them end up disagreeing with the gate that decided it.
  | { kind: "periodEnded"; lapseKind: PlusLapseKind; endedOn?: string }
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
 *
 * An ended *period* outranks a spent *meter* (#442). They arrive as the same server `status`,
 * `exhausted`, but they are different situations wanting opposite offers: a spent meter refills
 * on the next billing date, while an ended period has no next billing date at all.
 *
 * The date alone does not decide it, because a monthly `periodEnd` is a *renewal* date — a
 * device holding a just-lapsed one during a renewal it has not refreshed through would
 * otherwise declare an active subscriber ended. So the past date must be joined by a reason it
 * cannot be a pending renewal: either the service already said `exhausted`, or the plan is a
 * trial, which never renews. The trial half is what lets a device notice its own expiry with no
 * round-trip — the gap that let #442 look healthy for 23 hours.
 */
export function deriveAccountState(
  auth: FilingAuth,
  session: PlusSession | null,
  now: number = Date.now(),
): AccountState {
  const lapse = plusLapse(auth, now);
  if (lapse) {
    return {
      kind: "periodEnded",
      lapseKind: lapse.kind,
      endedOn: lapse.endedOn,
    };
  }
  if (plusIsExhausted(auth)) return { kind: "exhausted" };
  if (auth.mode === "plus") {
    return { kind: "active", status: auth.status, remaining: auth.remaining };
  }
  if (hasPlusSetupSession(session) && session?.status === "inactive") {
    if (session.setupKind === "subscribe") {
      return { kind: "subscribeIncomplete", email: session.email };
    }
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
    case "subscribeIncomplete":
      return {
        name: "Finish Plus checkout",
        desc: `${state.email}. Complete subscription checkout. On the next page, tap Add promotion code.`,
      };
    case "active": {
      const base = state.status === "trialing" ? "Plus · Trial" : "Plus";
      const remaining =
        typeof state.remaining === "number"
          ? ` · ${state.remaining} filings left`
          : "";
      return { name: `${base}${remaining}` };
    }
    case "periodEnded": {
      const on = state.endedOn ? ` on ${state.endedOn.slice(0, 10)}` : "";
      // An unknown plan gets the neutral noun rather than a guess. A session stored before
      // `plan` was persisted would otherwise be told a subscription ended that it never had.
      const what =
        state.lapseKind === "trial"
          ? { name: "Trial ended", subject: `Your free trial ended${on}` }
          : state.lapseKind === "subscription"
            ? {
                name: "Subscription ended",
                subject: `Your subscription ended${on}`,
              }
            : {
                name: "Plus ended",
                subject: `Your Atoms Plus period ended${on}`,
              };
      return {
        name: what.name,
        desc: `${what.subject}. Subscribe to file captures again and to let Claude and ChatGPT reach your atoms. Have a promo code? Enter it at checkout.`,
      };
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
 * Whether to spend a request on what was typed into an email form, saying so when the answer is
 * no. Shared by the trial and the sign-in link so the two cannot drift into refusing the same
 * address with two different sentences.
 */
function requireEmail(email: string): boolean {
  if (email.includes("@")) return true;
  new Notice("Enter a valid email first");
  return false;
}

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
  | "engine"
  | "account"
  | "vocabulary"
  | "connect"
  | "advanced";

/**
 * The screen's opening statement, in its two shapes (R18).
 *
 * Nobody files yet, so the screen says what Atoms is for before it offers a single control (R9);
 * or somebody does, so it says filing is on and when the first atoms land, because day one is
 * deliberately silent and silence reads as breakage (R12).
 */
const STATUS_GROUP = {
  unconfigured: {
    header: "Get started",
    footer:
      "Atoms reads thoughts you already wrote and files each one as its own note, linked to the people and topics it mentions.",
  },
  filing: {
    header: "Status",
    footer:
      "Atoms waits until a day is done, so it never files a thought you are still writing.",
  },
} as const;

/** The status group's own name for the automatic-filing toggle it borrows from the File leg. */
const FILING_ROW_NAME = "File automatically";

/**
 * What the filing row says under its name, by what the device is actually doing.
 *
 * The day-one line is the point of the whole group: enabling stamps the filing window at today
 * and every pass excludes today, so nothing lands until tomorrow. It retires itself the moment a
 * run is on the books, because by then it would be a small lie.
 */
const FILING_STATE_DESC = {
  dayOne: "First atoms arrive tomorrow morning.",
  running: "Atoms files each past day when Obsidian opens.",
  off: "Atoms files a past day only when you ask it to.",
} as const;

/** Which of the three lines this device has earned, by whether it runs and whether it has run. */
function filingStateDesc(on: boolean, hasRun: boolean): string {
  if (!on) return FILING_STATE_DESC.off;
  return hasRun ? FILING_STATE_DESC.running : FILING_STATE_DESC.dayOne;
}

/** When the next unattended pass happens. Same promise as the day-one line, as a fact. */
const NEXT_RUN_ROW = {
  name: "Next run",
  value: "Tomorrow, when Obsidian opens.",
} as const;

/**
 * The two legs the main screen can actually hold controls for (R1).
 *
 * Named for `docs/architecture.md` § North star rather than for a vocabulary this screen invents,
 * and numbered the way `docs/design-handoff/settings/overhaul.html` numbers them, so the eyebrows
 * read as one sequence instead of three unrelated labels.
 *
 * Each footer is the group's whole explanation, written once for every row above it — which is
 * what lets a row go back to a name and a control (R2). Capture's carries the fact no other
 * surface states: the plugin captures nothing, ever (R10). It also keeps the word "top-level",
 * which is the R19 carve-out on this group: `isContinuationLine` (`src/pipeline/parse.ts:41`)
 * folds an indented bullet into the capture above it silently, so a footer that said "write a
 * bullet" would leave the user with no way to predict why two thoughts became one atom. File's
 * carries the trust question a new
 * user actually has, and it has to name all three things Atoms writes, because a promise that
 * names two of them is the kind of near-miss that gets found later by someone reading a diff
 * (R11). Its last sentence is the one rule the restructure could not drop: automatic filing starts
 * with the next day and never walks backwards on its own.
 */
const CAPTURE_GROUP = {
  header: "1 · Capture",
  footer:
    "Atoms never captures for you. Write a top-level bullet in your daily note, like “- Alex likes periwinkle”, or add the phone shortcut and say one out loud. An indented bullet is read as part of the one above it.",
} as const;

const FILE_GROUP = {
  header: "2 · File",
  footer:
    "What you wrote is never rewritten. Atoms only adds new atom files, one small marker line under the capture it read, and a list inside its own marked block on hub notes. Older captures wait until you backfill them from Atoms home.",
} as const;

/**
 * The File group's own name and line for the automatic-filing toggle, on the installs where the
 * status group has not taken it.
 *
 * The line says when the *window* opens rather than when atoms arrive: this is the branch where
 * nobody files yet, so promising an arrival would be promising something no engine can deliver.
 * The status group's day-one promise is the other half of the same pair, and the two never render
 * together — `nextSetupStep()` decides which home the toggle has, so only one of them is on
 * screen and the screen states the day-one rule exactly once.
 */
const FILING_ROW_UNCONFIGURED = {
  name: "File automatically when Obsidian opens",
  desc: "Filing starts with tomorrow's note, on this device.",
} as const;

/**
 * The engine screen: the one decision Atoms cannot make for anybody, with room to say what it
 * costs. Mock SSOT `docs/design-handoff/settings/overhaul.html` § Who does the filing.
 *
 * One claim from the mock is not here, because it is not true. "Nothing here unlocks features" is
 * false the moment Ask is considered: Ask needs a session from the Atoms service (R13), so the
 * choice is not purely about who pays. The footer says only the part that holds — filing itself
 * is identical either way.
 *
 * The price is real but is never a literal: `plus-pricing.json` is the SSOT and
 * `src/shared/plusPricing.ts` is the only thing allowed to format it, which is why the footer is
 * a function. A number typed into this file is a copy that goes stale in silence.
 */
const ENGINE_SCREEN = {
  lead: "Atoms sends each capture to Anthropic to be titled and linked. Somebody has to pay for that: us, or you.",
  pickOne: {
    header: "Pick one",
    footer: () =>
      `Filing works the same either way. Atoms Plus is ${PLUS_PRICING.trialDays} days free, then ${formatUsd(PLUS_PRICING.monthlyUsd)} a month. Your own key bills you at Anthropic's rates instead.`,
  },
  /**
   * The egress facts as three lines rather than one paragraph, so a reader can check them one at
   * a time. Each is a promise the code keeps: `EGRESS_DISCLOSURE` clause (1) is what leaves,
   * `ContextProvider` sends titles and never bodies, and every pass excludes today unless the
   * user forces it. The footer points at the sheet rather than restating it, because the sheet is
   * versioned (KTD5) and a second copy of versioned wording is the #315 shape.
   */
  whatGetsSent: {
    header: "What gets sent",
    footer:
      "You will see the full wording, and have to accept it, before Atoms files on its own.",
    lines: [
      "Each capture, and your note titles, over TLS",
      "Never the body of another note, and never your whole vault",
      "Nothing from today, unless you ask for it",
    ],
  },
} as const;

/** Whether the vault's Daily Notes plugin is on. The Capture leg's one derived value (R20). */
const DAILY_NOTES_ROW = { name: "Daily notes", on: "On", off: "Off" } as const;

/** Destination title, shown on its entry row and again on its back row. */
const DESTINATION_TITLES: Record<Exclude<SettingsRoute, "main">, string> = {
  engine: "Who does the filing",
  account: "Account",
  vocabulary: "Tag vocabulary",
  connect: "Connect Claude or ChatGPT",
  advanced: "Advanced",
};

/**
 * What an ack record says about the wording it names, appended to "Acknowledged <day>".
 *
 * A current grant says nothing extra — the common case earns no words. The other two say which
 * way the record is out of step, borrowing the egress review row's own distinction: a grant that
 * named no wording at all was made against text that is now *earlier*, while a stamp this build
 * does not recognise may well name text that is later, so it is merely *different*.
 */
const ACK_STANDING_SUFFIX: Record<AckStanding, string> = {
  current: "",
  legacy: ", against earlier wording",
  other: ", against different wording",
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
  /**
   * What is running right now, by action rather than by button. Lives on the tab because every
   * button is minted fresh by `display()`: a guard held on the component dies at the next
   * `redisplay()` or `openRoute()`, which is one impatient tap-back-and-in away.
   */
  private readonly inFlight = new InFlightActions();

  /**
   * The button-carrying row builders, bound to this tab's registry. Wrapped rather than passed at
   * each of the two dozen call sites so a row cannot be built without a guard, and so `rows.ts`
   * stays a set of free functions with no idea a settings tab exists.
   */
  private actionRow(containerEl: HTMLElement, row: ButtonRowSpec): void {
    actionRow(containerEl, { ...row, inFlight: this.inFlight });
  }

  private destructiveRow(containerEl: HTMLElement, row: ButtonRowSpec): void {
    destructiveRow(containerEl, { ...row, inFlight: this.inFlight });
  }

  private formRow(containerEl: HTMLElement, row: FormRowSpec): void {
    formRow(containerEl, {
      ...row,
      submit: { ...row.submit, inFlight: this.inFlight },
    });
  }

  private formActionsRow(containerEl: HTMLElement, row: FormActionsRowSpec): void {
    formActionsRow(containerEl, {
      ...row,
      submits: row.submits.map((submit) => ({ ...submit, inFlight: this.inFlight })),
    });
  }

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
    // Walking to another screen settles an open sheet the same way closing Settings does: a
    // decline. Without this the sheet a main-screen row posed outlived the screen that posed
    // it, and accepting it from inside a destination still wrote the ack — a consent granted
    // on a screen the user had already left. `hide()` has always done this; this is the one
    // other screen change, and it was the one that did not.
    // That decline re-renders the screen we are leaving, which queues a restore of *its* scroll
    // position — and the queued restore lands after the `scrollTop = 0` below, dropping the user
    // mid-page on a screen they have not seen. `hiding` is the latch that already suppresses a
    // re-render nobody will look at; `display()` clears it.
    this.hiding = true;
    this.settleOpenSheet();
    this.route = route;
    this.display();
    const scroller = this.settingsScrollEl();
    if (scroller) scroller.scrollTop = 0;
  }

  /**
   * Settle a consent sheet the user is walking away from.
   *
   * Closing without choosing is a decline, not a half-written ack: `close()` reaches the sheet's
   * `onClose`, which settles it the same way Escape does. Every screen change that can strand a
   * sheet goes through here — leaving Settings, walking to another route, and an external
   * withdrawal rebuilding the screen underneath it (#323). Three copies of this pair is how one
   * of them ends up forgotten.
   */
  private settleOpenSheet(): void {
    this.openSheet?.close();
    this.openSheet = null;
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
    this.settleOpenSheet();
    // Off screen: an external change has nothing to re-render, and the next `display()` reads
    // the reloaded settings anyway. The identity check is ordering defense, not ceremony — a
    // `display()` that lands before the outgoing tab's `hide()` would otherwise be deregistered
    // by the tab it replaced. `hiding` cannot stand in for this field: it starts false, so
    // before the first `display()` it would claim a screen that was never opened.
    if (this.plugin.settingTab === this) this.plugin.settingTab = null;
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
   *
   * Rendered from the timestamp, never from `version`. A grant whose version has gone stale no
   * longer opens the gate, but it is still a record on this device, and keying this row to the
   * version would take away the only surface that can withdraw it — the mistake the egress row
   * (auto-run section below) documents at length. What the version changes is the *sentence*:
   * it says which wording the record actually names, so the row never claims on the user's
   * behalf that they read text this build no longer shows.
   */
  private renderAckRecord(
    containerEl: HTMLElement,
    record: {
      name: string;
      at: string;
      disclosure: string;
      standing: AckStanding;
      onWithdraw: () => void | Promise<void>;
    },
  ): void {
    // Never `record.at.slice` — the field is typed `string` but sourced from `data.json`, and a
    // hand-edited `true` would throw here. This method runs *before* the auto-run section, so
    // one bad value would take out the egress ack's withdrawal row too: a gate with nothing on
    // screen to close it, which is the exact failure the ack predicates exist to prevent.
    const day = ackStampIsReal(record.at) ? record.at.slice(0, 10) : "";
    const desc = `Acknowledged ${day}${ACK_STANDING_SUFFIX[record.standing]}`;
    this.actionRow(containerEl, {
      action: `ack:review:${record.name}`,
      name: record.name,
      desc,
      label: "Review",
      onClick: () =>
        this.presentConsent({
          title: record.name,
          disclosure: record.disclosure,
          granted: `${desc}.`,
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
    if (!enabled) this.writeAskAck("write", false);
    // Ahead of the save, so a withdrawal that lands during it has already destroyed the DOM
    // whose handlers still close over the state this gesture was rendered under.
    this.redisplay();
    await this.plugin.saveSettings();
    // Read live rather than from `enabled`: the save is an await, and a withdrawal landing
    // inside it turns both the consent and the mirror off. The push is the egress itself, so
    // it answers to the state now, not to the gesture that started it.
    if (askMirrorPermitted(this.plugin.settings)) {
      fireAndForgetAsk(this.plugin.syncAskMirror({ force: false }));
    }
  }

  /**
   * Record — or withdraw — an ack in memory, both halves at once.
   *
   * *When* and *what* are written together at every site, so the two can never disagree about
   * whether a grant exists. The pairing lives here rather than at each grant and each
   * withdrawal: a screen that cleared a timestamp and left its version standing would hold a
   * withdrawn consent still naming current wording, and the next enable would find a stamp it
   * never wrote and grant without posing the sheet.
   *
   * These two fields and nothing else. What each ack additionally implies — the mirror toggle,
   * the narrower consent that cannot outlive the broader one, the save — stays at its call
   * site, because it differs per ack and folding it in here would hide it.
   */
  private writeAskAck(ack: "privacy" | "write", granted: boolean): void {
    const s = this.plugin.settings;
    const at = granted ? new Date().toISOString() : "";
    if (ack === "privacy") {
      s.askPrivacyAckAt = at;
      s.askPrivacyAckVersion = granted ? ASK_PRIVACY_ACK_VERSION : "";
      return;
    }
    s.askWriteAckAt = at;
    s.askWriteAckVersion = granted ? ASK_WRITE_ACK_VERSION : "";
  }

  /** Grant (stamped now) or withdraw the consent for Claude or ChatGPT to write here. */
  private async setAskWriteAck(granted: boolean): Promise<void> {
    this.writeAskAck("write", granted);
    // Ahead of the save, so a withdrawal that lands during it has already replaced the screen
    // whose handlers still hold the granted state.
    this.redisplay();
    await this.plugin.saveSettings();
    // Live, for the same reason the mirror push is: applying the outbox writes files, and the
    // ack authorizing that may have been withdrawn while this was waiting on disk.
    if (askWriteAckIsCurrent(this.plugin.settings)) {
      fireAndForgetAsk(this.plugin.applyAskOutbox());
    }
  }

  /**
   * Re-render because `data.json` changed underneath us — a consent withdrawn on another
   * device (#323). `redisplay()` already declines while the tab is closing.
   *
   * The sheet settles first, for the reason `hide()` and `openRoute()` settle it: the state
   * it was posed under has just been replaced, so accepting it would write an ack answering a
   * question that is no longer on screen. Leaving it open would float a consent decision above
   * a rebuilt DOM that already shows the remote withdrawal.
   */
  refreshFromExternalSettings(): void {
    this.settleOpenSheet();
    this.redisplay();
  }

  /**
   * Imperative settings UI. Declarative PluginSettingTab.getSettingDefinitions
   * (Obsidian 1.13+ settings search) is a separate migration — not this claim.
   */
  display(): void {
    // A real render is what re-opens the tab, whether it is Obsidian showing it again or a
    // route walk. Anything that arrived late from the last visit has already been dropped.
    this.hiding = false;
    // On screen from here, so an external settings change knows there is something to refresh.
    this.plugin.settingTab = this;
    const { containerEl } = this;
    containerEl.empty();
    // Emptying the container detaches whatever element the key check was painting into, and only
    // the engine screen makes a new one. Without this, a check that settles after the user walks
    // away would paint a verdict into a node nobody can see, and the next visit to the engine
    // screen would find a live-looking handle onto a detached element.
    this.apiKeyStatusEl = null;

    const route = this.route;
    switch (route) {
      case "main":
        this.renderMainScreen(containerEl);
        return;
      case "engine":
        this.renderDestination(containerEl, route, (el) => this.renderEngineDestination(el));
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
    this.actionRow(containerEl, {
      action: "ask:copy-mcp-url",
      name: "MCP connector URL",
      desc: `${mcpUrl}. Same URL for both. Claude: Customize → Connectors → + → Add custom connector. ChatGPT: Settings → Apps → Advanced settings → Developer mode, then Apps → Create. Paste this URL and complete OAuth.`,
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

    this.actionRow(containerEl, {
      action: "ask:pairing-code",
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

    this.actionRow(containerEl, {
      action: "ask:sync-now",
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

    this.actionRow(containerEl, {
      action: "ask:mirror-status",
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

    this.destructiveRow(containerEl, {
      action: "ask:wipe-cloud-copy",
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
        text: "Wipe cloud atom mirror, pending Ask writes, and revoke Ask connector access (Claude + ChatGPT)? Local vault files are kept. Ask mirror turns off, so nothing uploads again until you turn it back on.",
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
                // An emptied cloud must leave no arming and no baseline behind it (#371).
                await this.disarmAskMirror();
                new Notice("Ask mirror wiped and turned off");
                this.redisplay();
              })().finally(resolve);
            }),
        );
      modal.open();
    });
  }

  /** Shared teardown host — Sign out, Wipe, and session install (#393) share one sequence. */
  private askMirrorDisarmHost() {
    return {
      settings: this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      mirrorPermitted: () => this.plugin.ask.mirrorPermitted(),
      cancelPendingSync: () => this.plugin.ask.cancelPendingSync(),
      saveLocalStorage: (k: string, v: string) => this.app.saveLocalStorage(k, v),
      loadLocalStorage: (k: string): unknown => this.app.loadLocalStorage(k),
    };
  }

  private async disarmAskMirror(): Promise<void> {
    await disarmAskMirror(this.askMirrorDisarmHost());
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
   * and the toggle is also the only thing that deletes the stored key. R5 puts both on the engine
   * destination, beside the key field they answer for.
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
        configure: (text) => {
          // Block body: Obsidian components are thenable; returning the chain trips misused-promises.
          text
            .setPlaceholder("claude-sonnet-5")
            .setValue(this.plugin.settings.model)
            .onChange((value) => {
              this.plugin.settings.model = value.trim() || "claude-sonnet-5";
              void this.plugin.saveSettings();
            });
        },
      },
    });

    // Override only for local dogfood. Shipping builds leave this empty → DEFAULT_PLUS_BASE_URL.
    settingRow(containerEl, {
      name: "Plus service URL override",
      desc: `Empty = production (${DEFAULT_PLUS_BASE_URL}). Plugin can use http://127.0.0.1:8787. Claude and ChatGPT need the public HTTPS origin.`,
      control: {
        kind: "text",
        configure: (text) => {
          text
            .setPlaceholder(DEFAULT_PLUS_BASE_URL)
            .setValue(this.plugin.settings.plusBaseUrl)
            .onChange((value) => {
              this.plugin.settings.plusBaseUrl = value.trim();
              void this.plugin.saveSettings();
            });
        },
      },
    });

    this.actionRow(containerEl, {
      action: "ask:open-self-host-guide",
      name: "DIY Ask guide",
      desc: "Run plus-service on your machine so Claude or ChatGPT never hit plus.tryatoms.app.",
      label: "Open",
      onClick: () => {
        window.open(ATOMS_ASK_SELF_HOST_URL, "_blank");
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

    // Decided once and handed to both groups: the same answer says what the status group is
    // *for* and whether the File group still holds the automatic-filing toggle. Asking twice is
    // how the two halves of that seam would eventually disagree.
    const step = this.nextSetupStep();

    // Whether Atoms is filing, before anything the screen offers to change (R18).
    this.renderStatusGroup(containerEl, step);

    // The product's own legs, in the product's own order (R1): what you write, then what Atoms
    // does with it. Everything below them is still a heading, because the units that group the
    // Resurface leg and fold the records and diagnostics away have not landed yet.
    this.renderCaptureGroup(containerEl);
    this.renderFileGroup(containerEl, step);
    this.renderAskSection(containerEl);
    this.renderAutoRunSection(containerEl);
    this.renderAdvancedEntry(containerEl);
  }

  /**
   * The one step still unfinished, or null when Atoms can file.
   *
   * Read out of `firstDaySetupCopy` rather than decided here (KTD11): Atoms home's first-day wall
   * answers the same question, and the moment this screen keeps its own list the two drift.
   */
  private nextSetupStep(): SetupStep | null {
    return firstDaySetupCopy(
      appHasDailyNotesPluginLoaded(),
      this.plugin.resolveFilingAuth().mode !== "none",
    ).nextStep;
  }

  /**
   * The screen's first element: whether Atoms is filing, and the single step when it is not.
   *
   * Two variants, not one variant with an empty slot. Nobody files yet, so the group says what
   * Atoms does and names one thing to do; or somebody does, so it says filing is on and when the
   * first atoms land. The second variant borrows the automatic-filing toggle from the File leg,
   * which is why `step` arrives as an argument rather than being read here: the File composition
   * is state-dependent on the same answer, and one answer cannot disagree with itself.
   *
   * No fill, no tint, no border: setup state is not transient, so the token system's soft-fill
   * carve-out does not reach it (R14). Position is the emphasis.
   */
  private renderStatusGroup(containerEl: HTMLElement, step: SetupStep | null): void {
    if (step) {
      group(containerEl, {
        ...STATUS_GROUP.unconfigured,
        render: (groupEl) => {
          destinationRow(groupEl, {
            name: step.name,
            desc: "Required",
            onOpen: () => {
              if (step.kind === "daily_notes") {
                openSettingsTab(this.app, CORE_PLUGINS_SETTINGS_TAB_ID);
                return;
              }
              // The step is "choose who files", so it lands on the screen that asks exactly
              // that. It used to open Account, which offered one of the two answers and never
              // named the other.
              this.openRoute("engine");
            },
          });
        },
      });
      return;
    }
    const state = readDeviceAutoRunState((k) => loadLocal(this.app, k));
    const on = state.enabled && state.egressAcked;
    group(containerEl, {
      ...STATUS_GROUP.filing,
      render: (groupEl) => {
        this.renderAutomaticFilingRow(groupEl, {
          name: FILING_ROW_NAME,
          desc: filingStateDesc(on, Boolean(state.lastRunDay)),
        });
        if (on) statusRow(groupEl, { ...NEXT_RUN_ROW });
      },
    });
  }

  /**
   * Leg one: everything the user does, and nothing Atoms does.
   *
   * Two of its three rows still carry prose. That is R19 rather than an oversight: the iCloud
   * link rule only matters to somebody who forked the recipe, and the shortcut's six-step iOS
   * procedure is a wizard in a caption that a footer cannot hold and a later unit turns into a
   * sheet. A rule the user needs to predict behavior is never deleted by a footer sweep.
   */
  private renderCaptureGroup(containerEl: HTMLElement): void {
    group(containerEl, {
      ...CAPTURE_GROUP,
      render: (groupEl) => {
        statusRow(groupEl, {
          name: DAILY_NOTES_ROW.name,
          value: appHasDailyNotesPluginLoaded()
            ? DAILY_NOTES_ROW.on
            : DAILY_NOTES_ROW.off,
        });
        this.renderCaptureShortcutRows(groupEl);
      },
    });
  }

  /**
   * Leg two: everything Atoms does with what it finds.
   *
   * The automatic-filing toggle is here only while the status group has not taken it — the same
   * seam from the other side. Order follows the mock: who files, whether it runs on its own,
   * where atoms land, what they may be tagged, and what gets listed on hub notes.
   */
  private renderFileGroup(containerEl: HTMLElement, step: SetupStep | null): void {
    group(containerEl, {
      ...FILE_GROUP,
      render: (groupEl) => {
        this.renderEngineRow(groupEl);
        if (step) {
          this.renderAutomaticFilingRow(groupEl, { ...FILING_ROW_UNCONFIGURED });
        }
        this.renderAtomFolderRow(groupEl);
        this.renderVocabularyEntry(groupEl);
        this.renderHubListRows(groupEl);
      },
    });
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

  /**
   * Copy for the signed-out Email cluster. A device that cannot complete the
   * handoff says so up front and names the fallback (R19). Otherwise the emailed
   * link is only described once one has been requested (R15). The idle line
   * names sign-in, trial, and promo code on the one field.
   */
  private accountEmailDesc(): string {
    if (!hasWebCrypto()) {
      return "This device can't sign itself in from an emailed link. Send one anyway, then finish with Advanced: paste session below.";
    }
    return latestPendingSignIn(this.app)
      ? "Link sent. Open it in the email on this device and Obsidian signs itself in. Send another if it has expired."
      : "Sign in, start a trial, or use a promo code. On checkout, tap Add promotion code.";
  }

  /** This vault's name — what the link is bound to, and what the landing page shows. */
  private vaultName(): string {
    const vault = (this.app as { vault?: { getName?: () => string } }).vault;
    return vault?.getName?.() ?? "";
  }

  /**
   * Shared magic-link request — signed-out form and the expired-session row.
   *
   * Every request mints a fresh device-held verifier and registers its hash
   * against the token, so only this vault can redeem the link. The record is
   * prepended, never replaced: tapping twice must leave the first link still
   * redeemable (U7).
   *
   * A device with no WebCrypto still gets its link — locking sign-in out would
   * be worse than the paste fallback — but the link goes unbound, so the landing
   * page will offer no handoff. That outcome is announced, never swallowed: a
   * silent unbound send drops the user in exactly the dead end #240 exists to
   * remove (R19). The capability is probed rather than caught, so any other
   * failure still surfaces instead of being read as "this device can't".
   */
  private async sendPlusMagicLink(email: string): Promise<void> {
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const vault = this.vaultName();
    const canSignInFromLink = hasWebCrypto();
    let verifier: string | null = null;
    let verifierHash: string | undefined;
    if (canSignInFromLink) {
      verifier = generateVerifier();
      verifierHash = await s256Challenge(verifier);
    }
    const r = await requestMagicLink(
      { baseUrl: base, request: plusFetchRequest },
      email,
      { verifierHash, vault },
    );
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    if (verifier) recordPendingSignIn(this.app, { verifier, vault });
    new Notice(
      canSignInFromLink
        ? "Sign-in link sent. Open it in your email on this device and Obsidian signs itself in."
        : "Sign-in link sent, but this device can't sign itself in from a link. Open the link, then paste the session it shows you into Advanced: paste session below.",
      10000,
    );
  }

  /**
   * Inline result of the last entitlement refresh. An expired session gets the
   * sign-in link right here — no hunting for "Advanced: paste session".
   */
  private renderPlusRefreshOutcome(containerEl: HTMLElement): void {
    const record = plusRefreshRowRecord(this.app);
    if (!record) return;
    const view = plusRefreshPresentation(record);
    const email = record.email;
    if (view.recovery === "magic-link" && email) {
      this.actionRow(containerEl, {
        action: "plus:magic-link",
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

  /**
   * Start a paid subscription for the session on this device — the way back from an ended
   * period.
   *
   * `subscribe_monthly`, not `start_trial`: the service refuses a second trial once
   * `trial_used` is set (plus-service/src/server.mjs), so the trial route is a 409 for exactly
   * the people who see this row. Until #442 the plugin never asked for this kind at all, which
   * left an expired trial with no path to paying without leaving the app.
   *
   * Confirms the lapse against the service before charging anyone. The row is drawn from a
   * stored snapshot, and `subscribe_monthly` has no server-side already-subscribed guard — only
   * `start_trial` is checked — so a snapshot that has gone stale against a renewal would
   * otherwise open a second subscription on a live account.
   */
  private async openSubscribeCheckout(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) {
      new Notice("No Plus session on this device");
      return;
    }
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const cfg = { baseUrl: base, request: plusFetchRequest };
    const record = await refreshPlusEntitlementRecord(this.app, cfg, session);
    // Only a confirmed answer may cancel the charge. An unreachable service must not strand a
    // genuinely lapsed user on a button that refuses to work.
    if (record.kind === "ok" && !plusLapse(this.plugin.resolveFilingAuth())) {
      new Notice("Atoms Plus is already active on this account.", 6000);
      this.redisplay();
      return;
    }
    const r = await createCheckout(cfg, session.sessionToken, "subscribe_monthly");
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    setAwaitingCheckout(this.app, true);
    window.open(r.url, "_blank");
    new Notice(
      "Complete checkout in the browser, then return here — status updates automatically.",
      8000,
    );
    this.redisplay();
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
    // Local teardown first. Awaiting the server revoke *before* disarm left the mirror
    // permitted for the whole RTT, so an in-flight pass kept pushing chunks after Sign out
    // (#372 live QA). Network is best-effort against a token we are about to drop.
    await this.disarmAskMirror();
    clearPlusSession(this.app);
    clearPlusRefreshRecord(this.app);
    if (session) {
      const base =
        this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
      await signOutPlus(
        { baseUrl: base, request: plusFetchRequest },
        session.sessionToken,
      );
    }
    new Notice("Atoms Plus signed out on this device");
    this.redisplay();
  }

  /** #320 — confirm, then revoke every session + MCP (including this device). */
  private async signOutAllDevicesOfPlus(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) {
      new Notice("No Plus session on this device");
      return;
    }
    const verdict = await askSignOutAllApproval(this.app, session.email);
    if (verdict !== "confirmed") return;
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const r = await signOutAllDevices(
      { baseUrl: base, request: plusFetchRequest },
      session.sessionToken,
    );
    await this.disarmAskMirror();
    clearPlusSession(this.app);
    clearPlusRefreshRecord(this.app);
    if (!r.ok) {
      new Notice(
        `Signed out locally. Server said: ${r.message || "request failed"}`,
        8000,
      );
    } else {
      new Notice("Signed out on every device");
    }
    this.redisplay();
  }

  private accountState(): AccountState {
    return deriveAccountState(
      this.plugin.resolveFilingAuth(),
      readPlusSession(this.app),
    );
  }

  /**
   * Who files the captures — the File leg's first row, and the one decision Atoms cannot make.
   * Mock SSOT docs/design-handoff/settings/overhaul.html § 2 · File.
   *
   * The row names the *question* and spends its subtitle on the current answer, which is the
   * swap U4 makes: while the row was the account row it was named for the account's state, so an
   * install with an Anthropic key and no Plus session read "Set up automatic filing" on a screen
   * where filing was already set up. Naming the decision lets the answer be whatever it is, and
   * it always spends a subtitle rather than rendering the question blank (R20).
   */
  private renderEngineRow(containerEl: HTMLElement): void {
    destinationRow(containerEl, {
      name: DESTINATION_TITLES.engine,
      desc: this.engineAnswer(),
      onOpen: () => this.openRoute("engine"),
    });
  }

  /**
   * What is filing right now, in the fewest words that are true.
   *
   * Signed out is the only state that says nothing about the engine, and it is also the state
   * where the answer is genuinely two-valued: an install with an Anthropic key is filing
   * perfectly well without a Plus session and must not be told nothing is chosen. Every other
   * state already names the engine and the condition it is in ("Plus · 12 filings left", "Trial
   * ended"), so it borrows `accountRowDescriptor` rather than keeping a second table of those
   * words (KTD7).
   */
  private engineAnswer(): string {
    const state = this.accountState();
    if (state.kind !== "signedOut") return accountRowDescriptor(state).name;
    return this.plugin.resolveFilingAuth().mode === "none" ? "Not chosen" : "Your own key";
  }

  /**
   * The screen behind the engine row: both ways to pay for filing, and what leaves the device
   * either way.
   *
   * One group rather than two, because "pick one" is one decision: Atoms Plus is a chevron into
   * the account screen that manages it, and the other option is not a chevron at all — it is the
   * key field itself, because pasting a key *is* choosing it. The device-local pair sits with the
   * field it answers for and is the only thing that deletes the stored key, which is why R5 keeps
   * it beside a credential rather than filing it under Advanced as plumbing.
   *
   * The Plus row keeps the account state's own label. It is the row that walks into the account
   * screen, so what it says about that account is the same sentence `accountRowDescriptor`
   * already owns for every state (KTD7).
   */
  private renderEngineDestination(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: ENGINE_SCREEN.lead,
      cls: "setting-item-description",
    });

    const account = accountRowDescriptor(this.accountState());
    group(containerEl, {
      header: ENGINE_SCREEN.pickOne.header,
      footer: ENGINE_SCREEN.pickOne.footer(),
      render: (groupEl) => {
        destinationRow(groupEl, {
          name: account.name,
          desc: account.desc,
          onOpen: () => this.openRoute("account"),
        });
        this.renderKeyRows(groupEl);
      },
    });

    group(containerEl, {
      header: ENGINE_SCREEN.whatGetsSent.header,
      footer: ENGINE_SCREEN.whatGetsSent.footer,
      render: (groupEl) => {
        for (const name of ENGINE_SCREEN.whatGetsSent.lines) {
          statusRow(groupEl, { name });
        }
      },
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
    const setupIncomplete =
      state.kind === "trialIncomplete" || state.kind === "subscribeIncomplete";
    const email = setupIncomplete ? state.email : (session?.email ?? "");
    // "Signed in as", not "Account": the back row leading this screen is already named Account.
    if (email) statusRow(containerEl, { name: "Signed in as", value: email });
    if (!setupIncomplete) {
      statusRow(containerEl, {
        name: "Plan",
        // "Renews" is a promise, and a date already in the past cannot keep it. An ended
        // period says so instead — it was labelling its own expiry a renewal (#442).
        value: state.kind === "periodEnded"
          ? `Ended ${state.endedOn?.slice(0, 10) ?? "— see Subscribe"}`
          : session?.periodEnd
            ? `Renews ${session.periodEnd.slice(0, 10)}`
            : "Monthly or yearly — see Manage subscription",
      });
    }

    if (state.kind === "trialIncomplete") {
      this.actionRow(containerEl, {
        action: "plus:trial-checkout",
        name: "Finish trial setup",
        desc: "Complete Stripe checkout (card for the 14-day trial). Return here and status updates automatically.",
        label: "Finish trial setup",
        onClick: () => this.finishTrialCheckout(),
      });
    }
    if (state.kind === "subscribeIncomplete") {
      this.actionRow(containerEl, {
        action: "plus:promo-subscribe-checkout",
        name: "Finish Plus checkout",
        desc: "Complete subscription checkout. On the next page, tap Add promotion code.",
        label: "Finish Plus checkout",
        onClick: () => this.finishSubscribeCheckout(),
      });
    }
    if (state.kind === "periodEnded") {
      this.actionRow(containerEl, {
        action: "plus:subscribe-checkout",
        name: "Subscribe",
        desc: accountRowDescriptor(state).desc ?? "",
        label: "Subscribe",
        onClick: () => this.openSubscribeCheckout(),
      });
    }
    if (state.kind === "exhausted") {
      this.actionRow(containerEl, {
        action: "plus:top-up-checkout",
        name: "Get more filings",
        desc: "Buy additional filings now instead of waiting for your next billing date.",
        label: "Get more",
        onClick: () => this.openTopUpCheckout(),
      });
    }

    this.actionRow(containerEl, {
      action: "plus:refresh-status",
      name: "Refresh status",
      desc: "After checkout, a top-up, or a sign-in link, pull the latest plan from the Plus service.",
      label: "Refresh status",
      onClick: () => this.refreshAndRedisplay(),
    });
    // A trial that ended without converting has no Stripe customer, so the portal has
    // nothing to open. Offering it there sends the user to an error instead of a card form —
    // Subscribe above is the row that actually does something (#442).
    //
    // Positive proof, not absence of proof: only a plan that implies a Stripe customer earns
    // the row. Hiding merely on `=== "trial"` still let an unknown plan through — a session
    // stored before `plan` was persisted, or a promo — to that same dead portal.
    const portalHasSubject =
      state.kind !== "periodEnded" || state.lapseKind === "subscription";
    if (!setupIncomplete && portalHasSubject) {
      this.actionRow(containerEl, {
        action: "plus:billing-portal",
        name: "Manage subscription",
        desc: "Change plan, update your card, or cancel in the billing portal.",
        label: "Manage subscription",
        onClick: () => this.openBillingPortal(),
      });
    }
    this.destructiveRow(containerEl, {
      action: "plus:sign-out",
      name: "Sign out",
      desc: "Remove the Plus session from this device, and turn the Ask mirror off on every device this vault syncs to.",
      label: "Sign out",
      onClick: () => this.signOutOfPlus(),
    });
    if (session) {
      this.destructiveRow(containerEl, {
        action: "plus:sign-out-all",
        name: "Sign out all devices",
        desc: "Sign out every device and disconnect Claude/ChatGPT. You will need a new sign-in link here too.",
        label: "Sign out all devices",
        onClick: () => this.signOutAllDevicesOfPlus(),
      });
    }

    containerEl.createEl("p", {
      text: "To use your own API key instead, add it under API Key. Plus is optional.",
      cls: "setting-item-description",
    });
  }

  private renderSignedOutAccount(containerEl: HTMLElement): void {
    this.actionRow(containerEl, {
      action: "plus:see-plans",
      name: "Skip the API key",
      desc: "Atoms Plus files your captures for you. Or keep using your own key. It’s free forever, and the full app stays yours either way.",
      label: "See plans",
      onClick: () => {
        window.open(ATOMS_SITE_URL, "_blank");
      },
    });

    this.formActionsRow(containerEl, {
      name: "Email",
      desc: this.accountEmailDesc(),
      placeholder: "you@example.com",
      submits: [
        {
          action: "plus:magic-link",
          label: "Send sign-in link",
          onSubmit: (email) => this.requestSignInLink(email),
        },
        {
          action: "plus:start-trial",
          label: "Start free trial",
          accent: true,
          onSubmit: (email) => this.startTrial(email),
        },
        {
          action: "plus:promo-subscribe",
          label: "Use promo code",
          onSubmit: (email) => this.startSubscribeFromEmail(email),
        },
      ],
    });

    // Advanced: paste session — the different-device fallback, kept below the
    // link row until #286 replaces it (KD3, R10).
    this.formRow(containerEl, {
      name: "Advanced: paste session",
      desc: "Only if your email opens on a different device from Obsidian. Sign in there, then paste the session it gives you.",
      placeholder: "sess_…",
      configure: (text) => {
        // A Plus bearer token, treated the way the API key field treats a key.
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
      },
      submit: {
        action: "plus:save-session",
        label: "Save session",
        onSubmit: (sessionToken) => this.savePastedSession(sessionToken),
      },
    });
  }

  /**
   * Send a sign-in link to the typed email, then rebuild: the row's copy turns into the "open
   * the email" form once a link exists. The expired-session row calls `sendPlusMagicLink`
   * directly — it already has an address, so it has nothing to check and no form to redraw.
   */
  private async requestSignInLink(email: string): Promise<void> {
    if (!requireEmail(email)) return;
    await this.sendPlusMagicLink(email);
    this.redisplay();
  }

  /** Start a Plus account for the typed email and open its trial checkout. */
  private async startTrial(email: string): Promise<void> {
    if (!requireEmail(email)) return;
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
            "This email already has Plus — send a sign-in link above.",
            8000,
          );
          return;
        }
        new Notice(`Atoms Plus: ${started.message}`);
        return;
      }
      await installPlusSession(this.askMirrorDisarmHost(), {
        ...started.session,
        setupKind: "trial",
      });
      await this.openTrialCheckout(started.session);
    } finally {
      this.redisplay();
    }
  }

  /**
   * Start a paid subscription for a new email so a promo code can apply.
   * Sibling of `startTrial`. Do not call `openSubscribeCheckout`: that helper
   * treats an inactive new session as already active.
   */
  private async startSubscribeFromEmail(email: string): Promise<void> {
    if (!requireEmail(email)) return;
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
            "This email already has Plus — send a sign-in link above.",
            8000,
          );
          return;
        }
        new Notice(`Atoms Plus: ${started.message}`);
        return;
      }
      await installPlusSession(this.askMirrorDisarmHost(), {
        ...started.session,
        setupKind: "subscribe",
      });
      await this.openSubscribeCheckoutForSession(started.session);
    } finally {
      this.redisplay();
    }
  }

  /** Resume the interrupted promo-code Subscribe checkout. */
  private async finishSubscribeCheckout(): Promise<void> {
    const session = readPlusSession(this.app);
    if (!session) {
      new Notice("No Plus session on this device");
      return;
    }
    try {
      await this.openSubscribeCheckoutForSession(session);
    } finally {
      this.redisplay();
    }
  }

  private async openSubscribeCheckoutForSession(session: {
    sessionToken: string;
  }): Promise<void> {
    const base =
      this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
    const r = await createCheckout(
      { baseUrl: base, request: plusFetchRequest },
      session.sessionToken,
      "subscribe_monthly",
    );
    if (!r.ok) {
      new Notice(`Atoms Plus: ${r.message}`);
      return;
    }
    if (r.url) {
      setAwaitingCheckout(this.app, true);
      window.open(r.url, "_blank");
      new Notice(
        "Complete checkout in the browser. On the next page, tap Add promotion code.",
        12000,
      );
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
  private async savePastedSession(sessionToken: string): Promise<void> {
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
      const email = typeof j.email === "string" ? j.email.trim() : "";
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
      await installPlusSession(this.askMirrorDisarmHost(), {
        sessionToken,
        email,
        status,
        remaining: typeof j.remaining === "number" ? j.remaining : undefined,
        periodEnd: typeof j.periodEnd === "string" ? j.periodEnd : undefined,
        plan: parsePlusPlan(j.plan),
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

  /** The two phone-shortcut rows, inside whatever container the Capture leg hands them. */
  private renderCaptureShortcutRows(containerEl: HTMLElement) {
    const shortcutAcked = readShortcutAck((k) => loadLocal(this.app, k));
    const custom = customCaptureShortcutUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
    const installUrl = resolveCaptureShortcutInstallUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
    const urlSet = Boolean(installUrl);

    // Companion stays hidden until App Store. Capture Atom shortcut is the path.
    this.actionRow(containerEl, {
      action: "shortcut:install",
      name: "Capture Atom shortcut",
      desc: urlSet
        ? `iOS: opens Capture Atom v${CAPTURE_ATOM_VERSION}. After Add Shortcut: Shortcuts → Capture Atom → edit → Append to Bookmark → Atoms Inbox (not Ask Each Time) → Done. Open Obsidian with Atoms once first so that bookmark exists. Acked: ${shortcutAcked ?? "never"}.`
        : `No link — check mobile-install.json Capture Atom urls.`,
      label: labelCaptureShortcutCta(shortcutAcked),
      disabled: !urlSet,
      onClick: () => {
        if (!urlSet) {
          new Notice("No shortcut link to open.");
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
          CAPTURE_ATOM_VERSION,
        );
        new Notice(
          `Opened Capture Atom v${CAPTURE_ATOM_VERSION} — add it, then edit → set bookmark to Atoms Inbox once`,
        );
        this.redisplay();
      },
    });

    const shortcutUrlRow = new Setting(containerEl)
      .setName("Custom shortcut link")
      .setDesc(
        custom
          ? "Using your own iCloud link. Clear it to use the built-in Capture Atom URL."
          : `Optional. Only paste a link if you forked the recipe. Built-in is Capture Atom v${CAPTURE_ATOM_VERSION}.`,
      )
      .addText((text) =>
        text
          .setPlaceholder("Using the shortcut Atoms ships")
          .setValue(custom)
          .onChange((value) => {
            this.plugin.settings.captureShortcutInstallUrl =
              customCaptureShortcutUrl(value);
            void this.plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Use the shortcut Atoms ships")
          .setDisabled(!custom)
          .onClick(() => {
            this.plugin.settings.captureShortcutInstallUrl = "";
            void Promise.resolve(this.plugin.saveSettings()).then(() => {
              new Notice("Back to the built-in Capture Atom shortcut");
              this.redisplay();
            });
          }),
      );
    shortcutUrlRow.settingEl.addClass("atoms-capture-shortcut-url");
  }

  /**
   * The own-key half of the engine choice: the key, and the device-local pair that answers for it.
   *
   * Built without a heading or a lead paragraph of its own, because it is no longer a section —
   * it is the second option inside the engine screen's `Pick one` group, and that group's header
   * and footer are its explanation. What the retired lead used to disclose ("titles, tags, and
   * capture text to Anthropic over TLS", "your notes are never rewritten") is not dropped: the
   * first is the `What gets sent` group below it, and the second is the File group's own footer
   * on the main screen (R11), which states it for both engines rather than only for this one.
   */
  private renderKeyRows(containerEl: HTMLElement) {
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
          .onChange((value) => {
            this.plugin.settings.apiKeySecretId = value;
            void Promise.resolve(this.plugin.saveSettings()).then(() => {
              // Saving is the moment the answer can change, so it is the moment to re-ask.
              this.checkApiKey();
            });
          }),
      );
    this.apiKeyStatusEl = setting.descEl.createDiv({
      cls: "atoms-api-key-status",
    });
    this.checkApiKey();

    // Plumbing by tone, a credential path by effect: `getApiKey()` falls back to this key, so
    // the pair below can enable Anthropic spend on its own — which R5 keeps beside the key it
    // answers for rather than behind Advanced. The toggle also deletes the key, and nothing else does.
    settingRow(containerEl, {
      name: "Device-local key fallback",
      desc: "Only if SecretStorage fails: non-synced local storage (still never data.json). Turning this off deletes the key stored on this device.",
      control: {
        kind: "toggle",
        configure: (toggle) => {
          toggle
            .setValue(this.plugin.settings.useDeviceLocalKeyFallback)
            .onChange((value) => {
              this.plugin.settings.useDeviceLocalKeyFallback = value;
              if (!value) {
                this.app.saveLocalStorage(LOCAL_STORAGE_API_KEY, null);
              }
              void Promise.resolve(this.plugin.saveSettings()).then(() =>
                this.redisplay(),
              );
            });
        },
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

  /**
   * The automatic-filing toggle, wherever it is currently standing.
   *
   * One implementation, two homes: the status group holds it once somebody files, the File group
   * holds it while nobody does. Only the prose differs, so only the prose is a parameter
   * — a second copy of this handler is a second consent gate to keep in step, and the gate is the
   * whole reason the row is delicate.
   */
  private renderAutomaticFilingRow(
    containerEl: HTMLElement,
    row: { name: string; desc: string },
  ): void {
    const load = (k: string): unknown => loadLocal(this.app, k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);

    settingRow(containerEl, {
      name: row.name,
      desc: row.desc,
      control: {
        kind: "toggle",
        configure: (toggle) => {
          toggle.setValue(state.enabled && state.egressAcked).onChange((on) => {
            // Re-read rather than trusting the render-time `state` above, exactly as the Ask
            // mirror toggle does: this handler can outlive the screen it was built on, and a
            // withdrawal elsewhere would leave it holding an ack that no longer exists.
            const acked = readDeviceAutoRunState(load).egressAcked;
            if (!on || acked) {
              // The path every re-enable takes, since it short-circuits before the sheet
              // whenever the ack is current — so it stamps the window start too (U3).
              setAutomaticFilingEnabled(load, save, on);
              if (on) void this.plugin.runFilingAfterEnable();
              this.redisplay();
              return;
            }
            this.presentConsent(
              egressConsentSpec((verdict) => {
                // Anything short of an explicit accept leaves the toggle exactly where the
                // sheet found it: off, and unacknowledged.
                const accepted = verdict === "accepted";
                writeEgressAck(save, accepted);
                setAutomaticFilingEnabled(load, save, accepted);
                if (accepted) void this.plugin.runFilingAfterEnable();
                this.redisplay();
              }),
            );
          });
        },
      },
    });
  }

  /**
   * What is left of the old automatic-filing section once the toggle moved into the two groups.
   *
   * It is named for what it now holds rather than for what it used to: the resume switch, the
   * manual run, the consent that permits both, and this device's two run records. The toggle's
   * own heading and its two paragraphs went with the toggle — a heading over no control is chrome
   * with nothing under it, and one of those paragraphs was the second copy of the day-one promise
   * the status group already makes. The rules they carried did not vanish: device scope is on the
   * toggle's own line in both of its homes, the consent wording is the sheet's (which is frozen),
   * and the pointer at Atoms home for older captures is in the File group's footer, where it is
   * true whichever home the toggle has.
   *
   * The rows below are still headed rather than grouped because the units that move the records
   * to Privacy and the diagnostics to Advanced have not landed.
   */
  private renderAutoRunSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Sync");

    const load = (k: string): unknown => loadLocal(this.app, k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);

    // Rendered from the grants themselves rather than from the automatic-filing toggle: a consent
    // recorded against a feature that is currently off is still live, and still revocable.
    //
    // Gated on *either* device-local grant, not on the egress stamp alone. Two booleans satisfy
    // the egress gate — the stamped ack and the catch-up notice — and this row is the only
    // surface that withdraws either. Keying it to the stamp would mean a device whose ack went
    // stale (a legacy grant, or any future EGRESS_ACK_VERSION bump) loses this row while its
    // notice keeps permitting catch-up filing: a grant that still spends, with nothing left on
    // screen to take it back.
    const noticeAcked = readEgressNoticeAcked(load);
    if (state.egressAcked || noticeAcked) {
      // Say which consent is actually on record. A device carrying only the notice never saw
      // the unioned disclosure, and this row must not claim on its behalf that it did.
      //
      // "earlier" is the upgrade case, where the stale grant named no wording at all. A stamp
      // that exists but is not ours is the downgrade case — the wording it names is *later*
      // than this build's, so "earlier" would be its own small lie.
      const strandedStamp = readEgressAckVersion(load) != null;
      const record = state.egressAcked
        ? "Acknowledged on this device"
        : strandedStamp
          ? "Acknowledged on this device for Sync everything now, against different wording"
          : "Acknowledged on this device for Sync everything now, against earlier wording";
      this.actionRow(containerEl, {
        action: `ack:review:${EGRESS_ACK_TITLE}`,
        name: EGRESS_ACK_TITLE,
        desc: record,
        label: "Review",
        onClick: () =>
          this.presentConsent(
            egressConsentSpec((verdict) => {
              if (verdict !== "withdrawn") return;
              writeEgressAck(save, false);
              writeAutoRunEnabled(save, false);
              // Clearing one grant would leave the other still permitting "Sync everything
              // now" — which the disclosure just above names.
              clearEgressNoticeAcked(save);
              this.redisplay();
            }, `${record}.`),
          ),
      });
    }

    settingRow(containerEl, {
      name: "Sync when you return to Obsidian",
      desc: "When you return to Obsidian, drain the inbox, apply the Ask outbox, push the mirror, and file if automatic filing is on. Device-local only. Manual Sync everything now still works when this is off.",
      control: {
        kind: "toggle",
        configure: (toggle) => {
          toggle.setValue(this.plugin.getResumeEnabled()).onChange((on) => {
            this.plugin.setResumeEnabled(on);
            this.redisplay();
          });
        },
      },
    });

    this.actionRow(containerEl, {
      action: "catchup:sync-everything",
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

  /**
   * Where atoms land — the one File row whose rule outlives the footer sweep (R19).
   *
   * `clampAtomFolder` silently rewrites anything it will not take back to `Atoms`, and there is no
   * error surface anywhere that reports it. Delete this subtitle and a user who typed
   * `Notes/Atoms` watches the field snap back with nothing on screen explaining why, so it says
   * what actually happens rather than the older "are rejected", which described a refusal the
   * code never performs.
   */
  private renderAtomFolderRow(containerEl: HTMLElement) {
    settingRow(containerEl, {
      name: "Atom folder",
      desc: "One flat folder. A path with .. or subfolders falls back to Atoms.",
      control: {
        kind: "text",
        configure: (text) => {
          text
            .setPlaceholder("Atoms")
            .setValue(this.plugin.settings.atomFolder)
            .onChange((value) => {
              this.plugin.settings.atomFolder = clampAtomFolder(value);
              void this.plugin.saveSettings();
            });
        },
      },
    });
  }

  /**
   * The hub-list toggle, and the preview that only exists while it is on.
   *
   * The toggle's old description said the list lands at the bottom of a hub note and that the
   * writing above it is untouched. The group footer says that now, for every row at once, which
   * is the whole point of the footer: this row is a name and a switch again.
   */
  private renderHubListRows(containerEl: HTMLElement) {
    settingRow(containerEl, {
      name: "List atoms on hub notes",
      control: {
        kind: "toggle",
        configure: (toggle) => {
          toggle
            .setValue(this.plugin.settings.enableHubProjection === true)
            .onChange((on) => {
              const was = this.plugin.settings.enableHubProjection === true;
              this.plugin.settings.enableHubProjection = on;
              if (on) {
                this.plugin.settings.hubProjectionListDisclosureSeen = true;
              }
              void Promise.resolve(this.plugin.saveSettings()).then(() => {
                this.redisplay();
                if (on && !was) {
                  void this.plugin.openHubListPreview("toggle-on");
                }
              });
            });
        },
      },
    });

    if (this.plugin.settings.enableHubProjection === true) {
      this.actionRow(containerEl, {
        action: "hub:refresh-lists",
        name: "Refresh hub lists",
        desc: "Preview which hub notes would get atom lists, then update them.",
        label: "Preview…",
        onClick: () => this.plugin.openHubListPreview("refresh"),
      });
    }
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
          configure: (toggle) => {
            toggle.setValue(true).onChange((on) => {
              if (on) return;
              this.plugin.settings.activeVocabulary = removeActiveTag(
                tag,
                this.plugin.settings.activeVocabulary,
              );
              void Promise.resolve(this.plugin.saveSettings()).then(() =>
                this.redisplay(),
              );
            });
          },
        },
      });
    }

    // The field and the one button that commits it, in one card. `customTagDraft` stays: flipping
    // any active tag above off calls `redisplay()`, and restoring the draft through `configure` is
    // what puts a half-typed tag back after that rebuild. `onSubmit` receiving the value answers a
    // different question — what is being added, not what survives a re-render.
    this.formRow(containerEl, {
      name: "Add a custom tag",
      desc: "Lowercase, no # required.",
      placeholder: "e.g. health",
      configure: (text) => {
        text.setValue(this.customTagDraft).onChange((v) => {
          this.customTagDraft = v;
        });
      },
      submit: {
        action: "tags:add-custom",
        // Not shortened to "Add" the way the account labels were: the row name is the field's
        // label now, so the verb is the only thing left saying *which* list the tag joins.
        label: "Add to Active",
        onSubmit: (typed) => {
          const checked = checkCustomTag(typed);
          if (!checked.ok) {
            // Said out loud, and the draft left in the field to be corrected. Returning in
            // silence left the text sitting there with nothing happening — a dead end the user
            // could only read as the button being broken.
            new Notice(`Atoms: ${checked.reason}`);
            return;
          }
          this.plugin.settings.activeVocabulary = addCustomActiveTag(
            checked.tag,
            this.plugin.settings.activeVocabulary,
          );
          this.customTagDraft = "";
          void Promise.resolve(this.plugin.saveSettings()).then(() =>
            this.redisplay(),
          );
        },
      },
    });

    // Proposed tags awaiting approval.
    //
    // Normalized here, not trusted from settings: `mergeProposedTags` writes a deduped, lowercased
    // array, but `loadSettings` assigns `data.json` straight through, so a hand edit or an older
    // build can leave `["design", "Design"]` behind. Two rows would render, the row name would
    // count two, and the confirm — which counts the *normalized* set it dismisses — would say one.
    // The row's whole job is to state its own reach before it is pressed, so the name and the
    // sheet have to reach the same number by construction, not by trusting the stored array.
    const proposed = [
      ...new Set((this.plugin.settings.proposedTags ?? []).map(normalizeTag)),
    ].filter(Boolean);
    if (proposed.length > 0) {
      settingHeading(containerEl, "Proposed (approve to activate)");
      for (const tag of proposed) {
        this.actionRow(containerEl, {
          action: `tags:approve:${tag}`,
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
      }
      // Dismissal is one row for the queue, not one per tag. Per-tag Dismiss could not share the
      // Approve row — no primitive carries two kinds — so it rented a whole second full-width row
      // whose entire content was its own button label, doubling the section's height to clear
      // something that was already inert: a proposal is never applied until it is approved. The
      // count is in the name so the reach of the button is legible before it is pressed.
      //
      // It clears exactly the proposals rendered above it, never the live array. A Process or
      // auto-run merges into `settings.proposedTags` without redisplaying an open settings tab, so
      // an unscoped clear would destroy tags that arrived after this row was drawn — more than the
      // count in its own name promised, and unseen. Per-tag dismissal was bounded for free; a bulk
      // one has to say so.
      const rendered = new Set(proposed.map(normalizeTag));
      this.destructiveRow(containerEl, {
        action: "tags:dismiss-proposed",
        name: `${proposed.length} ${proposed.length === 1 ? "proposal" : "proposals"} waiting`,
        // No desc: every Approve row above already says these are inert until approved, and the
        // one fact this row adds — that dismissal does not come back — belongs at the tap, in the
        // confirm, not as a standing warning under a button nobody has reached for yet.
        label: "Dismiss all",
        onClick: () => this.confirmDismissProposedTags(rendered),
      });
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
    // Filtered before the cap, not after. Slicing first spends the 30-row budget on rows that
    // are then thrown away, so a vault with 30 active tags showed an empty list — under the
    // sentence claiming every tag was already active — while unactivated ones sat below the
    // cut. The default vocabulary is 13 and grows one tap at a time; 30 is not exotic.
    const unactivated = tagCountsSorted(counts).filter(
      ({ tag }) => !activeSet.has(tag),
    );
    const promotable = unactivated.slice(0, 30);

    if (promotable.length === 0) {
      // Two different silences, and the sentence has to tell them apart: a vault with no tags
      // at all, versus one whose every tag is already active. Neither can be reached while
      // something is still promotable, because both are read off the filtered list.
      containerEl.createEl("p", {
        text: counts.size
          ? "Every tag your vault uses is already active."
          : "No tags found in vault yet.",
        cls: "setting-item-description",
      });
    } else if (unactivated.length > promotable.length) {
      containerEl.createEl("p", {
        text: `Showing the ${promotable.length} most-used of ${unactivated.length} tags you have not activated yet.`,
        cls: "setting-item-description",
      });
    }

    for (const { tag, count } of promotable) {
      this.actionRow(containerEl, {
        action: `tags:activate:${tag}`,
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
   * The queue dismissal, behind the question a bulk destructive row cannot skip.
   *
   * One tap was defensible while dismissal was per-tag; a row that clears a dozen proposals at
   * once is not, because they do not come back — a processed capture carries a sentinel and is
   * never classified twice. `rendered` is the set the row drew, so a classify run that merged
   * new proposals into the queue while this screen sat open survives both the question and the
   * dismissal.
   *
   * Returns a promise settling when the question is answered, so `destructiveRow`'s in-flight
   * guard covers the whole confirm lifetime rather than releasing the moment the sheet opens —
   * same reason as `confirmWipeCloudCopy`, and the same double-tap it prevents.
   */
  private confirmDismissProposedTags(rendered: Set<string>): Promise<void> {
    const n = rendered.size;
    return confirmSheet({
      app: this.app,
      title: n === 1 ? "Dismiss 1 proposal?" : `Dismiss ${n} proposals?`,
      body: `${n === 1 ? "This tag" : `These ${n} tags`} will not be offered again unless a later capture proposes ${n === 1 ? "it" : "them"}. Nothing already tagged changes.`,
      cancelLabel: "Keep",
      confirmLabel: "Dismiss",
      onConfirm: async () => {
        this.plugin.settings.proposedTags = this.plugin.settings.proposedTags.filter(
          (t) => !rendered.has(normalizeTag(t)),
        );
        await this.plugin.saveSettings();
        this.redisplay();
      },
    });
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
    const okRaw: unknown = this.app.loadLocalStorage(LS_ASK_MIRROR_LAST_SUCCESS);
    const errRaw: unknown = this.app.loadLocalStorage(LS_ASK_MIRROR_LAST_ERROR);
    const lastOk = typeof okRaw === "string" ? okRaw : "";
    const lastErr = typeof errRaw === "string" ? errRaw.trim() : "";
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
    // Asked of the gate itself, not of a second copy of its conditions, so the sentence and the
    // egress it describes cannot disagree (#374).
    const off = this.mirrorOffReason();
    // The device can tell this from a date it already holds, which matters here more than
    // anywhere: no push has been attempted since the account lapsed, so there is no error to
    // report and the line would otherwise keep reading healthy indefinitely (#442).
    const state = this.accountState();
    const lapsed = state.kind === "periodEnded" ? state.lapseKind : undefined;
    return {
      line: formatAskMirrorStatusLine({
        serverCount,
        email: mirrorEmail,
        relativeLastOk: relative(lastOk),
        lastErr: refused ? "" : lastErr,
        refused,
        off,
        lapsed,
      }),
      // A mirror the gate has closed is not failing. Styling it as an error would tell someone
      // who just withdrew consent that something went wrong when it went right.
      failing: off ? false : Boolean(lapsed) || Boolean(lastErr) || refused,
    };
  }

  /**
   * Why the mirror is not running, or `undefined` while it is.
   *
   * `askMirrorPermitted` decides *whether*, so this method can never be the reason the sentence
   * and the gate part company. The fields below only choose *which* reason to name, and the ack
   * is read first because it is the larger fact: withdrawal turns the toggle off on its way past,
   * so "off" alone would be the smaller half of what happened.
   */
  private mirrorOffReason(): AskMirrorOffReason | undefined {
    const s = this.plugin.settings;
    if (askMirrorPermitted(s)) return undefined;
    if (!askPrivacyAckIsCurrent(s)) {
      return ackStampIsReal(s.askPrivacyAckAt) ? "stale-ack" : "no-ack";
    }
    return "disabled";
  }

  /**
   * The Ask privacy ack on record, and the way back out of it.
   *
   * Its own method because it renders in two places — under the mirror toggle when signed in,
   * and on its own when signed out — and both must be the same row. Rendered off the timestamp
   * alone, never off the session, the version, or the toggle above it.
   */
  private renderAskPrivacyAckRecord(containerEl: HTMLElement): void {
    const { askPrivacyAckAt, askPrivacyAckVersion } = this.plugin.settings;
    if (!askPrivacyAckAt) return;
    this.renderAckRecord(containerEl, {
      name: ASK_PRIVACY_ACK_TITLE,
      at: askPrivacyAckAt,
      disclosure: ASK_PRIVACY_DISCLOSURE,
      standing: askAckStanding(askPrivacyAckVersion, ASK_PRIVACY_ACK_VERSION),
      onWithdraw: async () => {
        this.writeAskAck("privacy", false);
        this.plugin.settings.askEnabled = false;
        // Withdrawing consent to store bodies in the cloud also withdraws consent for the
        // cloud to write back into the vault: the narrower ack cannot outlive the one it
        // was granted on top of.
        this.writeAskAck("write", false);
        // Before the save, so any handler still holding the granted state loses its DOM while
        // this is waiting on disk.
        this.redisplay();
        await this.plugin.saveSettings();
      },
    });
  }

  /** The vault-write ack on record. Withdrawing it leaves the mirror exactly as it was. */
  private renderAskWriteAckRecord(containerEl: HTMLElement): void {
    const { askWriteAckAt, askWriteAckVersion } = this.plugin.settings;
    if (!askWriteAckAt) return;
    this.renderAckRecord(containerEl, {
      name: ASK_WRITE_ACK_TITLE,
      at: askWriteAckAt,
      disclosure: ASK_WRITE_DISCLOSURE,
      standing: askAckStanding(askWriteAckVersion, ASK_WRITE_ACK_VERSION),
      onWithdraw: () => this.setAskWriteAck(false),
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
        text: "Sign in to Atoms Plus above to use the hosted connector. To run the server yourself, open Advanced and follow the DIY Ask guide.",
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

    const ack = askPrivacyAckIsCurrent(this.plugin.settings);
    settingRow(containerEl, {
      name: "Ask mirror",
      desc: "Keep the cloud Atoms/ copy current while Obsidian is open (vault events + Process/Update).",
      control: {
        kind: "toggle",
        configure: (tog) => {
          // `&& ack`, exactly as the auto-run toggle reads `enabled && egressAcked`: a device
          // whose grant went stale is not mirroring, and a switch that still showed on would
          // be reporting a push that is not happening — with no gesture left to re-prompt it.
          // Off is both the truth and the affordance that raises the sheet again (#360).
          tog.setValue(this.plugin.settings.askEnabled && ack).onChange((on) => {
            if (!on) {
              void this.setAskMirrorEnabled(false);
              return;
            }
            // Live rather than the render-time `ack` above: this handler can outlive the
            // screen it was built on — a withdrawal elsewhere leaves it holding a consent that
            // no longer exists, and it would re-enable the mirror without asking. A grant made
            // against superseded wording is the same situation, so it takes the same branch:
            // this enable is where an upgraded device re-reads the disclosure once (#360).
            if (askPrivacyAckIsCurrent(this.plugin.settings)) {
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
                // Settle the pairing *before* stamping the new grant, while the old privacy
                // ack is still visibly stale. A write ack riding on wording that was just
                // superseded dies here; stamping first would make it look current again and
                // silently reopen filing from Claude with no write sheet ever re-posed.
                settleAckRecords(this.plugin.settings);
                this.writeAskAck("privacy", true);
                void this.setAskMirrorEnabled(true);
              },
            });
          });
        },
      },
    });

    this.renderAskPrivacyAckRecord(containerEl);

    const writeAck = askWriteAckIsCurrent(this.plugin.settings);
    settingRow(containerEl, {
      name: "Allow filing from Claude or ChatGPT",
      desc: "When on, this vault applies create/continue outbox items under your Atoms folder (new files only; never rewrites existing bodies). Requires Ask mirror enabled.",
      control: {
        kind: "toggle",
        configure: (tog) => {
          tog
            .setValue(writeAck)
            .setDisabled(!ack || !this.plugin.settings.askEnabled)
            .onChange((on) => {
              if (!on) {
                void this.setAskWriteAck(false);
                return;
              }
              // Both preconditions checked here rather than resting on the invariant that the
              // mirror cannot be on without the privacy ack: this is the write site, and the
              // narrower consent must never be granted on top of one that is gone — or one
              // granted against wording this build has since replaced.
              if (
                !this.plugin.settings.askEnabled ||
                !askPrivacyAckIsCurrent(this.plugin.settings)
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
                  // Re-checked at the moment of grant, not only before the sheet was posed.
                  // Every screen change settles an open sheet today, so nothing currently
                  // delivers `accepted` under a vanished privacy ack — but the module-level
                  // sheet latch exists because a surface once posed a sheet without settling
                  // it, and this is the write that would have been wrong that day.
                  if (
                    !this.plugin.settings.askEnabled ||
                    !askPrivacyAckIsCurrent(this.plugin.settings)
                  ) {
                    this.redisplay();
                    return;
                  }
                  void this.setAskWriteAck(true);
                },
              });
            });
        },
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
