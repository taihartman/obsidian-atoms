import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HTML_SECURITY_HEADERS,
  OAUTH_HTML_SECURITY_HEADERS,
  escHtml,
  renderPage,
} from "../src/html/shell.mjs";

describe("html/shell renderPage", () => {
  it("includes viewport width=device-width", () => {
    const html = renderPage({ title: "T", bodyHtml: "<h1>Hi</h1>" });
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
  });

  it("defines product tint and .btn min-height >= 44", () => {
    const html = renderPage({ title: "T", bodyHtml: "<p>x</p>" });
    assert.match(html, /--tint:#0a84ff/);
    const m = /\.btn\{[^}]*min-height:(\d+)px/.exec(html);
    assert.ok(m, "`.btn` declares min-height");
    assert.ok(Number(m[1]) >= 44, `min-height ${m[1]}`);
  });

  it("ships light prefers-color-scheme overrides", () => {
    const html = renderPage({ title: "T", bodyHtml: "<p>x</p>" });
    assert.match(html, /prefers-color-scheme:\s*light/);
  });

  it("never uses purple primary fills", () => {
    const html = renderPage({ title: "T", bodyHtml: "<p>x</p>" });
    assert.equal(html.includes("7c3aed"), false);
  });

  it("ships no script and no external stylesheet", () => {
    const html = renderPage({ title: "T", bodyHtml: "<p>x</p>" });
    assert.equal(/<script/i.test(html), false);
    assert.equal(/rel=["']stylesheet["']/i.test(html), false);
    assert.equal(/https?:\/\/[^"']+\.css/i.test(html), false);
  });

  it("escHtml escapes markup", () => {
    assert.equal(escHtml(`<a b="c">&`), "&lt;a b=&quot;c&quot;&gt;&amp;");
  });

  it("renders eyebrow before body when provided", () => {
    const html = renderPage({
      title: "T",
      eyebrow: "Atoms Plus",
      bodyHtml: "<h1>Body</h1>",
    });
    const eye = html.indexOf("Atoms Plus");
    const body = html.indexOf("<h1>Body</h1>");
    assert.ok(eye > 0 && body > eye);
  });

  it("locks landing CSP string on HTML_SECURITY_HEADERS", () => {
    assert.equal(
      HTML_SECURITY_HEADERS["content-security-policy"],
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    );
    assert.equal(HTML_SECURITY_HEADERS["cache-control"], "no-store");
  });

  it("OAuth CSP form-action allows Claude and ChatGPT redirects after Allow", () => {
    const csp = OAUTH_HTML_SECURITY_HEADERS["content-security-policy"];
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /https:\/\/claude\.ai/);
    assert.match(csp, /https:\/\/chatgpt\.com/);
    assert.match(csp, /https:\/\/grok\.com/);
    assert.match(csp, /127\.0\.0\.1/);
  });
});
