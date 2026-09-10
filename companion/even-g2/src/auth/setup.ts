export type G2ServerConsent = {
  revision: number;
  regrantRequired?: boolean;
  g2Disclosure: { granted: boolean; version: string };
  askMirror: { granted: boolean; version: string };
  askWrite: { granted: boolean; version: string };
};

export const G2_DISCLOSURE_VERSION = "g2-capture-relay-v1";
const SETUP_STATUS_PATH = "/v1/g2/setup/status";

export async function readG2ServerSetup(
  post: (path: string, body: unknown) => Promise<G2ServerConsent>,
): Promise<G2ServerConsent> {
  return post(SETUP_STATUS_PATH, {});
}

export function g2ServerSetupReady(consent: G2ServerConsent): boolean {
  return consent.g2Disclosure.granted && consent.g2Disclosure.version === G2_DISCLOSURE_VERSION;
}
