import {
  CreateStartUpPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { normalizeEvenAction } from "./platform/even";
import { probeRecoveryCapabilities } from "./storage/capabilities";

const status = document.querySelector<HTMLOutputElement>("#capability-status");

async function startCapabilityProbe(): Promise<void> {
  if (!status) return;
  status.dataset.state = "checking";

  const bridge = await waitForEvenAppBridge();
  const startup = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: "capability-status",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          content: "Checking device",
          isEventCapture: 1,
        }),
      ],
    }),
  );
  if (startup !== StartUpPageCreateResult.success) {
    status.dataset.state = "blocked";
    status.dataset.reason = "startup-page-unavailable";
    return;
  }

  bridge.onEvenHubEvent((event) => {
    const action = normalizeEvenAction(event);
    if (action) {
      window.dispatchEvent(new CustomEvent("atoms-even-action", { detail: action }));
    }
  });

  const capability = await probeRecoveryCapabilities();
  status.dataset.state = capability.state;
  status.value = capability.state;
  if (capability.state === "blocked") {
    status.dataset.reason = capability.reason;
    status.value = `${capability.state}: ${capability.reason}`;
  }
}

void startCapabilityProbe().catch(() => {
  if (status) {
    status.dataset.state = "blocked";
    status.dataset.reason = "bridge-unavailable";
  }
});
