// Writes checkout.har: a browser recording of a checkout on a staging site.
// The same file on every run: no clock, no randomness.
import { writeFileSync } from "node:fs";

const ORIGIN = "https://staging.shop.example.test";
const START = Date.UTC(2026, 3, 14, 9, 30, 0);

const calls = [
  ["GET", "/checkout", 200, 84, "text/html"],
  ["GET", "/assets/app.4f2a.js", 200, 131, "application/javascript"],
  ["GET", "/assets/vendor.91c0.js", 200, 212, "application/javascript"],
  ["GET", "/assets/checkout.7be1.css", 200, 47, "text/css"],
  ["GET", "/assets/logo.svg", 200, 22, "image/svg+xml"],
  ["GET", "/assets/fonts/inter.woff2", 200, 95, "font/woff2"],
  ["GET", "/api/session", 200, 61, "application/json"],
  ["GET", "/api/profile", 401, 38, "application/json"],
  ["GET", "/api/cart", 200, 143, "application/json"],
  ["GET", "/assets/icons/cart.svg", 200, 18, "image/svg+xml"],
  ["GET", "/assets/icons/lock.svg", 200, 17, "image/svg+xml"],
  ["POST", "/api/cart/items", 201, 188, "application/json"],
  ["GET", "/api/cart", 200, 139, "application/json"],
  ["GET", "/api/shipping/quotes?postcode=1017AB", 200, 4812, "application/json"],
  ["GET", "/assets/icons/van.svg", 200, 19, "image/svg+xml"],
  ["POST", "/api/vouchers/redeem", 422, 77, "application/json"],
  ["GET", "/api/cart", 200, 151, "application/json"],
  ["POST", "/api/payments/intent", 402, 640, "application/json"],
  ["GET", "/assets/pay.2c11.js", 200, 173, "application/javascript"],
  ["POST", "/api/payments/intent", 201, 702, "application/json"],
  ["POST", "/api/orders", 502, 3004, "text/html"],
  ["GET", "/api/cart", 200, 137, "application/json"],
  ["POST", "/api/orders", 201, 911, "application/json"],
  ["GET", "/api/orders/88213", 200, 166, "application/json"],
  ["GET", "/assets/icons/check.svg", 200, 16, "image/svg+xml"],
  ["GET", "/api/orders/88213/receipt", 200, 254, "application/json"],
  ["POST", "/api/metrics", 204, 31, "text/plain"],
  ["GET", "/api/recommendations?after=88213", 200, 388, "application/json"],
  ["GET", "/assets/img/p-1001.webp", 200, 64, "image/webp"],
  ["GET", "/assets/img/p-1002.webp", 200, 71, "image/webp"],
  ["GET", "/assets/img/p-1003.webp", 200, 58, "image/webp"],
  ["POST", "/api/metrics", 204, 29, "text/plain"],
];

const bodyFor = (method, path, status) => {
  if (status === 204) return "";
  if (status === 502) return "<html><body><h1>502 Bad Gateway</h1></body></html>";
  if (status >= 400) return JSON.stringify({ error: `refused_${status}`, path });
  if (path.startsWith("/api/"))
    return JSON.stringify({ ok: true, method, path, items: [1, 2, 3] });
  return `/* ${path} */`;
};

let clock = START;
const entries = calls.map(([method, path, status, time, mimeType]) => {
  const text = bodyFor(method, path, status);
  const entry = {
    startedDateTime: new Date(clock).toISOString(),
    time,
    request: {
      method,
      url: ORIGIN + path,
      httpVersion: "HTTP/2",
      headers: [
        { name: "accept", value: mimeType },
        { name: "x-request-id", value: `req-${String(clock - START).padStart(6, "0")}` },
      ],
      queryString: [...new URL(ORIGIN + path).searchParams].map(([name, value]) => ({ name, value })),
      cookies: [],
      headersSize: -1,
      bodySize: method === "POST" ? 48 : 0,
      ...(method === "POST"
        ? { postData: { mimeType: "application/json", text: JSON.stringify({ step: path.split("/").at(-1), qty: 1 }) } }
        : {}),
    },
    response: {
      status,
      statusText: "",
      httpVersion: "HTTP/2",
      headers: [{ name: "content-type", value: mimeType }],
      cookies: [],
      content: { size: text.length, mimeType, text },
      redirectURL: "",
      headersSize: -1,
      bodySize: text.length,
    },
    cache: {},
    timings: { send: 1, wait: time - 2, receive: 1 },
  };
  clock += time + 40;
  return entry;
});

const har = { log: { version: "1.2", creator: { name: "recorder", version: "1" }, pages: [], entries } };
writeFileSync(process.argv[2], JSON.stringify(har, null, 1) + "\n");
