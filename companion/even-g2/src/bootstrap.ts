import { waitForEvenAppBridge, type EvenHubEvent } from "@evenrealities/even_hub_sdk";

import { CreateFlow } from "./app/createFlow";
import { G2AppController } from "./app/controller";
import { QueryFlow } from "./app/queryFlow";
import { ReadFlow } from "./app/readFlow";
import { G2AuthClient, G2HttpClient, pairingFailureReason, type G2Session, type PairingPointer } from "./auth/client";
import { G2CredentialVault } from "./auth/credentials";
import { singleFlight } from "./auth/singleFlight";
import { G2_DISCLOSURE_VERSION, g2ServerSetupReady, readG2ServerSetup, type G2ServerConsent } from "./auth/setup";
import { G2_COPY } from "./i18n/en";
import { LocalTranscriber } from "./audio/localTranscriber";
import { MoonshineWorkerClient } from "./audio/moonshineWorker";
import { EvenLocalAudioSession } from "./platform/localAudio";
import { normalizeEvenAction } from "./platform/even";
import { installEvenSdkEventLogPrivacy } from "./platform/sdkLogPrivacy";
import { AppRecoveryStore } from "./storage/appRecovery";
import { probeRecoveryCapabilities, type RecoveryCapabilityResult } from "./storage/capabilities";
import { renderPhone, type PhoneState } from "./ui/phone";
import { EvenGlassesRenderer } from "./ui/render";

const BINDING_POINTER = "atoms-g2-binding";

function canQueueCaptures(session: G2Session): boolean {
  return session.scopes.includes("g2:capture");
}

function parsePointer(raw: string): PairingPointer | null {
  try {
    const value = JSON.parse(raw) as Partial<PairingPointer>;
    return typeof value.accountId === "string" && typeof value.deviceFamilyId === "string"
      ? { accountId: value.accountId, deviceFamilyId: value.deviceFamilyId }
      : null;
  } catch { return null; }
}

function audioBytes(event: EvenHubEvent): Uint8Array | null {
  const raw = event.audioEvent?.audioPcm;
  if (!raw) return null;
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}

async function captureFingerprint(request: { captureId: string; capturedAt: string; body: string }): Promise<string> {
  const canonical = JSON.stringify({ version: 1, ...request });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function showStartupStatus(
  status: HTMLOutputElement,
  state: "checking" | "blocked",
  copy: string,
  reason?: string,
): void {
  status.dataset.state = state;
  if (reason) status.dataset.reason = reason;
  else delete status.dataset.reason;
  status.textContent = copy;
}

export async function startG2Companion(
  baseUrl: string,
  capabilityProbe: () => Promise<RecoveryCapabilityResult> = probeRecoveryCapabilities,
): Promise<void> {
  const status = document.querySelector<HTMLOutputElement>("#capability-status");
  if (!status) return;
  const privateTestOrigin = location.origin;
  showStartupStatus(status, "checking", G2_COPY.checking);
  let capability: RecoveryCapabilityResult;
  try {
    capability = await capabilityProbe();
  } catch {
    showStartupStatus(status, "blocked", G2_COPY.startupBlocked, "probe-failed");
    return;
  }
  if (capability.state === "blocked") {
    showStartupStatus(status, "blocked", G2_COPY.startupBlocked, capability.reason);
    return;
  }
  const releaseSdkLogPrivacy = installEvenSdkEventLogPrivacy();
  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>;
  try {
    bridge = await waitForEvenAppBridge();
  } catch (error) {
    releaseSdkLogPrivacy();
    throw error;
  }
  const renderer = new EvenGlassesRenderer(bridge);
  const vault = new G2CredentialVault();
  await vault.createOrLoadProofKey();
  const auth = new G2AuthClient(baseUrl, vault);
  const http = new G2HttpClient(auth);
  let controller: G2AppController | null = null;
  let audio: EvenLocalAudioSession | null = null;
  let removeEvents = () => {};
  let disclosureRevision = 0;

  const phone = (state: PhoneState) => renderPhone(status, state, {
    connect: (code) => { void pair(code); },
    acceptDisclosure: () => { void acceptDisclosure(); },
    reconnect: () => { phone({ screen: "unpaired", origin: privateTestOrigin }); },
    saveCapture: () => { void controller?.handle({ kind: "click", envelope: "list", selectedIndex: 0 }); },
    retryCapture: () => { void controller?.handle({ kind: "click", envelope: "list", selectedIndex: 1 }); },
  });

  let bootSession!: (session: G2Session) => Promise<void>;

  const pair = singleFlight(async (code: string): Promise<void> => {
    phone({ screen: "loading", operation: "pairing" });
    try {
      const session = await auth.pair(code);
      if (!canQueueCaptures(session)) {
        await renderer.render({ screen: "unpaired", selectedIndex: 0 });
        phone({ screen: "unpaired", origin: privateTestOrigin });
        return;
      }
      await bridge.setLocalStorage(BINDING_POINTER, JSON.stringify({ accountId: session.accountId, deviceFamilyId: session.deviceFamilyId }));
      const consent = await readG2ServerSetup((path, body) => http.post<G2ServerConsent>(path, body));
      disclosureRevision = consent.revision;
      if (g2ServerSetupReady(consent)) await bootSession(session);
      else {
        await renderer.render({ screen: "setup-required", selectedIndex: 0 });
        phone({ screen: consent.g2Disclosure.granted ? "setup-required" : "disclosure" });
      }
    } catch (error) {
      phone({ screen: "pairing-error", reason: pairingFailureReason(error), origin: privateTestOrigin });
    }
  });

  const acceptDisclosure = singleFlight(async (): Promise<void> => {
    try {
      const consent = await http.post<G2ServerConsent>("/v1/g2/captures/disclosure", {
        baseRevision: disclosureRevision,
        freshGesture: true,
        disclosure: { granted: true, version: G2_DISCLOSURE_VERSION },
      });
      disclosureRevision = consent.revision;
      if (!g2ServerSetupReady(consent)) {
        phone({ screen: consent.g2Disclosure.granted ? "setup-required" : "disclosure" });
        return;
      }
      const session = auth.current();
      if (!session) throw new Error("setup_required");
      await bootSession(session);
    } catch { phone({ screen: "setup-required" }); }
  });

  bootSession = singleFlight(async (session: G2Session): Promise<void> => {
    const recovery = new AppRecoveryStore();
    await recovery.open(session.accountId, session.deviceFamilyId);
    audio = new EvenLocalAudioSession(
      bridge,
      () => new LocalTranscriber({ worker: new MoonshineWorkerClient() }),
    );
    await audio.initialize();

    const create = new CreateFlow({
      enqueue: async (request) => http.post("/v1/g2/captures", {
        ...request,
        fingerprint: await captureFingerprint(request),
      }),
    }, recovery);
    const query = new QueryFlow({ query: (question) => http.post("/v1/g2/query", { question }) });
    const read = new ReadFlow({
      recent: (offset = 0) => http.post("/v1/g2/recent", { offset, limit: 20 }),
      fetch: (id, offset) => http.post("/v1/g2/fetch", { id, offset, maxBytes: 2048 }),
    });

    controller = new G2AppController({
      render: (state) => {
        if (state.screen === "confirmation") {
          phone({ screen: "review", title: state.title, transcript: state.transcript ?? state.title });
        }
        return renderer.render(state);
      },
      startRecording: async (purpose) => { await audio?.start(purpose); },
      stopRecording: async () => {
        const result = await audio?.stop();
        if (!result) throw new Error("recording_not_active");
        return result;
      },
      stopAudio: async (reason = "background") => { await audio?.teardown(reason); },
      closeSockets: () => { void audio?.teardown("background"); },
      reconnect: () => { phone({ screen: "unpaired", origin: privateTestOrigin }); },
      requestSystemExit: async () => { await bridge.shutDownPageContainer(1); },
      unsubscribe: () => {
        removeEvents();
        releaseSdkLogPrivacy();
      },
      create,
      query,
      read,
    });
    removeEvents();
    removeEvents = bridge.onEvenHubEvent((event) => {
      const pcm = audioBytes(event);
      if (pcm) {
        try { audio?.accept(pcm); }
        catch (error) { void controller?.audioInputFailed(error); }
      }
      const action = normalizeEvenAction(event);
      if (!action || !controller) return;
      if (action.kind === "foreground-exit") void controller.systemEvent("foreground-exit");
      else if (action.kind === "system-exit") void controller.systemEvent("system-exit");
      else if (action.kind === "abnormal-exit") void controller.systemEvent("abnormal-exit");
      else void controller.handle(action);
    });
    phone({ screen: "ready" });
    await controller.start({ paired: true, setupReady: true, recoveredRecording: false });
  });

  const pointer = parsePointer(await bridge.getLocalStorage(BINDING_POINTER));
  const restored = pointer ? await auth.restore(pointer) : null;
  if (restored && canQueueCaptures(restored)) {
    try {
      const consent = await readG2ServerSetup((path, body) => http.post<G2ServerConsent>(path, body));
      disclosureRevision = consent.revision;
      if (g2ServerSetupReady(consent)) await bootSession(restored);
      else {
        await renderer.render({ screen: "setup-required", selectedIndex: 0 });
        phone({ screen: consent.g2Disclosure.granted ? "setup-required" : "disclosure" });
      }
    } catch {
      await renderer.render({ screen: "setup-required", selectedIndex: 0 });
      phone({ screen: "setup-required" });
    }
  } else {
    await renderer.render({ screen: "unpaired", selectedIndex: 0 });
    phone({ screen: "unpaired", origin: privateTestOrigin });
  }
}

export function markBridgeUnavailable(): void {
  const status = document.querySelector<HTMLOutputElement>("#capability-status");
  if (status) {
    showStartupStatus(status, "blocked", G2_COPY.startupBlocked, "bridge-unavailable");
  }
}
