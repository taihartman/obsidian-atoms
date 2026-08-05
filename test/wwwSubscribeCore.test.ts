import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  isValidEmail,
  checkRateLimit,
  parseSubscribeBody,
  CODES,
  clientIpFromHeaders,
} from "../www/functions/_lib/subscribeCore.mjs";

describe("normalizeEmail / isValidEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
  });

  it("accepts ordinary addresses", () => {
    expect(isValidEmail("you@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@mail.co.uk")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a..b@c.com")).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("allows under the limit then blocks", () => {
    const store = new Map();
    const now = 1_000_000;
    expect(checkRateLimit(store, "k", { limit: 2, now }).ok).toBe(true);
    expect(checkRateLimit(store, "k", { limit: 2, now: now + 1 }).ok).toBe(true);
    const blocked = checkRateLimit(store, "k", { limit: 2, now: now + 2 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("parseSubscribeBody", () => {
  it("returns ok_new-path email", () => {
    const r = parseSubscribeBody({ email: " You@Ex.COM " });
    expect(r).toEqual({ ok: true, email: "you@ex.com" });
  });

  it("honeypot short-circuits", () => {
    const r = parseSubscribeBody({ email: "a@b.com", website: "http://spam" });
    expect(r).toEqual({ ok: false, code: CODES.honeypot });
  });

  it("invalid email", () => {
    expect(parseSubscribeBody({ email: "nope" }).code).toBe(CODES.invalid_email);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers cf-connecting-ip", () => {
    const h = new Headers({
      "cf-connecting-ip": "1.2.3.4",
      "x-forwarded-for": "9.9.9.9",
    });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });
});
