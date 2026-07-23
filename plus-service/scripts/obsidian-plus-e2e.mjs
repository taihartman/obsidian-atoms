#!/usr/bin/env node
/**
 * Obsidian + Plus Stripe dogfood:
 * 1) magic-link session on plus-service
 * 2) inject plusBaseUrl + session into test vault via Obsidian CLI
 * 3) createCheckout (same path as Settings)
 * 4) Playwright pays Checkout
 * 5) webhook grants → refresh session in Obsidian → resolveFilingAuth
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "/var/folders/wx/n39fzw_j7731wxflz0ptq44r0000gp/T/opencode/node_modules/playwright/index.mjs";

const BASE = process.env.PLUS_BASE || "http://127.0.0.1:8787";
const VAULT = process.env.OBSIDIAN_VAULT || "test vault";
const SHOT =
  process.env.SHOT_DIR ||
  "/var/folders/wx/n39fzw_j7731wxflz0ptq44r0000gp/T/opencode/stripe-browser";
mkdirSync(SHOT, { recursive: true });

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    ...opts,
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout || r.status}`,
    );
  }
  return (r.stdout || "") + (r.stderr || "");
}

function obsidianEval(js) {
  // Write code to temp file path embedded — CLI takes code=
  const out = sh("obsidian", [`vault=${VAULT}`, `eval`, `code=${js}`], {
    allowFail: true,
  });
  return out;
}

function extractJson(text) {
  // Prefer first top-level balanced object that includes our result markers
  const starts = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "{") starts.push(i);
  const candidates = [];
  for (const start of starts) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            candidates.push(JSON.parse(slice));
          } catch {
            /* skip */
          }
          break;
        }
      }
    }
  }
  // Prefer objects with ok/auth/session markers
  const scored = candidates.filter(
    (c) => c && typeof c === "object" && ("ok" in c || "auth" in c || "plusBaseUrl" in c),
  );
  return scored.at(-1) || candidates.at(-1) || null;
}

// --- health ---
const health = await (await fetch(`${BASE}/health`)).json();
if (!health.ok || !health.stripe) {
  console.error("plus-service not ready", health);
  process.exit(1);
}
console.log("plus health", health);

const email = `obsidian-${Date.now()}@atoms.test`;

// --- magic link ---
await fetch(`${BASE}/v1/auth/magic-link`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email }),
});
await sleep(400);
const slog = readFileSync(
  "/var/folders/wx/n39fzw_j7731wxflz0ptq44r0000gp/T/opencode/plus-server.log",
  "utf8",
);
const token = [...slog.matchAll(/token=(mt_[a-f0-9]+)/g)].map((m) => m[1]).at(-1);
if (!token) throw new Error("no magic token in server log");
const ex = await (
  await fetch(`${BASE}/v1/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  })
).json();
const sessionToken = ex.session;
if (!sessionToken) throw new Error("no session: " + JSON.stringify(ex));
console.log("session", sessionToken.slice(0, 16), "status", ex.status);

// --- inject into Obsidian ---
const injectCode = `(()=>{
  const p=app.plugins.plugins["atoms"];
  if(!p) return JSON.stringify({ok:false,err:"no atoms plugin"});
  const cfg=${JSON.stringify({ baseUrl: BASE, sessionToken, email })};
  p.settings.plusBaseUrl=cfg.baseUrl;
  return p.saveSettings().then(()=>{
    app.saveLocalStorage("atoms-plus-session", JSON.stringify({
      sessionToken: cfg.sessionToken,
      email: cfg.email,
      status: "inactive",
      remaining: 0,
      refreshedAt: Date.now()
    }));
    const auth = typeof p.resolveFilingAuth==="function" ? p.resolveFilingAuth() : null;
    return JSON.stringify({
      ok:true,
      version: p.manifest && p.manifest.version,
      plusBaseUrl: p.settings.plusBaseUrl,
      authMode: auth && auth.mode,
      authStatus: auth && auth.status
    });
  });
})()`;

const injOut = obsidianEval(injectCode);
const inj = extractJson(injOut);
console.log("obsidian inject", inj || injOut.slice(0, 400));
if (!inj?.ok) {
  console.error("inject failed — is Obsidian open on test vault?");
  process.exit(1);
}

// --- checkout via same HTTP as plugin (requestUrl path tested separately) ---
const ck = await (
  await fetch(`${BASE}/v1/billing/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ kind: "start_trial" }),
  })
).json();
if (!ck.url?.includes("checkout.stripe.com")) {
  console.error("checkout failed", ck);
  process.exit(1);
}
console.log("checkout", ck.id);

// Checkout URL from service (same payload Settings → Start Free Trial uses via createCheckout)
const payUrl = ck.url;
console.log("paying", payUrl.slice(0, 64));

// --- browser pay ---
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
page.setDefaultTimeout(60000);
await page.goto(payUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.locator("#payment-method-accordion-item-title-card").click({ force: true });
await page.locator("#cardNumber").waitFor({ state: "visible" });
async function fill(sel, v) {
  const loc = page.locator(sel);
  await loc.click();
  await loc.fill("");
  await loc.pressSequentially(v, { delay: 30 });
}
await fill("#cardNumber", "4242424242424242");
await fill("#cardExpiry", "1234");
await fill("#cardCvc", "123");
await fill("#billingName", "Obsidian Atoms");
await page.locator("#billingCountry").selectOption("US").catch(() => {});
if (await page.locator("#billingPostalCode").count()) {
  await fill("#billingPostalCode", "94107");
}
const link = page.locator("#enableStripePass");
if ((await link.count()) && (await link.isChecked())) {
  await link.uncheck().catch(() => {});
}
await page.screenshot({ path: `${SHOT}/obs-filled.png`, fullPage: true });
await page.getByRole("button", { name: /start trial/i }).click();
await page.waitForURL(/127\.0\.0\.1:8787\/v1\/billing\/return/, { timeout: 90000 });
await page.screenshot({ path: `${SHOT}/obs-return.png`, fullPage: true });
console.log("return", page.url());
const returnText = await page.locator("body").innerText();
console.log("return text", returnText.slice(0, 120));
await browser.close();

// --- wait entitlement ---
let me;
for (let i = 0; i < 30; i++) {
  me = await (
    await fetch(`${BASE}/v1/me`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    })
  ).json();
  if (me.status === "trialing" || me.status === "active") break;
  await sleep(500);
}
console.log("me", me);
if (!((me.status === "trialing" || me.status === "active") && me.remaining >= 150)) {
  console.error("entitlement not granted");
  process.exit(1);
}

// --- refresh session inside Obsidian ---
const refreshCode = `(()=>{
  const p=app.plugins.plugins["atoms"];
  const base=(p.settings.plusBaseUrl||"").replace(/\\/+$/,"");
  const raw=app.loadLocalStorage("atoms-plus-session");
  const s=typeof raw==="string"?JSON.parse(raw):raw;
  return fetch(base+"/v1/me",{
    headers:{authorization:"Bearer "+s.sessionToken}
  }).then(r=>r.json()).then(j=>{
    const session={
      sessionToken:s.sessionToken,
      email:j.email||s.email,
      status:j.status||"unknown",
      remaining: typeof j.remaining==="number"?j.remaining:undefined,
      periodEnd: typeof j.periodEnd==="string"?j.periodEnd:undefined,
      refreshedAt: Date.now()
    };
    app.saveLocalStorage("atoms-plus-session", JSON.stringify(session));
    const auth = typeof p.resolveFilingAuth==="function" ? p.resolveFilingAuth() : null;
    return JSON.stringify({
      ok:true,
      session,
      auth,
      canClassify: auth && (auth.status==="trialing"||auth.status==="active"||auth.status==="unknown")
    });
  });
})()`;

const refOut = obsidianEval(refreshCode);
const ref = extractJson(refOut);
console.log("obsidian after refresh", ref || refOut.slice(0, 500));

const auth = ref?.auth || (ref?.mode === "plus" ? ref : null);
const sess = ref?.session;
const pass =
  Boolean(ref?.ok !== false) &&
  auth?.mode === "plus" &&
  (auth?.status === "trialing" || auth?.status === "active") &&
  (sess?.remaining ?? auth?.remaining ?? 0) >= 150;

writeFileSync(
  `${SHOT}/obsidian-e2e.json`,
  JSON.stringify({ pass, email, me, inject: inj, refresh: ref, checkoutId: ck.id }, null, 2),
);

// optional: list unprocessed via CLI
const cmds = sh("obsidian", [`vault=${VAULT}`, "command", "id=atoms:list-unprocessed-captures"], {
  allowFail: true,
});
console.log("list-unprocessed exit notes:", cmds.slice(0, 200));

console.log(pass ? "\nOBSIDIAN E2E PASS" : "\nOBSIDIAN E2E FAIL");
process.exit(pass ? 0 : 1);
