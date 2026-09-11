import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";

const CLOCK_SKEW_SEC = 300;

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function g2JwkThumbprint(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || jwk.d) {
    throw new Error("invalid_public_jwk");
  }
  const canonical = JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y });
  return createHash("sha256").update(canonical).digest("base64url");
}

export function createG2Nonce(secret = process.env.G2_DPOP_NONCE_SECRET || randomBytes(32).toString("hex"), now = Date.now()) {
  const exp = now + 5 * 60 * 1000;
  const body = `${exp}.${randomBytes(16).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyG2Nonce(nonce, secret, now = Date.now()) {
  const parts = String(nonce || "").split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || Number(parts[0]) < now) return false;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  return safeEqual(parts[2], expected);
}

export async function validateG2Dpop({ proof, method, targetUrl, nonce, nonceSecret, token, expectedJkt, store, now = Date.now() }) {
  try {
    const parts = String(proof || "").split(".");
    if (parts.length !== 3) return null;
    const header = decodePart(parts[0]); const claims = decodePart(parts[1]);
    if (header.typ !== "dpop+jwt" || header.alg !== "ES256") return null;
    const jkt = g2JwkThumbprint(header.jwk);
    if (expectedJkt && !safeEqual(jkt, expectedJkt)) return null;
    if (claims.htm !== String(method).toUpperCase() || claims.htu !== targetUrl) return null;
    if (!Number.isInteger(claims.iat) || Math.abs(Math.floor(now / 1000) - claims.iat) > CLOCK_SKEW_SEC) return null;
    if (typeof claims.jti !== "string" || claims.jti.length < 16 || claims.jti.length > 200) return null;
    if (!verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: createPublicKey({ key: header.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"))) return null;
    if (!verifyG2Nonce(claims.nonce, nonceSecret, now) || (nonce && !safeEqual(claims.nonce, nonce))) return null;
    if (token) {
      const ath = createHash("sha256").update(token).digest("base64url");
      if (!safeEqual(claims.ath, ath)) return null;
    } else if (claims.ath !== undefined) return null;
    // A future-skewed proof remains otherwise valid until iat + skew. Keep its
    // replay marker for that whole interval, not merely skew past receipt.
    if (!(await store.g2ConsumeProof(claims.jti, (claims.iat + CLOCK_SKEW_SEC) * 1000, now))) return null;
    return { jkt, claims };
  } catch {
    return null;
  }
}
