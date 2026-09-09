const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SIMULATOR_QUOTA_BYTES = 64 * 1024 * 1024;

export function requireLoopbackHttpBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("simulator_base_url_refused");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("simulator_base_url_refused");
  }
  return url.origin;
}

/**
 * The pinned simulator WebView has IndexedDB and Web Crypto but no
 * navigator.storage quota/persistence API. Keep those correctness checks real
 * and replace only the unavailable browser capability for local simulation.
 */
export function simulatorRecoveryDependencies() {
  return {
    storage: {
      estimate: async () => ({ quota: SIMULATOR_QUOTA_BYTES, usage: 0 }),
      persist: async () => true,
    },
  };
}
