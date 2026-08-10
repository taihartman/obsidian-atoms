#!/usr/bin/env node
/**
 * QA permissive mirror stub — the counterpart to scripts/qa-egress-sentinel.mjs.
 *
 * The sentinel refuses everything, which proves *silence*. This one accepts everything with a
 * 200, which is what you need to prove *convergence*: the plugin only persists a fresh hash for
 * an atom whose upload succeeded, so a refusing stub can never show a second pass going quiet.
 *
 * Logs method, path, byte count, and — for /v1/ask/mirror/upsert — the atom paths in the chunk,
 * so an upload can be counted per atom across passes. Bodies are never logged (CLAUDE.md § Log
 * safety); atom paths come from the throwaway QA vault only.
 *
 * Usage: node qa-mirror-stub.mjs [logPath] [port]
 */
import http from "node:http";
import fs from "node:fs";

const LOG = process.argv[2] || "/tmp/atoms-mirror-stub.log";
const PORT = Number(process.argv[3] || 8799);

fs.writeFileSync(LOG, "");
const mirror = new Set();
let failUpserts = 0;

const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);

// The Plus client goes out through the renderer's `fetch`, so every request is preceded by a
// CORS preflight from `app://obsidian.md`. A stub that answers the POST but not the OPTIONS
// looks, from inside the plugin, exactly like a network outage.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-max-age": "600",
};

http
  .createServer((req, res) => {
    if (req.method === "OPTIONS") {
      log(`OPTIONS ${(req.url || "").split("?")[0]} preflight`);
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const chunks = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      chunks.push(c);
    });
    req.on("end", () => {
      const url = (req.url || "").split("?")[0];
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      let payload = { ok: true };

      // Fault injection for the adversarial pass: GET /qa-control/fail-upserts/<n> makes the
      // next n upsert chunks answer 503, so a mid-run upload failure can be driven on purpose.
      const failCtl = url.match(/^\/qa-control\/fail-upserts\/(\d+)$/);
      if (failCtl) {
        failUpserts = Number(failCtl[1]);
        log(`CONTROL fail-upserts=${failUpserts}`);
        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ ok: true, failUpserts }));
        return;
      }
      if (url === "/v1/ask/mirror/upsert" && failUpserts > 0) {
        failUpserts -= 1;
        const atoms = Array.isArray(body.atoms) ? body.atoms : [];
        log(`${req.method} ${url} bytes=${bytes} atoms=${atoms.length} INJECTED-503`);
        res.writeHead(503, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: "qa-injected failure" }));
        return;
      }

      if (url === "/v1/ask/mirror/upsert") {
        const atoms = Array.isArray(body.atoms) ? body.atoms : [];
        for (const a of atoms) if (a && typeof a.path === "string") mirror.add(a.path);
        log(`${req.method} ${url} bytes=${bytes} atoms=${atoms.length}`);
        for (const a of atoms) log(`  UPSERT kind=${a?.kind ?? "?"} path=${a?.path ?? "?"}`);
        payload = { ok: true, count: mirror.size, upserted: atoms.length };
      } else if (url === "/v1/ask/mirror/delete") {
        const paths = Array.isArray(body.paths) ? body.paths : [];
        for (const p of paths) mirror.delete(p);
        log(`${req.method} ${url} bytes=${bytes} paths=${paths.length}`);
        for (const p of paths) log(`  DELETE path=${p}`);
        payload = { ok: true, deleted: paths.length, missing: 0, count: mirror.size };
      } else if (url === "/v1/ask/mirror/status") {
        log(`${req.method} ${url} bytes=${bytes}`);
        payload = { ok: true, count: mirror.size, updatedAt: new Date().toISOString() };
      } else if (url === "/v1/ask/mirror/reconcile") {
        log(`${req.method} ${url} bytes=${bytes} keepPaths=${(body.keepPaths || []).length}`);
        payload = { ok: true, count: mirror.size, deleted: 0 };
      } else if (url === "/v1/me") {
        log(`${req.method} ${url} bytes=${bytes}`);
        payload = { ok: true, status: "active", remaining: 9999 };
      } else {
        log(`${req.method} ${url} bytes=${bytes}`);
      }

      res.writeHead(200, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify(payload));
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`permissive mirror stub on 127.0.0.1:${PORT} → ${LOG}`);
  });
