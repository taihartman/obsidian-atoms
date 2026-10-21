import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_CALLBACK,
  CHATGPT_LEGACY_CALLBACK,
  isAllowedRedirectUri,
  oauthClientDisplayName,
  oauthClientLabel,
} from "../src/oauth/constants.mjs";
import {
  authorizeChooserForm,
  authorizeEmailForm,
  consentForm,
} from "../src/oauth/html.mjs";

const OPENCLAW_REDIRECT = "http://127.0.0.1:8989/oauth/callback";

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

  it("allows OpenClaw loopback oauth callback on any port", () => {
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:8989/oauth/callback"),
      true,
    );
    assert.equal(
      isAllowedRedirectUri("http://localhost:8989/oauth/callback"),
      true,
    );
    assert.equal(
      isAllowedRedirectUri("http://[::1]:8989/oauth/callback"),
      true,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:9/oauth/callback/"),
      true,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:8989/oauth/foo/../callback"),
      true,
    );
  });

  it("rejects OpenClaw callback neighbors", () => {
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:8989/oauth/callbackevil"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:8989/oauth/callback/extra"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:8989/oauth/mcp/callback"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://gateway.example/oauth/callback"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://gateway.example/oauth/mcp/callback"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.2/oauth/callback"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri(
        "http://127.0.0.1:8989@evil.example/oauth/callback",
      ),
      false,
    );
    assert.equal(
      isAllowedRedirectUri(
        "http://user:pass@127.0.0.1:8989/oauth/callback",
      ),
      false,
    );
    assert.equal(
      isAllowedRedirectUri(
        "http://127.0.0.1:8989/oauth/callback?next=https://evil.example",
      ),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:8989/oauth/callback#x"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("http://127.0.0.1:9/callback?x=1"),
      false,
    );
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

  it("requires the canonical ChatGPT callback origin and pathname", () => {
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com:444/connector/oauth/abc"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com//connector/oauth/abc"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector//oauth/abc"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/abc/"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/abc?next=x"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/abc#next"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/./oauth/x"),
      false,
    );
    assert.equal(
      isAllowedRedirectUri("https://chatgpt.com/connector/oauth/a/../x"),
      false,
    );
  });
});

describe("oauthClientLabel", () => {
  it("labels ChatGPT and Claude only from trusted hosted callbacks", () => {
    assert.equal(
      oauthClientLabel("opaque-dcr-client", CHATGPT_LEGACY_CALLBACK),
      "ChatGPT",
    );
    assert.equal(
      oauthClientLabel("cli", "https://chatgpt.com/connector/oauth/1"),
      "ChatGPT",
    );
    assert.equal(
      oauthClientLabel("opaque-dcr-client", CLAUDE_CALLBACK),
      "Claude",
    );
  });

  it("does not trust spoofed client IDs or loopback callbacks", () => {
    assert.equal(
      oauthClientLabel(
        "https://chatgpt.com/oauth/spoof/client.json",
        "http://127.0.0.1:62398/callback",
      ),
      "AI app",
    );
    assert.equal(
      oauthClientLabel(
        "https://claude.ai/api/mcp/auth_callback",
        "http://localhost:62398/callback",
      ),
      "AI app",
    );
    assert.equal(oauthClientLabel("opaque-dcr-client", ""), "AI app");
  });

  it("does not label noncanonical ChatGPT callbacks as ChatGPT", () => {
    for (const redirectUri of [
      "https://chatgpt.com:444/connector/oauth/abc",
      "https://chatgpt.com//connector/oauth/abc",
      "https://chatgpt.com/connector//oauth/abc",
      "https://chatgpt.com/connector/oauth/abc/",
      "https://chatgpt.com/connector/oauth/abc?next=x",
      "https://chatgpt.com/connector/oauth/abc#next",
      "https://chatgpt.com/connector/./oauth/x",
      "https://chatgpt.com/connector/oauth/a/../x",
    ]) {
      assert.equal(oauthClientLabel("opaque-dcr-client", redirectUri), "AI app");
    }
  });

  it("uses one safe display name for untrusted clients", () => {
    assert.equal(
      oauthClientDisplayName(
        "https://chatgpt.com/oauth/spoof/client.json",
        "http://127.0.0.1:62398/callback",
      ),
      "your AI app",
    );
    assert.equal(
      oauthClientDisplayName("opaque-dcr-client", CLAUDE_CALLBACK),
      "Claude",
    );
    assert.equal(
      oauthClientDisplayName(
        "https://claude.ai/api/mcp/auth_callback",
        OPENCLAW_REDIRECT,
      ),
      "your AI app",
    );
    assert.equal(
      oauthClientLabel(
        "https://claude.ai/api/mcp/auth_callback",
        OPENCLAW_REDIRECT,
      ),
      "AI app",
    );
  });
});

describe("computer-app sign-in copy", () => {
  it("tells an OpenClaw redirect that an app on this computer is connecting", () => {
    const email = authorizeEmailForm("p", "bad code", "cli", OPENCLAW_REDIRECT);
    const chooser = authorizeChooserForm(
      "p",
      "a@atoms.test",
      "bad code",
      "cli",
      OPENCLAW_REDIRECT,
    );
    const consent = consentForm("p", "a@atoms.test", "cli", OPENCLAW_REDIRECT);
    for (const html of [email, chooser]) {
      assert.match(html, /An app on this computer is connecting/);
      assert.match(html, /Settings → Atoms → Ask/);
      assert.doesNotMatch(html, /Connect Claude or ChatGPT/);
    }
    assert.match(consent, /Tool results go to the app on this computer/);
    assert.match(consent, /Host can decrypt the mirror/);
    assert.doesNotMatch(consent, /Anthropic or OpenAI/);
  });

  it("keeps Claude Code loopback and Claude hosted copy", () => {
    const code = authorizeEmailForm(
      "p",
      "",
      "cli",
      "http://127.0.0.1:9/callback",
    );
    const claude = authorizeEmailForm("p", "", "cli", CLAUDE_CALLBACK);
    const consent = consentForm("p", "a@atoms.test", "cli", CLAUDE_CALLBACK);
    assert.doesNotMatch(code, /An app on this computer is connecting/);
    assert.match(code, /Connect Atoms Plus to your AI app/);
    assert.match(claude, /Connect Atoms Plus to Claude/);
    assert.match(consent, /Anthropic or OpenAI/);
  });
});
