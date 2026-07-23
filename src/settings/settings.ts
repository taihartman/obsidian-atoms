import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
} from "obsidian";
import type AtomsPlugin from "../plugin/main";
import { aggregateTagsFromFileCaches } from "../pipeline/context";
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
  readPlusSession,
  writePlusSession,
} from "../platform/filingAuth";
import {
  atomsPlusOfferCopy,
  atomsPlusTopUpCopy,
} from "../home/atomsHomeData";
import {
  DEFAULT_PLUS_BASE_URL,
  requestMagicLink,
  createCheckout,
  createBillingPortal,
  getEntitlement,
  signOutPlus,
} from "../platform/plusClient";
import { requestUrl } from "obsidian";
import { plusFetchRequest } from "../platform/plusClient";
import {
  addCustomActiveTag,
  approveProposedTag,
  normalizeTag,
  removeActiveTag,
  tagCountsSorted,
} from "../pipeline/vocabulary";

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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const version = this.plugin.manifest.version ?? "?";
    settingHeading(containerEl, "Atoms");
    containerEl.createEl("p", {
      text: `Second brain: files keepable captures (ideas, preferences, lists, media) as flat Atoms/ notes. Not a to-do app — pure logistics are marked noise. Capture itself is handled by your iOS Shortcut.`,
      cls: "setting-item-description",
    });
    containerEl.createEl("p", {
      text: `Version ${version}`,
      cls: "setting-item-description",
    });

    this.renderCaptureSection(containerEl);
    this.renderApiSection(containerEl);
    this.renderPlusSection(containerEl);
    this.renderAutoRunSection(containerEl);
    this.renderModelSection(containerEl);
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
          this.display();
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
    const offer = atomsPlusOfferCopy();
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
            this.display();
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
            this.display();
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
            this.display();
          }),
        );
      containerEl.createEl("p", {
        text: "To use your own API key instead, add it under API Key. Plus is optional.",
        cls: "setting-item-description",
      });
      return;
    }

    // Signed out
    new Setting(containerEl)
      .setName("Skip the API Key")
      .setDesc(
        "Atoms Plus files your captures for you. Or keep using your own key. It’s free forever, and the full app stays yours either way.",
      )
      .addButton((btn) =>
        btn.setButtonText("See Plans").setCta().onClick(() => {
          const lines = [
            offer.title,
            offer.priceMonthly,
            offer.priceYearly,
            ...offer.bullets,
            offer.costReason,
            offer.freePath,
            offer.finePrint,
          ];
          new Notice(lines.join(" · ").slice(0, 450), 12000);
        }),
      );

    new Setting(containerEl)
      .setName("Email for magic link")
      .setDesc(
        "Dogfood: request a link from the Plus service (see server console), or paste a session below.",
      )
      .addText((text) => {
        text.setPlaceholder("you@example.com").inputEl.dataset.plusEmail = "1";
      })
      .addButton((btn) =>
        btn.setButtonText("Send Magic Link").onClick(async () => {
          const input = containerEl.querySelector(
            "input[data-plus-email]",
          ) as HTMLInputElement | null;
          const email = input?.value?.trim() || "";
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
            "Magic link requested — open the link from the Plus server console, then paste the session token below.",
            8000,
          );
        }),
      );

    new Setting(containerEl)
      .setName("Paste session (dogfood)")
      .setDesc("After opening the magic link in a browser, paste sess_… here.")
      .addText((text) => {
        text.setPlaceholder("sess_…").inputEl.dataset.plusSession = "1";
      })
      .addButton((btn) =>
        btn.setButtonText("Save Session").onClick(async () => {
          const input = containerEl.querySelector(
            "input[data-plus-session]",
          ) as HTMLInputElement | null;
          const sessionToken = input?.value?.trim() || "";
          if (!sessionToken.startsWith("sess_")) {
            new Notice("Session should look like sess_…");
            return;
          }
          // Only persist after server proves the session (QA P1).
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
                "Session not accepted by Plus service. Check the URL and paste a fresh sess_ from the magic link.",
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
            new Notice("Atoms Plus session verified and saved on this device");
            this.display();
          } catch (e) {
            const msg = e instanceof Error ? e.message : "network error";
            new Notice(
              `Could not reach Plus service (${msg}). Is it running at ${base}?`,
              8000,
            );
          }
        }),
      );

    new Setting(containerEl)
      .setName("Start Free Trial (dogfood)")
      .setDesc("Requires a saved session. Grants trial period via Plus service.")
      .addButton((btn) =>
        btn.setButtonText("Start Free Trial").onClick(async () => {
          const session = readPlusSession(this.app);
          if (!session) {
            new Notice("Save a Plus session first");
            return;
          }
          const base =
            this.plugin.settings.plusBaseUrl.trim() || DEFAULT_PLUS_BASE_URL;
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
            window.open(r.url, "_blank");
            new Notice(
              "Checkout opened — finish in the browser, then tap Refresh status.",
              10000,
            );
          } else {
            new Notice("Trial granted (dogfood). Refreshing…");
            await this.refreshPlusEntitlement({ quiet: true });
          }
          this.display();
        }),
      );

    containerEl.createEl("p", {
      text: "When you use Plus, captures are sent securely to Anthropic under our account. We don’t train on your notes.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Plus service URL")
      .setDesc(
        `Dogfood: http://127.0.0.1:8787 — empty uses ${DEFAULT_PLUS_BASE_URL}.`,
      )
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:8787")
          .setValue(this.plugin.settings.plusBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.plusBaseUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );
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
      .setName("Capture shortcut")
      .setDesc(
        urlSet
          ? `Install or update the iOS shortcut (v${CAPTURE_SHORTCUT_VERSION}). Opens your iCloud link — Shortcuts.app still needs confirm. Acked: ${acked ?? "never"}.`
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
            this.display();
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
    settingHeading(containerEl, "API & privacy");

    new Setting(containerEl)
      .setName("Privacy")
      .setDesc(
        "Every run sends your vault's note titles, tags, a derived person-hub title list (titles only — never folder paths or hub body content), and each capture to the Anthropic API over TLS (your API key = optional paid usage). The model never rewrites your hand-authored notes — only new files in the atom folder and marker lines under captures. Existing atoms are never overwritten on title collision.",
      );

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
            this.display();
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
          this.display();
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
              this.display();
              return;
            }
            writeAutoRunEnabled(save, on);
            this.display();
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
              this.display();
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
          this.display();
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
              this.display();
            }),
          )
          .addButton((btn) =>
            btn.setButtonText("Dismiss").onClick(async () => {
              this.plugin.settings.proposedTags =
                this.plugin.settings.proposedTags.filter(
                  (t) => normalizeTag(t) !== normalizeTag(tag),
                );
              await this.plugin.saveSettings();
              this.display();
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
            this.display();
          }),
        );
    }
  }

  private renderDevHints(containerEl: HTMLElement) {
    settingHeading(containerEl, "Development");
    const version = this.plugin.manifest.version ?? "?";
    containerEl.createEl("p", {
      text: `Installed version: ${version}. After desktop install + Sync, confirm this matches on phone. ./scripts/install-to-vault.sh reloads via Obsidian CLI.`,
      cls: "setting-item-description",
    });
  }
}
