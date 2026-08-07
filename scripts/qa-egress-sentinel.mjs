#!/usr/bin/env node
/**
 * QA egress sentinel — a stand-in for `plus-service` that proves what the plugin *tried* to send.
 *
 * Point `plusBaseUrl` (Settings → Atoms → Advanced → "Plus service URL override") at this, and
 * every Plus request is recorded and refused. Two things fall out of that:
 *
 *   1. Nothing leaves the machine, so a consent/gating QA pass can run against a real vault
 *      without a real account and without any risk of live egress.
 *   2. An empty log becomes *evidence* rather than an assumption. "The gate held" is only a claim
 *      until you can show the attempt was never made — and show, with a positive control, that
 *      this sentinel does catch the traffic when the gate is open.
 *
 * Bodies are never logged, only method, path and byte count (CLAUDE.md § Log safety). A logged
 * `OPTIONS … bytes=0` is a refused preflight: the request body never went anywhere.
 *
 * Usage:
 *   node scripts/qa-egress-sentinel.mjs [logPath] [port]
 *   # then, in the vault under test:
 *   #   Settings → Atoms → Advanced → Plus service URL override = http://127.0.0.1:8787
 *
 * Worked example: docs/qa/2026-08-07-340-ask-expand-world-class-qa.md § Evidence.
 */
import http from "node:http";
import fs from "node:fs";

const LOG = process.argv[2] || "/tmp/atoms-egress.log";
const PORT = Number(process.argv[3] || 8787);

fs.writeFileSync(LOG, "");

http
  .createServer((req, res) => {
    let bytes = 0;
    req.on("data", (c) => (bytes += c.length));
    req.on("end", () => {
      fs.appendFileSync(
        LOG,
        `${new Date().toISOString()} ${req.method} ${req.url} bytes=${bytes}\n`,
      );
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "qa-sentinel: no backend" }));
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`egress sentinel on 127.0.0.1:${PORT} → ${LOG}`);
  });
