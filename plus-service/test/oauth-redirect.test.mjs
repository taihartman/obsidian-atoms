import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_CALLBACK,
  CHATGPT_LEGACY_CALLBACK,
  isAllowedRedirectUri,
  oauthClientLabel,
} from "../src/oauth/constants.mjs";

describe("isAllowedRedirectUri", () => {
  it("allows Claude callback", () => {
    assert.equal(isAllowedRedirectUri(CLAUDE_CALLBACK), true);
  });

  it("allows loopback callback", () => {
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:1234/callback"),
      true,
    );
    assert.equal(isAllowedRedirectUri("http://localhost:9/callback"), true);
  });

  it("allows ChatGPT legacy + connector oauth id", () => {
    assert.equal(isAllowedRedirectUri(CHATGPT_LEGACY_CALLBACK), true);
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/abc123"),
      true,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/aB_9-x"),
      true,
    );
  });

  it("rejects evil and malformed ChatGPT paths", () => {
    assert.equal(isAllowedRedirectUri("https://chatgpt.com/evil"), false);
    assert.equal(
      isAllowedRedirectUri("https://evil.com/connector/oauth/x"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/../admin"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/a/b"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/a%2Fb"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri(
        "https://user:pass@chatgpt.com/connector/oauth/abc",
      ),
      false,
    );
  });
});

describe("oauthClientLabel", () => {
  it("labels ChatGPT and Claude", () => {
    assert.equal(
      oauthClientLabel("https://chatgpt.com/oauth/x/client.json"),
      "ChatGPT",
    );
    assert.equal(
      oauthClientLabel("cli", "https://chatgpt.com/connector/oauth/1"),
      "ChatGPT",
    );
    assert.equal(
      oauthClientLabel("https://claude.ai/api/mcp/auth_callback"),
      "Claude",
    );
  });
});
