import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEBCRYPTO_UNAVAILABLE_MESSAGE,
  generateVerifier,
  hasWebCrypto,
  s256Challenge,
} from "../src/platform/pkce";

/** Wire-shape reference from plus-service/test/http-ask-oauth.test.mjs:23-27.
 * Zero-entropy by design — used here only to pin the S256 digest, never as a
 * model for how the plugin mints a verifier (KTD6). */
const REFERENCE_VERIFIER = "v" + "a".repeat(43);
const REFERENCE_CHALLENGE = "RwKoUXkA2bA0ztXTVWbWU2xMlHSWmxXkFsbVSCi4rLk";

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateVerifier", () => {
  it("is URL-safe and decodes to 32 bytes of real randomness", () => {
    const v = generateVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64urlToBytes(v).length).toBe(32);
  });

  it("two mints do not collide", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 32; i++) seen.add(generateVerifier());
    expect(seen.size).toBe(32);
  });

  it("reports the platform limitation when crypto.subtle is absent", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => a,
    });
    expect(hasWebCrypto()).toBe(false);
    expect(() => generateVerifier()).toThrowError(WEBCRYPTO_UNAVAILABLE_MESSAGE);
  });
});

describe("s256Challenge", () => {
  it("matches a known digest computed by the real crypto.subtle", async () => {
    expect(await s256Challenge(REFERENCE_VERIFIER)).toBe(REFERENCE_CHALLENGE);
  });

  it("is URL-safe and unpadded for a freshly minted verifier", async () => {
    const challenge = await s256Challenge(generateVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("reports the platform limitation rather than a non-cryptographic fallback", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => a,
    });
    await expect(s256Challenge(REFERENCE_VERIFIER)).rejects.toThrowError(
      WEBCRYPTO_UNAVAILABLE_MESSAGE,
    );
  });

  it("reports the platform limitation when there is no crypto at all", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(hasWebCrypto()).toBe(false);
    await expect(s256Challenge(REFERENCE_VERIFIER)).rejects.toThrowError(
      WEBCRYPTO_UNAVAILABLE_MESSAGE,
    );
  });
});

describe("hasWebCrypto", () => {
  it("is true under the real platform crypto", () => {
    expect(hasWebCrypto()).toBe(true);
  });
});
