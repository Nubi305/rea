#!/usr/bin/env node
// Replays the request steps of a scenario against a running instance and prints each status and body.
// Usage: node replay.mjs http://127.0.0.1:5340 heldout-api.json   (start from a clean `ctl.sh reset`)
import { readFileSync } from "node:fs";
const [base, file] = process.argv.slice(2);
const sc = JSON.parse(readFileSync(file, "utf8"));
for (const a of sc.actions) {
  if (a.action !== "request") continue;
  const init = { method: a.method, headers: {} };
  if (a.json !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(a.json); }
  const res = await fetch(base + a.path, init);
  const text = await res.text();
  console.log(`${a.step_id}\t${a.method} ${a.path}${a.json !== undefined ? " " + JSON.stringify(a.json) : ""}\n  -> ${res.status} ${text}`);
}
