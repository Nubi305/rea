// replay.mjs <scenario.json> <origin>: replays the request steps with one cookie jar, prints status and body.
import fs from "node:fs";
const [file, origin] = process.argv.slice(2);
const sc = JSON.parse(fs.readFileSync(file, "utf8"));
let cookie = "";
for (const a of sc.actions) {
  if (a.action !== "request") continue;
  const headers = {};
  if (cookie) headers.cookie = cookie;
  for (const h of a.headers || []) headers[h.name] = h.value.value;
  if (a.json !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(origin + a.path, { method: a.method, headers, body: a.json !== undefined ? JSON.stringify(a.json) : undefined, redirect: "manual" });
  const sc2 = r.headers.get("set-cookie");
  if (sc2) cookie = sc2.split(";")[0];
  const text = await r.text();
  console.log(`${a.step_id}\t${a.method} ${a.path}${a.json !== undefined ? " " + JSON.stringify(a.json) : ""}${a.headers ? " If-None-Match: " + a.headers[0].value.value : ""}`);
  console.log(`  -> ${r.status} ${text}`);
}
