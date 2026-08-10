/**
 * PKCE S256 verifier/challenge for the magic-link handoff (U7, KTD6).
 *
 * The plugin mints a random verifier, sends SHA-256 of it at mint time, and
 * presents the raw verifier at both the peek and the exchange. The server only
 * ever stores the hash.
 *
 * `crypto.getRandomValues` and `crypto.subtle` are called directly rather than
 * injected: SHA-256 is deterministic so a fake digest asserts nothing, and
 * "two verifiers differ" is only meaningful against real randomness. A seam
 * here would buy no testability while hiding which implementation runs on
 * device.
 *
 * WebCrypto is probed, never assumed — the plugin has never used it and the
 * Obsidian mobile webview is unverified (U12 carries the device probe). When it
 * is absent the correct outcome is to stop and surface: the FNV-1a in
 * `askMirror.ts` is not a cryptographic hash and substituting it would silently
 * weaken the verifier binding to nothing.
 */

/** Entropy is specified, not inferred (KTD6). */
const VERIFIER_BYTES = 32;

export const WEBCRYPTO_UNAVAILABLE_MESSAGE =
  "Atoms Plus sign-in needs WebCrypto (crypto.subtle), which this platform does not provide. Sign in on a device where it is available.";

type WebCryptoLike = {
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
  subtle: { digest: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer> };
};

/** Web globals are acceptable in this layer (see `plusClient.ts`). Prefer window for popout parity. */
function webCrypto(): WebCryptoLike | null {
  const c = (window as Window & { crypto?: Partial<WebCryptoLike> }).crypto;
  if (!c || typeof c.getRandomValues !== "function") return null;
  if (typeof c.subtle?.digest !== "function") return null;
  return c as WebCryptoLike;
}

/** Cheap capability check — both halves of the verifier path, probed together. */
export function hasWebCrypto(): boolean {
  return webCrypto() !== null;
}

function requireWebCrypto(): WebCryptoLike {
  const c = webCrypto();
  if (!c) throw new Error(WEBCRYPTO_UNAVAILABLE_MESSAGE);
  return c;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 32 bytes from `crypto.getRandomValues`, base64url-encoded.
 * Throws (rather than minting an unhashable verifier) when WebCrypto is absent,
 * so the platform limitation surfaces at the sign-in request rather than at the
 * exchange.
 */
export function generateVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  requireWebCrypto().getRandomValues(bytes);
  return base64url(bytes);
}

/** base64url(SHA-256(verifier)) — the value sent at mint time. */
export async function s256Challenge(verifier: string): Promise<string> {
  const crypto = requireWebCrypto();
  // Verifiers are base64url by construction, so one byte per char is exact.
  const data = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) data[i] = verifier.charCodeAt(i) & 0xff;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}
