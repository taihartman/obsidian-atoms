/**
 * Encoding pin for the PKCE S256 digest.
 *
 * `pkceChallengeS256` is the single home for "SHA-256, base64url" in this
 * service, and `verifyPkce` is its only consumer today. The failure this file
 * exists to catch is silent: if either side drifts to hex — or to base64 with
 * padding — the compare stops matching and a sign-in is refused with no error
 * to read. Nothing else asserts the encoding directly; the OAuth tests each
 * compute their own challenge, so a change made to helper and test together
 * would pass unnoticed.
 *
 * The vector is RFC 7636 Appendix B, so this pins against the spec rather than
 * against our own output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pkceChallengeS256, verifyPkce } from "../src/store/askHelpers.mjs";

/** RFC 7636 Appendix B. */
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const RFC_CHALLENGE_HEX =
  "13d31e961a1ad8ec2f16b10c4c982e0876a878ad6df144566ee1894acb70f9c3";

describe("pkce s256 digest encoding", () => {
  it("matches the RFC 7636 vector (base64url, unpadded)", () => {
    assert.equal(pkceChallengeS256(RFC_VERIFIER), RFC_CHALLENGE);
  });

  it("is not hex — the drift this pin exists to catch", () => {
    const dig = pkceChallengeS256(RFC_VERIFIER);
    assert.notEqual(dig, RFC_CHALLENGE_HEX);
    assert.equal(dig.length, 43, "sha256 base64url is 43 chars; hex is 64");
    assert.ok(!/^[0-9a-f]+$/.test(dig), "hex-shaped digest means it drifted");
  });

  it("is base64url, not standard base64 (no +, /, or = padding)", () => {
    // A verifier whose digest exercises the base64 alphabet difference.
    const dig = pkceChallengeS256("atoms-plus-verifier-alphabet-probe");
    assert.ok(!dig.includes("+") && !dig.includes("/") && !dig.includes("="));
    const std = createHash("sha256")
      .update("atoms-plus-verifier-alphabet-probe")
      .digest("base64");
    assert.notEqual(dig, std);
  });
});

describe("verifyPkce shares that digest", () => {
  it("accepts the challenge pkceChallengeS256 mints", () => {
    assert.equal(
      verifyPkce(RFC_VERIFIER, pkceChallengeS256(RFC_VERIFIER), "S256"),
      true,
    );
    assert.equal(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE, "S256"), true);
  });

  it("refuses a hex challenge for the correct verifier", () => {
    // Fails the moment either side is re-encoded as hex.
    assert.equal(verifyPkce(RFC_VERIFIER, RFC_CHALLENGE_HEX, "S256"), false);
  });

  it("refuses a wrong verifier", () => {
    assert.equal(verifyPkce("not-the-verifier", RFC_CHALLENGE, "S256"), false);
  });

  it("cannot be satisfied by a plaintext-equal pair under S256", () => {
    // The plaintext branch belongs to non-S256 rows only. If it ever leaked
    // into the S256 path, sending challenge === verifier would authorize.
    assert.equal(verifyPkce(RFC_VERIFIER, RFC_VERIFIER, "S256"), false);
    assert.equal(verifyPkce("v", "v", "S256"), false);
    assert.equal(verifyPkce(RFC_VERIFIER, RFC_VERIFIER), false);
  });

  it("keeps the plaintext compare confined to a non-S256 method", () => {
    // Documents today's behavior so a future change to it is deliberate.
    // Unreachable over HTTP: /authorize rejects any method but S256.
    assert.equal(verifyPkce("v", "v", "plain"), true);
    assert.equal(verifyPkce("v", pkceChallengeS256("v"), "plain"), false);
  });
});
