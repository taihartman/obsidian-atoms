import { G2_COPY } from "./i18n/en";

type AutoSetupOptions = {
  attempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

export function requireSimulatorPairingCode(raw: string): string {
  const code = String(raw || "").trim();
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error("simulator_pairing_code_refused");
  return code;
}

async function defaultWait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export async function autoDriveSimulatorSetup(
  root: HTMLElement,
  rawPairingCode: string,
  options: AutoSetupOptions = {},
): Promise<void> {
  const code = requireSimulatorPairingCode(rawPairingCode);
  const attempts = options.attempts ?? 200;
  const wait = options.wait ?? defaultWait;
  const input = root.querySelector<HTMLInputElement>("input");
  const connect = root.querySelector<HTMLButtonElement>("button");
  if (!input || !connect || connect.textContent !== G2_COPY.connect) {
    throw new Error("simulator_pairing_form_unavailable");
  }
  input.value = code;
  connect.click();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const disclosure = root.querySelector<HTMLButtonElement>("button");
    const stillHasInput = Boolean(root.querySelector<HTMLInputElement>("input"));
    if (!stillHasInput && disclosure?.textContent?.trim() === G2_COPY.acceptDisclosure) {
      disclosure.click();
      return;
    }
    await wait(50);
  }
  throw new Error("simulator_disclosure_form_unavailable");
}
