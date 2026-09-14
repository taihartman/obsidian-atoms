import { markBridgeUnavailable, startG2Companion } from "./bootstrap";
import { probeRecoveryCapabilities } from "./storage/capabilities";
import { requireLoopbackHttpBaseUrl, simulatorRecoveryDependencies } from "./simulatorConfig";
import { autoDriveSimulatorSetup } from "./simulatorSetup";

const parameters = new URLSearchParams(window.location.search);
const rawBaseUrl = parameters.get("plus") || "";

async function startSimulator(): Promise<void> {
  await startG2Companion(
    requireLoopbackHttpBaseUrl(rawBaseUrl),
    () => probeRecoveryCapabilities(simulatorRecoveryDependencies()),
  );
  if (parameters.get("auto") !== "1") return;
  const status = document.querySelector<HTMLOutputElement>("#capability-status");
  if (!status) throw new Error("simulator_phone_root_unavailable");
  await autoDriveSimulatorSetup(status, parameters.get("pair") || "");
}

void startSimulator().catch(markBridgeUnavailable);
