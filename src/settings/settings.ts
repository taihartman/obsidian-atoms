import {
  App,
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
  labelInstallOrUpdate,
  openShortcutInstallUrl,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "./captureShortcut";
import { clampAtomFolder } from "../pipeline/render";
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
} from "../platform/filingAuth";
import { atomsPlusTopUpCopy } from "../home/atomsHomeData";
import {
  DEFAULT_PLUS_BASE_URL,
  requestMagicLink,
  startPlusAccount,
  createCheckout,
  createBillingPortal,
  getEntitlement,
  signOutPlus,
  askMcpUrl,
  askMirrorStatus,
  askMirrorWipe,
  plusFetchRequest,
} from "../platform/plusClient";
import {
  LS_ASK_MIRROR_HASHES,
  LS_ASK_MIRROR_LAST_ERROR,
  LS_ASK_MIRROR_LAST_SUCCESS,
  LS_ASK_MIRROR_SERVER_COUNT,
  writeAskMirrorHashes,
} from "../platform/askMirror";
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

function settingHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl).setName(name).setHeading();
}

function loadLocal(app: App, key: string): unknown {
  return app.loadLocalStorage(key) as unknown;
}

export class AtomsSettingTab extends PluginSettingTab {
  plugin: AtomsPlugin;
  private customTagDraft = "";

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
   * Imperative settings UI. Declarative PluginSettingTab.getSettingDefinitions
   * (Obsidian 1.13+ settings search) is a separate migration — not this claim.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
    this.renderVocabularySection(containerEl);
    this.renderDevHints(containerEl);
  }

  /**
   * Pull latest Plus entitlement into device session.
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
    const r = await getEntitlement(
      { baseUrl: base, request: plusFetchRequest },
      session.sessionToken,
    );
    if (!r.ok) {
      if (!opts?.quiet) new Notice(`Atoms Plus: ${r.message}`);
      return false;
    }
    const e = r.entitlement;
    writePlusSession(this.app, {
      ...session,
      email: e.email || session.email,
      status: e.status,
      remaining: e.remaining,
      periodEnd: e.periodEnd,
      refreshedAt: Date.now(),
    });
    if (!opts?.quiet) new Notice("Atoms Plus status refreshed");
    return true;
  }

  private addRefreshStatusButton(
    setting: Setting,
    opts?: { cta?: boolean },
  ): void {
    setting.addButton((btn) => {
      btn.setButtonText("Refresh status");
      if (opts?.cta) btn.setCta();
      btn.onClick(async () => {
        btn.setDisabled(true);
        try {
          await this.refreshPlusEntitlement();
          this.redisplay();
        } finally {
          btn.setDisabled(false);
        }
      });
    });
  }

  /**
   * Atoms Plus — mock SSOT docs/design-handoff/atoms-plus/index.html (v3).
   * No ambient remaining meters. Checkout needs Plus service (U6).
   */
  private renderPlusSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Atoms Plus");

    const auth = this.plugin.resolveFilingAuth();
    const session = readPlusSession(this.app);
    const topUp = atomsPlusTopUpCopy();

    if (auth.mode === "plus" && auth.status === "exhausted") {
      new Setting(containerEl)
        .setName("Monthly Limit Reached")
        .setDesc(
          "You’ve used this month’s included AI filings. Your allotment starts over on your next billing date. If you need more before then, you can buy additional filings.",
        )
        .addButton((btn) =>
          btn.setButtonText("Get More").setCta().onClick(async () => {
            const session = readPlusSession(this.app);
            if (!session) {
              new Notice("No Plus session on this device");
              return;
            }
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
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Manage Subscription").onClick(async () => {
            const session = readPlusSession(this.app);
            if (!session) return;
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
          }),
        );
      this.addRefreshStatusButton(
        new Setting(containerEl)
          .setName("Refresh status")
          .setDesc(
            "After Checkout or top-up, pull the latest plan from the Plus service.",
          ),
        { cta: true },
      );
      if (session?.email) {
        new Setting(containerEl)
          .setName("Account")
          .setDesc(session.email);
      }
      new Setting(containerEl)
        .setName("Sign out")
        .setDesc("Remove Plus session from this device only.")
        .addButton((btn) =>
          btn.setButtonText("Sign Out").onClick(() => {
            clearPlusSession(this.app);
            new Notice("Atoms Plus signed out on this device");
            this.redisplay();
          }),
        );
      return;
    }

    if (auth.mode === "plus") {
      const statusLabel =
        auth.status === "trialing"
          ? "Active · Trial"
          : auth.status === "active"
            ? "Active"
            : "On";
      const remainingLabel =
        typeof auth.remaining === "number"
          ? ` · ${auth.remaining} filings left`
          : "";
      this.addRefreshStatusButton(
        new Setting(containerEl)
          .setName("Status")
          .setDesc(`${statusLabel}${remainingLabel}`),
        { cta: true },
      );
      new Setting(containerEl)
        .setName("Account")
        .setDesc(auth.email);
      new Setting(containerEl)
        .setName("Plan")
        .setDesc(
          session?.periodEnd
            ? `Renews ${session.periodEnd.slice(0, 10)}`
            : "Monthly or yearly — see Manage Subscription",
        );
      new Setting(containerEl)
        .setName("Manage")
        .addButton((btn) =>
          btn.setButtonText("Manage Subscription").onClick(async () => {
            const session = readPlusSession(this.app);
            if (!session) return;
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
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Sign Out").onClick(async () => {
            const session = readPlusSession(this.app);
            const base =
              this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
            if (session) {
              await signOutPlus(
                { baseUrl: base, request: plusFetchRequest },
                session.sessionToken,
              );
            }
            clearPlusSession(this.app);
            new Notice("Atoms Plus signed out on this device");
            this.redisplay();
          }),
        );
      containerEl.createEl("p", {
        text: "To use your own API key instead, add it under API Key. Plus is optional.",
        cls: "setting-item-description",
      });
      return;
    }

    // Soft session (inactive) — finish trial without paste
    if (hasPlusSetupSession(session) && session?.status === "inactive") {
      new Setting(containerEl)
        .setName("Finish trial setup")
        .setDesc(
          `${session.email} — complete Stripe checkout (card for 14-day trial). Return here and status updates automatically.`,
        )
        .addButton((btn) =>
          btn.setButtonText("Finish trial setup").setCta().onClick(async () => {
            btn.setDisabled(true);
            try {
              await this.openTrialCheckout(session);
            } finally {
              btn.setDisabled(false);
              this.redisplay();
            }
          }),
        );
      this.addRefreshStatusButton(
        new Setting(containerEl)
          .setName("Refresh status")
          .setDesc("After checkout, pull the latest plan (or wait for auto-update)."),
      );
      new Setting(containerEl)
        .setName("Sign out")
        .setDesc("Remove Plus setup from this device.")
        .addButton((btn) =>
          btn.setButtonText("Sign Out").onClick(() => {
            clearPlusSession(this.app);
            new Notice("Atoms Plus signed out on this device");
            this.redisplay();
          }),
        );
      containerEl.createEl("p", {
        text: "When you use Plus, captures are sent securely to Anthropic under our account. We don’t train on your notes.",
        cls: "setting-item-description",
      });
      return;
    }

    // Signed out — stripe-first
    new Setting(containerEl)
      .setName("Skip the API Key")
      .setDesc(
        "Atoms Plus files your captures for you. Or keep using your own key. It’s free forever, and the full app stays yours either way.",
      )
      .addButton((btn) =>
        btn.setButtonText("See Plans").onClick(() => {
          window.open(ATOMS_SITE_URL, "_blank");
        }),
      );

    new Setting(containerEl)
      .setName("Email")
      .setDesc(
        "Start a free trial (card required). Checkout opens in your browser — then return to Obsidian.",
      )
      .addText((text) => {
        text.setPlaceholder("you@example.com").inputEl.dataset.plusEmail = "1";
      })
      .addButton((btn) =>
        btn.setButtonText("Start free trial").setCta().onClick(async () => {
          const input = containerEl.querySelector("input[data-plus-email]");
          const email =
            input instanceof HTMLInputElement ? input.value.trim() : "";
          if (!email.includes("@")) {
            new Notice("Enter a valid email first");
            return;
          }
          btn.setDisabled(true);
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
            btn.setDisabled(false);
            this.redisplay();
          }
        }),
      );

    new Setting(containerEl)
      .setName("Sign in on another device")
      .setDesc(
        "Already subscribed? Email a one-time link. Open it, then Refresh status here.",
      )
      .addText((text) => {
        text.setPlaceholder("you@example.com").inputEl.dataset.plusMagicEmail =
          "1";
      })
      .addButton((btn) =>
        btn.setButtonText("Send sign-in link").onClick(async () => {
          const input = containerEl.querySelector(
            "input[data-plus-magic-email]",
          );
          const email =
            input instanceof HTMLInputElement ? input.value.trim() : "";
          if (!email.includes("@")) {
            new Notice("Enter a valid email first");
            return;
          }
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
        }),
      );

    // Advanced: paste session (restore fallback)
    new Setting(containerEl)
      .setName("Advanced: paste session")
      .setDesc("Only if Refresh status does not work after the sign-in link.")
      .addText((text) => {
        text.setPlaceholder("sess_…").inputEl.dataset.plusSession = "1";
      })
      .addButton((btn) =>
        btn.setButtonText("Save session").onClick(async () => {
          const input = containerEl.querySelector("input[data-plus-session]");
          const sessionToken =
            input instanceof HTMLInputElement ? input.value.trim() : "";
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
              new Notice(
                "Session not accepted. Request a fresh sign-in link.",
                8000,
              );
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
              remaining:
                typeof j.remaining === "number" ? j.remaining : undefined,
              periodEnd:
                typeof j.periodEnd === "string" ? j.periodEnd : undefined,
              refreshedAt: Date.now(),
            });
            new Notice("Atoms Plus session saved on this device");
            this.redisplay();
          } catch (e) {
            const msg = e instanceof Error ? e.message : "network error";
            new Notice(`Could not reach Plus service (${msg})`, 8000);
          }
        }),
      );

    containerEl.createEl("p", {
      text: "When you use Plus, captures are sent securely to Anthropic under our account. We don’t train on your notes.",
      cls: "setting-item-description",
    });
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
    const installUrl = resolveCaptureShortcutInstallUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
    const urlSet = Boolean(installUrl);

    new Setting(containerEl)
      .setName("Daily capture format")
      .setDesc(
        "Write top-level bullets in your daily note: “- thought…”. Today’s note is never auto-processed; use Atoms home → Preview after midnight (or past dailies).",
      );

    new Setting(containerEl)
      .setName("iCloud shortcut link")
      .setDesc(
        "Paste the iCloud share link from Shortcuts (Share → Copy iCloud Link). Syncs with the vault. See docs/capture-shortcut.md for how to build the shortcut.",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://www.icloud.com/shortcuts/…")
          .setValue(this.plugin.settings.captureShortcutInstallUrl)
          .onChange(async (value) => {
            this.plugin.settings.captureShortcutInstallUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Capture Atom shortcut")
      .setDesc(
        urlSet
          ? `Install or update Capture Atom, the iOS shortcut (v${CAPTURE_SHORTCUT_VERSION}). Opens your iCloud link — Shortcuts.app still needs confirm. Acked: ${acked ?? "never"}.`
          : `No link yet — paste an iCloud URL above (or create the shortcut on your phone, then paste). Version tag: ${CAPTURE_SHORTCUT_VERSION}.`,
      )
      .addButton((btn) =>
        btn
          .setButtonText(labelInstallOrUpdate(acked))
          .setDisabled(!urlSet)
          .onClick(() => {
            if (!urlSet) {
              new Notice(
                "Paste an iCloud shortcut link above first (Shortcuts → Share → Copy iCloud Link).",
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
      text: "Stored only on this device (not synced via data.json). Default off. Requires a one-time privacy acknowledgment — unattended runs send titles + captures to Anthropic.",
      cls: "setting-item-description",
    });

    const load = (k: string): unknown => loadLocal(this.app, k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);

    new Setting(containerEl)
      .setName("Data egress acknowledgment")
      .setDesc(
        "I understand auto-run will send my vault title graph and each capture to the Anthropic API over TLS when Obsidian opens (unattended).",
      )
      .addToggle((toggle) =>
        toggle.setValue(state.egressAcked).onChange((on) => {
          writeEgressAck(save, on);
          if (!on) {
            writeAutoRunEnabled(save, false);
          }
          this.redisplay();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-run on open")
      .setDesc(
        state.egressAcked
          ? "When enabled: once per calendar day after layout + metadata are ready. Caps work per launch; offline fails silently until next day."
          : "Enable the acknowledgment above first.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(state.enabled && state.egressAcked)
          .setDisabled(!state.egressAcked)
          .onChange((on) => {
            if (on && !state.egressAcked) {
              writeAutoRunEnabled(save, false);
              this.redisplay();
              return;
            }
            writeAutoRunEnabled(save, on);
            this.redisplay();
          }),
      );

    if (state.lastRunDay) {
      containerEl.createEl("p", {
        text: `Last auto-run day (this device): ${state.lastRunDay}`,
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

  private renderVocabularySection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Tag vocabulary");
    containerEl.createEl("p", {
      text: "Active tags may be applied by the model. #person, #preferences, and #relationship always work (smart defaults). Proposed tags need one-tap approval. People: link to a hub note (e.g. Alex); atoms stay flat — use backlinks, not AI folders.",
      cls: "setting-item-description",
    });

    const active = [...this.plugin.settings.activeVocabulary].sort((a, b) =>
      a.localeCompare(b),
    );

    for (const tag of active) {
      new Setting(containerEl)
        .setName(`#${tag}`)
        .setDesc("Active — eligible for classification")
        .addToggle((toggle) =>
          toggle.setValue(true).onChange(async (on) => {
            if (!on) {
              this.plugin.settings.activeVocabulary = removeActiveTag(
                tag,
                this.plugin.settings.activeVocabulary,
              );
              await this.plugin.saveSettings();
              this.redisplay();
            }
          }),
        );
    }

    new Setting(containerEl)
      .setName("Add custom Active tag")
      .setDesc("Lowercase, no # required.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. health")
          .setValue(this.customTagDraft)
          .onChange((v) => {
            this.customTagDraft = v;
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Add").onClick(async () => {
          const t = normalizeTag(this.customTagDraft);
          if (!t) return;
          this.plugin.settings.activeVocabulary = addCustomActiveTag(
            t,
            this.plugin.settings.activeVocabulary,
          );
          this.customTagDraft = "";
          await this.plugin.saveSettings();
          this.redisplay();
        }),
      );

    // Proposed tags awaiting approval
    const proposed = this.plugin.settings.proposedTags ?? [];
    if (proposed.length > 0) {
      settingHeading(containerEl, "Proposed (approve to activate)");
      for (const tag of proposed) {
        new Setting(containerEl)
          .setName(`#${tag}`)
          .setDesc("From classify runs — not applied until approved")
          .addButton((btn) =>
            btn.setButtonText("Approve").setCta().onClick(async () => {
              const next = approveProposedTag(
                tag,
                this.plugin.settings.activeVocabulary,
                this.plugin.settings.proposedTags,
              );
              this.plugin.settings.activeVocabulary = next.activeVocabulary;
              this.plugin.settings.proposedTags = next.proposedTags;
              await this.plugin.saveSettings();
              this.redisplay();
            }),
          )
          .addButton((btn) =>
            btn.setButtonText("Dismiss").onClick(async () => {
              this.plugin.settings.proposedTags =
                this.plugin.settings.proposedTags.filter(
                  (t) => normalizeTag(t) !== normalizeTag(tag),
                );
              await this.plugin.saveSettings();
              this.redisplay();
            }),
          );
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
      new Setting(containerEl)
        .setName(`#${tag}`)
        .setDesc(`${count} use(s) — tap to promote to Active`)
        .addButton((btn) =>
          btn.setButtonText("Activate").onClick(async () => {
            this.plugin.settings.activeVocabulary = addCustomActiveTag(
              tag,
              this.plugin.settings.activeVocabulary,
            );
            await this.plugin.saveSettings();
            this.redisplay();
          }),
        );
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
    new Setting(containerEl)
      .setName("Privacy acknowledgment")
      .setDesc(
        "I understand: (1) only Atoms/ leaves this device; (2) bodies are stored on Atoms Plus servers; (3) the host can decrypt at rest in v1 (not zero-knowledge); (4) when I chat in Claude, Anthropic receives tool results (titles, snippets, bodies); when I chat in ChatGPT, OpenAI receives them; (5) with Allow filing, Claude or ChatGPT can queue new atom bodies to Plus until Obsidian writes them under Atoms/; (6) Wipe deletes the cloud mirror, pending outbox writes, and connector tokens; (7) turning Ask off does not wipe.",
      )
      .addToggle((tog) =>
        tog.setValue(ack).onChange(async (on) => {
          this.plugin.settings.askPrivacyAckAt = on
            ? new Date().toISOString()
            : "";
          if (!on) this.plugin.settings.askEnabled = false;
          await this.plugin.saveSettings();
          this.redisplay();
        }),
      );

    new Setting(containerEl)
      .setName("Enable Ask mirror")
      .setDesc(
        "Keep the cloud Atoms/ copy current while Obsidian is open (vault events + Process/Update).",
      )
      .addToggle((tog) =>
        tog
          .setValue(this.plugin.settings.askEnabled)
          .setDisabled(!ack)
          .onChange(async (on) => {
            if (on && !this.plugin.settings.askPrivacyAckAt) {
              new Notice("Acknowledge privacy first");
              this.redisplay();
              return;
            }
            this.plugin.settings.askEnabled = on;
            if (!on) this.plugin.settings.askWriteAckAt = "";
            await this.plugin.saveSettings();
            if (on) {
              void this.plugin.syncAskMirror({ force: false }).catch(() => {
                /* */
              });
            }
            this.redisplay();
          }),
      );

    const writeAck = Boolean(this.plugin.settings.askWriteAckAt);
    new Setting(containerEl)
      .setName("Allow filing from Claude or ChatGPT")
      .setDesc(
        "When on, this vault applies create/continue outbox items under your Atoms folder (new files only; never rewrites existing bodies). Requires Ask mirror enabled.",
      )
      .addToggle((tog) =>
        tog
          .setValue(writeAck)
          .setDisabled(!ack || !this.plugin.settings.askEnabled)
          .onChange(async (on) => {
            if (on && !this.plugin.settings.askEnabled) {
              new Notice("Enable Ask mirror first");
              this.redisplay();
              return;
            }
            this.plugin.settings.askWriteAckAt = on
              ? new Date().toISOString()
              : "";
            await this.plugin.saveSettings();
            if (on) {
              void this.plugin.applyAskOutbox().catch(() => {
                /* */
              });
            }
            this.redisplay();
          }),
      );

    new Setting(containerEl)
      .setName("MCP connector URL")
      .setDesc(
        "Same URL for both. Claude → Settings → Connectors → Add custom connector. ChatGPT → Settings → Apps & connectors (Developer mode) → add this URL → complete OAuth.",
      )
      .addText((text) => {
        text.setValue(mcpUrl).setDisabled(true);
        text.inputEl.addClass("atoms-settings-mcp-url-input");
      })
      .addButton((btn) =>
        btn.setButtonText("Copy").onClick(async () => {
          await navigator.clipboard.writeText(mcpUrl);
          new Notice("MCP URL copied");
        }),
      );

    // Status line from device-local stamps (N = last known server count)
    const lastOk = String(
      (this.app.loadLocalStorage(LS_ASK_MIRROR_LAST_SUCCESS) as unknown) ?? "",
    );
    const lastErr = String(
      (this.app.loadLocalStorage(LS_ASK_MIRROR_LAST_ERROR) as unknown) ?? "",
    ).trim();
    const serverCountRaw: unknown = this.app.loadLocalStorage(
      LS_ASK_MIRROR_SERVER_COUNT,
    ) as unknown;
    const serverCount =
      serverCountRaw != null && String(serverCountRaw).trim() !== ""
        ? String(serverCountRaw)
        : "—";
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
    const errSnip = lastErr.replace(/\s+/g, " ").trim().slice(0, 96);
    const statusLine = lastErr
      ? `Ask mirror: ${serverCount} · push failed${errSnip ? ` — ${errSnip}` : ""} · Sync now to retry`
      : `Ask mirror: ${serverCount} · last pushed ${relative(lastOk)}`;
    containerEl.createEl("p", {
      text: statusLine,
      cls: lastErr
        ? "setting-item-description atoms-ask-mirror-error"
        : "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc(
        "Full refresh from this device’s Atoms/ (orphans removed on Plus). Multi-device: incomplete vault here can delete cloud rows for atoms only on another device until Obsidian Sync catches up.",
      )
      .addButton((btn) =>
        btn.setButtonText("Sync now").setCta().onClick(async () => {
          const n = await this.plugin.syncAskMirror({ force: true });
          if (n < 0) return;
          new Notice(
            n === 0
              ? "Ask mirror reconciled"
              : `Ask mirror: uploaded ${n} atom(s)`,
          );
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
          this.app.saveLocalStorage(LS_ASK_MIRROR_SERVER_COUNT, String(r.count));
          new Notice(`Ask mirror: ${r.count} atom(s)`);
          this.redisplay();
        }),
      );

    new Setting(containerEl)
      .setName("Wipe cloud copy")
      .setDesc(
        "Delete mirrored atoms, pending Ask writes (outbox), and revoke Ask connector tokens for this account. Does not delete vault files.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Wipe")
          .setDestructive()
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
                b
                  .setButtonText("Wipe")
                  .setDestructive()
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
                      this.plugin.settings.askMirrorHashes = {};
                      writeAskMirrorHashes(
                        (k, v) => this.app.saveLocalStorage(k, v),
                        {},
                      );
                      this.app.saveLocalStorage(LS_ASK_MIRROR_LAST_ERROR, "");
                      this.app.saveLocalStorage(LS_ASK_MIRROR_LAST_SUCCESS, "");
                      this.app.saveLocalStorage(LS_ASK_MIRROR_SERVER_COUNT, "0");
                      this.app.saveLocalStorage(LS_ASK_MIRROR_HASHES, "{}");
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
