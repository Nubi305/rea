// The page under test for the task: one process, no state kept between
// requests. PORT selects the port; GET /health answers 200 when it is up.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 5330);
const HOST = "127.0.0.1";

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Harbour Table</title>
  </head>
  <body>
    <h1>Harbour Table</h1>
    <form id="reserve">
      <label>Party size <input name="party" type="number" value="4" /></label>
      <label>Slot
        <select name="slot">
          <option value="18:30">18:30</option>
          <option value="20:15" selected>20:15</option>
        </select>
      </label>
      <button type="submit">Reserve table</button>
    </form>
    <p id="notice" role="status"></p>
    <script src="/app.js"></script>
  </body>
</html>
`;

// Kept dense on purpose: the question is about what the page does when it
// runs, not about reading this file.
const APP = `(()=>{const f=document.querySelector("#reserve"),n=document.querySelector("#notice"),k=s=>{let h=7;for(const c of s)h=(h*31+c.charCodeAt(0))%2147483647;return h.toString(36)};f.addEventListener("submit",async e=>{e.preventDefault();const d=new FormData(f),b={slot:d.get("slot"),party:Number(d.get("party")),channel:"web"};b.token=k(b.slot+"|"+b.party);const r=await fetch("/api/reservations",{method:"POST",headers:{"content-type":"application/json","x-table-client":"harbour-web/7"},body:JSON.stringify(b)});const j=await r.json();n.textContent=r.status===201?"Reserved "+j.reference:"Refused"})})();`;

const send = (response, status, type, body) => {
  response.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  response.end(body);
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && pathname === "/") return send(response, 200, "text/html; charset=utf-8", PAGE);
  if (request.method === "GET" && pathname === "/app.js") return send(response, 200, "text/javascript; charset=utf-8", APP);
  if (request.method === "GET" && pathname === "/health") return send(response, 200, "application/json", '{"ok":true}');
  if (request.method === "POST" && pathname === "/api/reservations") {
    const body = JSON.parse((await readBody(request)) || "{}");
    const reference = `HT-${String(body.party ?? 0).padStart(2, "0")}-${String(body.slot ?? "").replace(":", "")}`;
    return send(response, 201, "application/json", JSON.stringify({ reference, held_minutes: 15 }));
  }
  return send(response, 404, "application/json", '{"error":"not_found"}');
});

server.listen(PORT, HOST, () => {
  console.log(`harbour table listening on http://${HOST}:${PORT} pid ${process.pid}`);
});
