// Seedlark: a seed-packet catalogue with a per-browser basket and an order book.
// Node standard library only. All data lives in memory and is rebuilt from the seed on every start.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

const PORT = Number(process.env.PORT || 5360);
const HOST = "127.0.0.1";
const PAGE_SIZE = 4;
const KINDS = ["vegetable", "herb", "flower"];
const VARIETY_STATUSES = ["active", "retired"];
const ORDER_STATUSES = ["placed", "packed", "shipped", "cancelled"];
const TRANSITIONS = { placed: ["packed", "cancelled"], packed: ["shipped", "cancelled"], shipped: [], cancelled: [] };
const MAX_LINE_QTY = 12;
const MAX_LINES = 5;
const BULK_QTY = 6;
const SHIPPING_CENTS = 350;
const FREE_SHIPPING_FROM = 2500;
const PROMOS = { SPRING5: { minimumCents: 1500 }, HERBS20: {} };
const COOKIE = "seedlark_basket";

// ---------- seed ----------
const varieties = new Map();
const orders = new Map();
const baskets = new Map();
let nextVarietyId = 1;
let nextOrderId = 1;

function seedVariety(sku, name, kind, priceCents, stock, status, uid, createdAt) {
  const id = nextVarietyId++;
  varieties.set(id, { id, uid, sku, name, kind, priceCents, stock, status, rev: 1, createdAt });
}
seedVariety("TOM-0101", "Brandywine Tomato", "vegetable", 345, 38, "active", "var_3fa1c207", "2026-02-02T09:00:00.000Z");
seedVariety("BAS-0204", "Genovese Basil", "herb", 245, 22, "active", "var_81d0b4e5", "2026-02-02T09:05:00.000Z");
seedVariety("CAL-0310", "calendula Pacific", "flower", 210, 12, "active", "var_0c7e9a13", "2026-02-02T09:10:00.000Z");
seedVariety("CAR-0402", "Chantenay Carrot", "vegetable", 210, 54, "active", "var_e2b54f88", "2026-02-03T10:00:00.000Z");
seedVariety("DIL-0505", "Bouquet Dill", "herb", 195, 0, "active", "var_7a19c6d0", "2026-02-03T10:20:00.000Z");
seedVariety("SWP-0611", "Sweet Pea Cupani", "flower", 395, 8, "active", "var_55e03b9c", "2026-02-04T08:45:00.000Z");
seedVariety("KAL-0720", "Cavolo Nero Kale", "vegetable", 285, 30, "active", "var_c94d2e61", "2026-02-04T11:15:00.000Z");
seedVariety("CHV-0815", "Chives", "herb", 195, 17, "active", "var_2b6f8d34", "2026-02-05T07:30:00.000Z");
seedVariety("ZIN-0909", "Zinnia Envy", "flower", 320, 5, "retired", "var_f1083a7b", "2026-02-05T12:00:00.000Z");
seedVariety("PEA-1002", "Alderman Pea", "vegetable", 345, 22, "active", "var_6de4b210", "2026-02-06T09:40:00.000Z");
seedVariety("COR-1110", "Coriander Calypso", "herb", 230, 14, "active", "var_a03c7f59", "2026-02-06T13:25:00.000Z");
seedVariety("NAS-1212", "Nasturtium Empress", "flower", 250, 9, "active", "var_48b1e6c2", "2026-02-07T10:10:00.000Z");

function seedOrder(status, lines, uid, createdAt) {
  const id = nextOrderId++;
  const priced = priceBasket(new Map(lines), null);
  orders.set(id, {
    id,
    uid,
    number: "SL-" + (1000 + id),
    status,
    lines: priced.lines.map((l) => ({ ...l })),
    itemCount: priced.itemCount,
    subtotalCents: priced.subtotalCents,
    promo: null,
    shippingCents: priced.shippingCents,
    totalCents: priced.totalCents,
    createdAt,
  });
}

// ---------- pricing ----------
function priceBasket(lineMap, promoCode) {
  const lines = [];
  for (const [varietyId, qty] of lineMap) {
    const v = varieties.get(varietyId);
    const gross = qty * v.priceCents;
    const discountCents = qty >= BULK_QTY ? Math.floor(gross / 10) : 0;
    lines.push({
      varietyId,
      sku: v.sku,
      name: v.name,
      kind: v.kind,
      qty,
      unitCents: v.priceCents,
      discountCents,
      lineCents: gross - discountCents,
    });
  }
  lines.sort((a, b) => b.lineCents - a.lineCents || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  const subtotalCents = lines.reduce((s, l) => s + l.lineCents, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  let promo = null;
  let promoDiscount = 0;
  if (promoCode) {
    if (promoCode === "SPRING5") {
      promoDiscount = subtotalCents >= PROMOS.SPRING5.minimumCents ? 500 : 0;
    } else if (promoCode === "HERBS20") {
      const herbs = lines.filter((l) => l.kind === "herb").reduce((s, l) => s + l.lineCents, 0);
      promoDiscount = Math.floor((herbs * 20 + 50) / 100);
    }
    promo = { code: promoCode, discountCents: promoDiscount, applied: promoDiscount > 0 };
  }
  const goods = subtotalCents - promoDiscount;
  const shippingCents = lines.length === 0 ? 0 : goods >= FREE_SHIPPING_FROM ? 0 : SHIPPING_CENTS;
  return { lines, itemCount, subtotalCents, promo, shippingCents, totalCents: goods + shippingCents };
}

seedOrder("shipped", [[1, 2]], "ord_9e2c41d7", "2026-02-10T15:02:00.000Z");
seedOrder("packed", [[2, 3], [8, 1]], "ord_15ab70f3", "2026-02-11T09:48:00.000Z");
seedOrder("placed", [[4, 6]], "ord_c6083e5a", "2026-02-12T17:21:00.000Z");

// ---------- helpers ----------
const hex = (n) => crypto.randomBytes(n).toString("hex");
const collapse = (s) => s.trim().replace(/\s+/g, " ");
const cmpText = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
const money = (c) => (c < 0 ? "-" : "") + "€" + (Math.abs(c) / 100).toFixed(2);
const priceText = (c) => (c / 100).toFixed(2);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function varietyJson(v) {
  return {
    id: v.id,
    uid: v.uid,
    sku: v.sku,
    name: v.name,
    kind: v.kind,
    priceCents: v.priceCents,
    price: priceText(v.priceCents),
    stock: v.stock,
    status: v.status,
    rev: v.rev,
    createdAt: v.createdAt,
  };
}
const etagOf = (v) => `"v${v.id}.${v.rev}"`;

class Fail {
  constructor(status, error, message, extra = {}) {
    this.status = status;
    this.body = { error, message, ...extra };
    this.field = extra.field;
  }
}

// ---------- variety validation ----------
// Returns { values, errors }: values hold normalised fields present in input; errors in field order.
function checkVarietyFields(input, creating) {
  const values = {};
  const errors = [];
  const present = (k) => input[k] !== undefined && input[k] !== null && !(typeof input[k] === "string" && input[k].trim() === "");
  const err = (field, code, message, extra = {}) => errors.push(new Fail(422, code, message, { field, ...extra }));

  if (present("sku")) {
    const sku = String(input.sku).trim().toUpperCase();
    if (!/^[A-Z]{3}-\d{4}$/.test(sku)) err("sku", "sku_format", "A SKU is three letters, a dash and four digits.", { pattern: "AAA-0000" });
    else values.sku = sku;
  } else if (creating || input.sku !== undefined) err("sku", "sku_required", "Enter a SKU.");

  if (present("name")) {
    const name = collapse(String(input.name));
    if (name.length < 3 || name.length > 32) err("name", "name_length", "A name has 3 to 32 characters.", { min: 3, max: 32 });
    else values.name = name;
  } else if (creating || input.name !== undefined) err("name", "name_required", "Enter a name.");

  if (present("kind")) {
    const kind = String(input.kind).trim().toLowerCase();
    if (!KINDS.includes(kind)) err("kind", "kind_invalid", "Choose a kind.", { allowed: KINDS });
    else values.kind = kind;
  } else if (creating || input.kind !== undefined) err("kind", "kind_required", "Choose a kind.");

  if (present("price")) {
    const raw = typeof input.price === "number" ? String(input.price) : typeof input.price === "string" ? input.price.trim() : "";
    const m = /^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(raw);
    if (!m) err("price", "price_format", "A price is a number of euros with at most three decimals.");
    else {
      const mills = Number(m[1]) * 1000 + Number((m[2] || "").padEnd(3, "0"));
      const cents = Math.floor((mills + 25) / 50) * 5;
      if (cents < 50 || cents > 5000) err("price", "price_range", "A price is from 0.50 to 50.00 euros.", { min: "0.50", max: "50.00" });
      else values.priceCents = cents;
    }
  } else if (creating || input.price !== undefined) err("price", "price_required", "Enter a price.");

  if (present("stock")) {
    const raw = input.stock;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 999) err("stock", "stock_invalid", "Stock is a whole number from 0 to 999.", { min: 0, max: 999 });
    else values.stock = n;
  } else if (creating) values.stock = 0;
  else if (input.stock !== undefined) err("stock", "stock_invalid", "Stock is a whole number from 0 to 999.", { min: 0, max: 999 });

  if (present("status")) {
    const status = String(input.status).trim().toLowerCase();
    if (!VARIETY_STATUSES.includes(status)) err("status", "status_invalid", "Unknown status.", { allowed: VARIETY_STATUSES });
    else values.status = status;
  } else if (creating) values.status = "active";
  else if (input.status !== undefined) err("status", "status_invalid", "Unknown status.", { allowed: VARIETY_STATUSES });

  if (!errors.length && values.sku) {
    for (const other of varieties.values()) {
      if (other.sku === values.sku && other.id !== input.__selfId) {
        errors.push(new Fail(409, "sku_taken", "Another variety uses that SKU.", { field: "sku", existingId: other.id }));
        break;
      }
    }
  }
  return { values, errors };
}

function createVariety(input) {
  const { values, errors } = checkVarietyFields(input, true);
  if (errors.length) return { errors };
  const id = nextVarietyId++;
  const v = { id, uid: "var_" + hex(4), rev: 1, createdAt: new Date().toISOString(), ...values };
  v.sku = values.sku;
  varieties.set(id, {
    id,
    uid: v.uid,
    sku: values.sku,
    name: values.name,
    kind: values.kind,
    priceCents: values.priceCents,
    stock: values.stock,
    status: values.status,
    rev: 1,
    createdAt: v.createdAt,
  });
  return { variety: varieties.get(id) };
}

function updateVariety(v, input) {
  const { values, errors } = checkVarietyFields({ ...input, __selfId: v.id }, false);
  if (errors.length) return { errors };
  let changed = false;
  for (const k of ["sku", "name", "kind", "priceCents", "stock", "status"]) {
    if (values[k] !== undefined && values[k] !== v[k]) {
      v[k] = values[k];
      changed = true;
    }
  }
  if (changed) v.rev++;
  return { variety: v };
}

function setStock(v, stock) {
  if (v.stock !== stock) {
    v.stock = stock;
    v.rev++;
  }
}

function deleteVariety(v) {
  let used = 0;
  for (const o of orders.values()) if (o.lines.some((l) => l.varietyId === v.id)) used++;
  if (used) return new Fail(409, "variety_in_use", "A variety on an order cannot be deleted.", { orders: used });
  let removed = 0;
  for (const b of baskets.values()) if (b.lines.delete(v.id)) removed++;
  varieties.delete(v.id);
  return { deleted: true, id: v.id, basketLinesRemoved: removed };
}

// ---------- listing ----------
const SORTS = {
  name: (a, b) => 0,
  price: (a, b) => a.priceCents - b.priceCents,
  stock: (a, b) => a.stock - b.stock,
  sku: (a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0),
};
function listVarieties(params) {
  const q = collapse(params.get("q") || "").toLowerCase();
  const kindRaw = (params.get("kind") || "").trim().toLowerCase();
  const statusRaw = (params.get("status") || "").trim().toLowerCase() || "active";
  if (kindRaw && !KINDS.includes(kindRaw)) throw new Fail(422, "kind_invalid", "Unknown kind.", { allowed: KINDS });
  if (!["active", "retired", "all"].includes(statusRaw))
    throw new Fail(422, "status_invalid", "Unknown status.", { allowed: ["active", "retired", "all"] });
  let sort = (params.get("sort") || "").trim().toLowerCase();
  if (!SORTS[sort]) sort = "name";
  const dir = (params.get("dir") || "").trim().toLowerCase() === "desc" ? "desc" : "asc";
  const sign = dir === "desc" ? -1 : 1;
  let items = [...varieties.values()].filter(
    (v) =>
      (statusRaw === "all" || v.status === statusRaw) &&
      (!kindRaw || v.kind === kindRaw) &&
      (!q || v.name.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q)),
  );
  items.sort((a, b) => {
    const primary = sort === "name" ? cmpText(a.name, b.name) : SORTS[sort](a, b);
    if (primary) return sign * primary;
    return cmpText(a.name, b.name) || a.id - b.id;
  });
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRaw = (params.get("page") || "").trim();
  let page = /^\d+$/.test(pageRaw) ? Number(pageRaw) : 1;
  if (page < 1) page = 1;
  if (page > pages) page = pages;
  items = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { items, total, page, pages, pageSize: PAGE_SIZE, sort, dir, q, kind: kindRaw, status: statusRaw };
}

// ---------- basket ----------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function basketFor(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token && baskets.has(token)) return baskets.get(token);
  const fresh = hex(12);
  const b = { token: fresh, lines: new Map(), promo: null };
  baskets.set(fresh, b);
  res.setHeader("Set-Cookie", `${COOKIE}=${fresh}; Path=/; HttpOnly; SameSite=Lax`);
  return b;
}
const basketView = (b) => priceBasket(b.lines, b.promo);

function intField(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw)) return Number(raw.trim());
  return NaN;
}

function addLine(b, input) {
  const vid = intField(input.varietyId);
  if (!Number.isInteger(vid)) return new Fail(422, "variety_required", "Name a variety.");
  const v = varieties.get(vid);
  if (!v) return new Fail(404, "variety_not_found", "No such variety.", { id: vid });
  const qty = intField(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY)
    return new Fail(422, "qty_invalid", "A quantity is a whole number from 1 to 12.", { min: 1, max: MAX_LINE_QTY });
  if (v.status === "retired") return new Fail(409, "variety_retired", "This variety is no longer sold.", { varietyId: v.id });
  const had = b.lines.get(vid) || 0;
  const merged = had + qty;
  if (merged > MAX_LINE_QTY)
    return new Fail(409, "line_limit", "At most 12 packets of one variety.", { max: MAX_LINE_QTY, inBasket: had });
  if (!had && b.lines.size >= MAX_LINES)
    return new Fail(409, "basket_full", "A basket holds at most 5 varieties.", { maxLines: MAX_LINES });
  if (merged > v.stock)
    return new Fail(409, "out_of_stock", "Not enough packets in stock.", { varietyId: v.id, available: v.stock, requested: merged });
  b.lines.set(vid, merged);
  return null;
}

function setLine(b, vid, input) {
  if (!b.lines.has(vid)) return new Fail(404, "line_not_found", "That variety is not in the basket.", { varietyId: vid });
  const qty = intField(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY)
    return new Fail(422, "qty_invalid", "A quantity is a whole number from 1 to 12.", { min: 1, max: MAX_LINE_QTY });
  const v = varieties.get(vid);
  if (qty > v.stock)
    return new Fail(409, "out_of_stock", "Not enough packets in stock.", { varietyId: v.id, available: v.stock, requested: qty });
  b.lines.set(vid, qty);
  return null;
}

function applyPromo(b, input) {
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  if (!code) return new Fail(422, "promo_required", "Enter a code.");
  if (!PROMOS[code]) return new Fail(422, "promo_unknown", "That code is not known.");
  const view = basketView(b);
  if (code === "SPRING5" && view.subtotalCents < PROMOS.SPRING5.minimumCents)
    return new Fail(409, "promo_minimum", "This code needs goods worth 15.00 euros.", {
      minimumCents: PROMOS.SPRING5.minimumCents,
      subtotalCents: view.subtotalCents,
    });
  b.promo = code;
  return null;
}

function checkout(b) {
  const view = basketView(b);
  if (!view.lines.length) return new Fail(409, "basket_empty", "The basket is empty.");
  for (const l of view.lines) {
    const v = varieties.get(l.varietyId);
    if (v.status === "retired") return new Fail(409, "variety_retired", "This variety is no longer sold.", { varietyId: v.id });
    if (l.qty > v.stock)
      return new Fail(409, "out_of_stock", "Not enough packets in stock.", { varietyId: v.id, available: v.stock, requested: l.qty });
  }
  for (const l of view.lines) {
    const v = varieties.get(l.varietyId);
    setStock(v, v.stock - l.qty);
  }
  const id = nextOrderId++;
  const order = {
    id,
    uid: "ord_" + hex(4),
    number: "SL-" + (1000 + id),
    status: "placed",
    lines: view.lines.map((l) => ({ ...l })),
    itemCount: view.itemCount,
    subtotalCents: view.subtotalCents,
    promo: view.promo,
    shippingCents: view.shippingCents,
    totalCents: view.totalCents,
    createdAt: new Date().toISOString(),
  };
  orders.set(id, order);
  b.lines.clear();
  b.promo = null;
  return order;
}

function changeOrderStatus(o, input) {
  const to = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
  if (!ORDER_STATUSES.includes(to)) return new Fail(422, "status_invalid", "Unknown status.", { allowed: ORDER_STATUSES });
  const allowed = TRANSITIONS[o.status];
  if (!allowed.includes(to))
    return new Fail(409, "invalid_transition", `An order cannot go from ${o.status} to ${to}.`, { from: o.status, to, allowed });
  if (to === "cancelled") for (const l of o.lines) {
    const v = varieties.get(l.varietyId);
    setStock(v, v.stock + l.qty);
  }
  o.status = to;
  return null;
}

function listOrders(params) {
  const status = (params.get("status") || "").trim().toLowerCase();
  if (status && !ORDER_STATUSES.includes(status)) throw new Fail(422, "status_invalid", "Unknown status.", { allowed: ORDER_STATUSES });
  const items = [...orders.values()].filter((o) => !status || o.status === status).sort((a, b) => b.id - a.id);
  return { items, total: items.length };
}

// ---------- HTTP plumbing ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 65536) {
        reject(new Fail(413, "too_large", "Body too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function jsonBody(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch {
    throw new Fail(400, "invalid_json", "The body is not a JSON object.");
  }
}
async function formBody(req) {
  const text = await readBody(req);
  return Object.fromEntries(new URLSearchParams(text));
}
function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(res.req.method === "HEAD" ? undefined : text);
}
function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(res.req.method === "HEAD" ? undefined : html);
}
function redirect(res, location) {
  res.writeHead(303, { Location: location, "Content-Length": "0" });
  res.end();
}

// ---------- pages ----------
const CSS = fs.readFileSync(new URL("./public/seedlark.css", import.meta.url), "utf8");

function layout(title, body, b) {
  const count = b ? [...b.lines.values()].reduce((s, q) => s + q, 0) : null;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Seedlark</title>
<link rel="stylesheet" href="/static/seedlark.css"></head>
<body><header class="top"><a class="brand" href="/">Seedlark</a>
<nav aria-label="Main"><a href="/varieties">Catalogue</a> <a href="/varieties/new">New variety</a> <a href="/basket">Basket${count === null ? "" : ` (${count})`}</a> <a href="/orders">Orders</a></nav></header>
<main>${body}</main>
<footer>Seedlark seed packets, sown in small batches.</footer></body></html>`;
}

function notFoundPage(res, b) {
  sendHtml(res, 404, layout("Not found", `<h1>Page not found</h1><p>Seedlark has no page at this address.</p><p><a href="/varieties">Back to the catalogue</a></p>`, b));
}

function homePage(res, b) {
  const active = [...varieties.values()].filter((v) => v.status === "active");
  const inStock = active.filter((v) => v.stock > 0).length;
  const open = [...orders.values()].filter((o) => o.status === "placed" || o.status === "packed").length;
  sendHtml(
    res,
    200,
    layout(
      "Home",
      `<h1>Seedlark</h1><p>Seed packets for small gardens.</p>
<ul class="facts"><li>${active.length} varieties in the catalogue, ${inStock} in stock</li><li>${open} orders waiting to ship</li></ul>
<p><a href="/varieties">Browse the catalogue</a></p>`,
      b,
    ),
  );
}

function listQuery(list, over) {
  const p = new URLSearchParams();
  const vals = { q: list.q, kind: list.kind, status: list.status === "active" ? "" : list.status, sort: list.sort === "name" ? "" : list.sort, dir: list.dir === "asc" ? "" : list.dir, page: "", ...over };
  for (const [k, v] of Object.entries(vals)) if (v !== "" && v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return "/varieties" + (s ? "?" + s : "");
}

function varietiesPage(res, b, params) {
  let list;
  try {
    list = listVarieties(params);
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return sendHtml(res, 422, layout("Catalogue", `<h1>Catalogue</h1><p role="alert">${esc(e.body.message)}</p><p><a href="/varieties">Show the whole catalogue</a></p>`, b));
  }
  const head = (key, label) => {
    const nextDir = list.sort === key && list.dir === "asc" ? "desc" : "asc";
    const mark = list.sort === key ? (list.dir === "asc" ? " (ascending)" : " (descending)") : "";
    return `<th scope="col"><a href="${esc(listQuery(list, { sort: key === "name" && nextDir === "asc" ? "" : key, dir: nextDir === "asc" ? "" : "desc" }))}">${label}</a>${mark}</th>`;
  };
  const rows = list.items
    .map(
      (v) =>
        `<tr><td><a href="/varieties/${v.id}">${esc(v.name)}</a></td><td>${esc(v.sku)}</td><td>${v.kind}</td><td>${money(v.priceCents)}</td><td>${v.stock === 0 ? "Sold out" : v.stock}</td></tr>`,
    )
    .join("");
  const nav = [];
  if (list.page > 1) nav.push(`<a rel="prev" href="${esc(listQuery(list, { page: list.page - 1 }))}">Previous page</a>`);
  nav.push(`<span>Page ${list.page} of ${list.pages}</span>`);
  if (list.page < list.pages) nav.push(`<a rel="next" href="${esc(listQuery(list, { page: list.page + 1 }))}">Next page</a>`);
  sendHtml(
    res,
    200,
    layout(
      "Catalogue",
      `<h1>Catalogue</h1>
<form method="get" action="/varieties" role="search"><label for="q">Search</label> <input id="q" name="q" value="${esc(list.q)}">
<label for="kind">Kind</label> <select id="kind" name="kind"><option value="">Any kind</option>${KINDS.map((k) => `<option value="${k}"${list.kind === k ? " selected" : ""}>${k}</option>`).join("")}</select>
<button type="submit">Search</button></form>
<p>${list.total} ${list.total === 1 ? "variety" : "varieties"} found.</p>
<table><thead><tr>${head("name", "Name")}${head("sku", "SKU")}<th scope="col">Kind</th>${head("price", "Price")}${head("stock", "Stock")}</tr></thead><tbody>${rows || `<tr><td colspan="5">No varieties match.</td></tr>`}</tbody></table>
<nav aria-label="Pages" class="pager">${nav.join(" ")}</nav>`,
      b,
    ),
  );
}

function varietyForm(action, button, values, errors) {
  const errFor = (f) => errors.find((e) => e.field === f);
  const field = (name, label, inner) => {
    const e = errFor(name);
    return `<p class="field${e ? " bad" : ""}"><label for="${name}">${label}</label> ${inner}${e ? ` <span class="error" id="${name}-error">${esc(e.body.message)}</span>` : ""}</p>`;
  };
  const input = (name, extra = "") => `<input id="${name}" name="${name}" value="${esc(values[name] ?? "")}"${errFor(name) ? ` aria-invalid="true" aria-describedby="${name}-error"` : ""}${extra}>`;
  const summary = errors.length
    ? `<div role="alert" class="errors" data-alert="form"><p>${errors.length === 1 ? "1 problem" : errors.length + " problems"} to fix:</p><ul>${errors.map((e) => `<li>${esc(e.body.message)}</li>`).join("")}</ul></div>`
    : "";
  return `${summary}<form method="post" action="${action}">
${field("sku", "SKU", input("sku"))}
${field("name", "Name", input("name"))}
${field("kind", "Kind", `<select id="kind" name="kind"><option value="">Choose…</option>${KINDS.map((k) => `<option value="${k}"${String(values.kind ?? "").trim().toLowerCase() === k ? " selected" : ""}>${k}</option>`).join("")}</select>`)}
${field("price", "Price in euros", input("price"))}
${field("stock", "Stock", input("stock"))}
${field("status", "Status", `<select id="status" name="status">${VARIETY_STATUSES.map((s) => `<option value="${s}"${String(values.status ?? "active") === s ? " selected" : ""}>${s}</option>`).join("")}</select>`)}
<p><button type="submit">${button}</button></p></form>`;
}

function varietyPage(res, b, v, notice, addError, qtyValue) {
  const inBasket = b.lines.get(v.id) || 0;
  const status = notice ? `<p role="status" class="notice" data-notice="${notice.key}">${esc(notice.text)}</p>` : "";
  const alert = addError ? `<p role="alert" class="errors" data-alert="add">${esc(addError)}</p>` : "";
  const buy =
    v.status === "retired"
      ? `<p>This variety is no longer sold.</p>`
      : `<form method="post" action="/basket/lines"><input type="hidden" name="varietyId" value="${v.id}">
<label for="qty">Quantity</label> <input id="qty" name="qty" value="${esc(qtyValue ?? "1")}"> <button type="submit">Add to basket</button></form>
<p>${inBasket ? `${inBasket} in your basket.` : "Not in your basket."}</p>`;
  sendHtml(
    res,
    addError ? addError.status || 409 : 200,
    layout(
      v.name,
      `${status}<h1>${esc(v.name)}</h1>
<dl><dt>SKU</dt><dd>${esc(v.sku)}</dd><dt>Kind</dt><dd>${v.kind}</dd><dt>Price</dt><dd>${money(v.priceCents)} a packet</dd>
<dt>Stock</dt><dd>${v.stock === 0 ? "Sold out" : v.stock + " packets"}</dd><dt>Status</dt><dd>${v.status}</dd></dl>
${alert}${buy}
<p><a href="/varieties/${v.id}/edit">Edit this variety</a></p>
<form method="post" action="/varieties/${v.id}/delete"><input type="hidden" name="confirm" value="yes"><button type="submit">Delete variety</button></form>`,
      b,
    ),
  );
}

function basketPage(res, b, status = 200, error = null, codeValue = "", notice = null) {
  const view = basketView(b);
  const rows = view.lines
    .map(
      (l) =>
        `<tr><td><a href="/varieties/${l.varietyId}">${esc(l.name)}</a></td><td>${l.qty}</td><td>${money(l.unitCents)}</td><td>${l.discountCents ? money(-l.discountCents) : ""}</td><td>${money(l.lineCents)}</td></tr>`,
    )
    .join("");
  const promoLine = view.promo
    ? `<tr><th scope="row">Code ${esc(view.promo.code)}</th><td>${view.promo.applied ? money(-view.promo.discountCents) : "not applied"}</td></tr>`
    : "";
  sendHtml(
    res,
    status,
    layout(
      "Basket",
      `${notice ? `<p role="status" class="notice" data-notice="${notice.key}">${esc(notice.text)}</p>` : ""}<h1>Your basket</h1>${error ? `<p role="alert" class="errors" data-alert="basket">${esc(error)}</p>` : ""}
${view.lines.length ? `<table><thead><tr><th scope="col">Variety</th><th scope="col">Packets</th><th scope="col">Each</th><th scope="col">Discount</th><th scope="col">Line</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>Your basket is empty.</p>"}
<table class="totals"><tbody><tr><th scope="row">Packets</th><td>${view.itemCount}</td></tr><tr><th scope="row">Subtotal</th><td>${money(view.subtotalCents)}</td></tr>${promoLine}<tr><th scope="row">Shipping</th><td>${view.shippingCents ? money(view.shippingCents) : "free"}</td></tr><tr><th scope="row">Total</th><td>${money(view.totalCents)}</td></tr></tbody></table>
<form method="post" action="/basket/promo"><label for="code">Promotion code</label> <input id="code" name="code" value="${esc(codeValue)}"> <button type="submit">Apply code</button></form>
<form method="post" action="/basket/checkout"><input type="hidden" name="confirm" value="yes"><button type="submit">Place order</button></form>`,
      b,
    ),
  );
}

function ordersPage(res, b) {
  const { items } = listOrders(new URLSearchParams());
  const rows = items
    .map((o) => `<tr><td><a href="/orders/${o.id}">${o.number}</a></td><td>${o.status}</td><td>${o.itemCount}</td><td>${money(o.totalCents)}</td></tr>`)
    .join("");
  sendHtml(
    res,
    200,
    layout("Orders", `<h1>Orders</h1><table><thead><tr><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Packets</th><th scope="col">Total</th></tr></thead><tbody>${rows}</tbody></table>`, b),
  );
}

const ACTION_LABEL = { packed: "Mark packed", shipped: "Mark shipped", cancelled: "Cancel order" };
function orderPage(res, b, o, notice, error, status = 200) {
  const lines = o.lines
    .map((l) => `<tr><td>${esc(l.name)}</td><td>${l.qty}</td><td>${money(l.unitCents)}</td><td>${l.discountCents ? money(-l.discountCents) : ""}</td><td>${money(l.lineCents)}</td></tr>`)
    .join("");
  const buttons = TRANSITIONS[o.status]
    .map((s) => `<form method="post" action="/orders/${o.id}/status" class="inline"><input type="hidden" name="status" value="${s}"><button type="submit">${ACTION_LABEL[s]}</button></form>`)
    .join(" ");
  sendHtml(
    res,
    status,
    layout(
      "Order " + o.number,
      `${notice ? `<p role="status" class="notice" data-notice="${notice.key}">${esc(notice.text)}</p>` : ""}${error ? `<p role="alert" class="errors" data-alert="order">${esc(error)}</p>` : ""}
<h1>Order ${o.number}</h1><p>Status: <strong>${o.status}</strong></p>
<table><thead><tr><th scope="col">Variety</th><th scope="col">Packets</th><th scope="col">Each</th><th scope="col">Discount</th><th scope="col">Line</th></tr></thead><tbody>${lines}</tbody></table>
<table class="totals"><tbody><tr><th scope="row">Subtotal</th><td>${money(o.subtotalCents)}</td></tr>${o.promo ? `<tr><th scope="row">Code ${esc(o.promo.code)}</th><td>${o.promo.applied ? money(-o.promo.discountCents) : "not applied"}</td></tr>` : ""}<tr><th scope="row">Shipping</th><td>${o.shippingCents ? money(o.shippingCents) : "free"}</td></tr><tr><th scope="row">Total</th><td>${money(o.totalCents)}</td></tr></tbody></table>
${buttons ? `<div class="actions">${buttons}</div>` : "<p>No further changes.</p>"}`,
      b,
    ),
  );
}

// ---------- routing ----------
const routes = [];
const route = (pattern, methods) => routes.push({ re: new RegExp("^" + pattern + "$"), methods });
const idOf = (m) => Number(m[1]);

route("/", {
  GET: (req, res) => homePage(res, basketFor(req, res)),
});
route("/static/seedlark\\.css", {
  GET: (req, res) => {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Content-Length": Buffer.byteLength(CSS) });
    res.end(req.method === "HEAD" ? undefined : CSS);
  },
});
route("/varieties", {
  GET: (req, res, m, url) => varietiesPage(res, basketFor(req, res), url.searchParams),
  POST: async (req, res) => {
    const b = basketFor(req, res);
    const form = await formBody(req);
    const r = createVariety(form);
    if (r.errors) return sendHtml(res, r.errors.some((e) => e.status === 422) ? 422 : 409, layout("New variety", `<h1>New variety</h1>${varietyForm("/varieties", "Create variety", form, r.errors)}`, b));
    redirect(res, `/varieties/${r.variety.id}?created=1`);
  },
});
route("/varieties/new", {
  GET: (req, res) => sendHtml(res, 200, layout("New variety", `<h1>New variety</h1>${varietyForm("/varieties", "Create variety", { status: "active" }, [])}`, basketFor(req, res))),
});
route("/varieties/(\\d+)", {
  GET: (req, res, m, url) => {
    const b = basketFor(req, res);
    const v = varieties.get(idOf(m));
    if (!v) return notFoundPage(res, b);
    const p = url.searchParams;
    const notice = p.get("created") ? { key: "created", text: "Variety created." } : p.get("saved") ? { key: "saved", text: "Changes saved." } : p.get("added") ? { key: "added", text: "Added to your basket." } : null;
    varietyPage(res, b, v, notice);
  },
  POST: async (req, res, m) => {
    const b = basketFor(req, res);
    const v = varieties.get(idOf(m));
    if (!v) return notFoundPage(res, b);
    const form = await formBody(req);
    const r = updateVariety(v, form);
    if (r.errors) return sendHtml(res, r.errors.some((e) => e.status === 422) ? 422 : 409, layout("Edit " + v.name, `<h1>Edit ${esc(v.name)}</h1>${varietyForm(`/varieties/${v.id}`, "Save changes", form, r.errors)}`, b));
    redirect(res, `/varieties/${v.id}?saved=1`);
  },
});
route("/varieties/(\\d+)/edit", {
  GET: (req, res, m) => {
    const b = basketFor(req, res);
    const v = varieties.get(idOf(m));
    if (!v) return notFoundPage(res, b);
    const values = { sku: v.sku, name: v.name, kind: v.kind, price: priceText(v.priceCents), stock: String(v.stock), status: v.status };
    sendHtml(res, 200, layout("Edit " + v.name, `<h1>Edit ${esc(v.name)}</h1>${varietyForm(`/varieties/${v.id}`, "Save changes", values, [])}`, b));
  },
});
route("/varieties/(\\d+)/delete", {
  POST: async (req, res, m) => {
    const b = basketFor(req, res);
    await readBody(req);
    const v = varieties.get(idOf(m));
    if (!v) return notFoundPage(res, b);
    const r = deleteVariety(v);
    if (r instanceof Fail) return sendHtml(res, 409, layout(v.name, `<h1>${esc(v.name)}</h1><p role="alert" class="errors" data-alert="delete">${esc(r.body.message)}</p><p><a href="/varieties/${v.id}">Back</a></p>`, b));
    redirect(res, "/varieties");
  },
});
route("/basket", { GET: (req, res, m, url) => basketPage(res, basketFor(req, res), 200, null, "", url.searchParams.get("applied") ? { key: "applied", text: "Code applied." } : null) });
route("/basket/lines", {
  POST: async (req, res) => {
    const b = basketFor(req, res);
    const form = await formBody(req);
    const f = addLine(b, form);
    if (f) {
      const v = varieties.get(intField(form.varietyId));
      if (!v) return notFoundPage(res, b);
      return varietyPage(res, b, v, "", Object.assign(new String(f.body.message), { status: f.status }), form.qty);
    }
    redirect(res, `/varieties/${intField(form.varietyId)}?added=1`);
  },
});
route("/basket/promo", {
  POST: async (req, res) => {
    const b = basketFor(req, res);
    const form = await formBody(req);
    const f = applyPromo(b, form);
    if (f) return basketPage(res, b, f.status, f.body.message, form.code ?? "");
    redirect(res, "/basket?applied=1");
  },
});
route("/basket/checkout", {
  POST: async (req, res) => {
    const b = basketFor(req, res);
    await readBody(req);
    const r = checkout(b);
    if (r instanceof Fail) return basketPage(res, b, r.status, r.body.message);
    redirect(res, `/orders/${r.id}?placed=1`);
  },
});
route("/orders", { GET: (req, res) => ordersPage(res, basketFor(req, res)) });
route("/orders/(\\d+)", {
  GET: (req, res, m, url) => {
    const b = basketFor(req, res);
    const o = orders.get(idOf(m));
    if (!o) return notFoundPage(res, b);
    orderPage(res, b, o, url.searchParams.get("placed") ? { key: "placed", text: "Order placed. Thank you." } : url.searchParams.get("changed") ? { key: "changed", text: "Order updated." } : null);
  },
});
route("/orders/(\\d+)/status", {
  POST: async (req, res, m) => {
    const b = basketFor(req, res);
    const form = await formBody(req);
    const o = orders.get(idOf(m));
    if (!o) return notFoundPage(res, b);
    const f = changeOrderStatus(o, form);
    if (f) return orderPage(res, b, o, "", f.body.message, f.status);
    redirect(res, `/orders/${o.id}?changed=1`);
  },
});

// API
const fail = (res, f) => sendJson(res, f.status, f.body);
route("/api/health", { GET: (req, res) => sendJson(res, 200, { ok: true }) });
route("/api/varieties", {
  GET: (req, res, m, url) => {
    const list = listVarieties(url.searchParams);
    sendJson(res, 200, { items: list.items.map(varietyJson), total: list.total, page: list.page, pages: list.pages, pageSize: list.pageSize, sort: list.sort, dir: list.dir });
  },
  POST: async (req, res) => {
    const r = createVariety(await jsonBody(req));
    if (r.errors) return fail(res, r.errors[0]);
    sendJson(res, 201, varietyJson(r.variety));
  },
});
route("/api/varieties/(\\d+)", {
  GET: (req, res, m) => {
    const v = varieties.get(idOf(m));
    if (!v) return fail(res, new Fail(404, "variety_not_found", "No such variety.", { id: idOf(m) }));
    const tag = etagOf(v);
    const inm = (req.headers["if-none-match"] || "").split(",").map((s) => s.trim());
    if (inm.includes(tag) || inm.includes("*")) {
      res.writeHead(304, { ETag: tag, "Cache-Control": "no-cache" });
      return res.end();
    }
    sendJson(res, 200, varietyJson(v), { ETag: tag, "Cache-Control": "no-cache" });
  },
  PUT: async (req, res, m) => {
    const v = varieties.get(idOf(m));
    if (!v) return fail(res, new Fail(404, "variety_not_found", "No such variety.", { id: idOf(m) }));
    const r = updateVariety(v, await jsonBody(req));
    if (r.errors) return fail(res, r.errors[0]);
    sendJson(res, 200, varietyJson(v), { ETag: etagOf(v) });
  },
  DELETE: (req, res, m) => {
    const v = varieties.get(idOf(m));
    if (!v) return fail(res, new Fail(404, "variety_not_found", "No such variety.", { id: idOf(m) }));
    const r = deleteVariety(v);
    if (r instanceof Fail) return fail(res, r);
    sendJson(res, 200, r);
  },
});
route("/api/basket", {
  GET: (req, res) => sendJson(res, 200, basketView(basketFor(req, res))),
  DELETE: (req, res) => {
    const b = basketFor(req, res);
    b.lines.clear();
    b.promo = null;
    sendJson(res, 200, basketView(b));
  },
});
route("/api/basket/lines", {
  POST: async (req, res) => {
    const b = basketFor(req, res);
    const f = addLine(b, await jsonBody(req));
    if (f) return fail(res, f);
    sendJson(res, 200, basketView(b));
  },
});
route("/api/basket/lines/(\\d+)", {
  PUT: async (req, res, m) => {
    const b = basketFor(req, res);
    const f = setLine(b, idOf(m), await jsonBody(req));
    if (f) return fail(res, f);
    sendJson(res, 200, basketView(b));
  },
  DELETE: (req, res, m) => {
    const b = basketFor(req, res);
    if (!b.lines.delete(idOf(m))) return fail(res, new Fail(404, "line_not_found", "That variety is not in the basket.", { varietyId: idOf(m) }));
    sendJson(res, 200, basketView(b));
  },
});
route("/api/basket/promo", {
  POST: async (req, res) => {
    const b = basketFor(req, res);
    const f = applyPromo(b, await jsonBody(req));
    if (f) return fail(res, f);
    sendJson(res, 200, basketView(b));
  },
  DELETE: (req, res) => {
    const b = basketFor(req, res);
    b.promo = null;
    sendJson(res, 200, basketView(b));
  },
});
route("/api/checkout", {
  POST: async (req, res) => {
    const b = basketFor(req, res);
    await readBody(req);
    const r = checkout(b);
    if (r instanceof Fail) return fail(res, r);
    sendJson(res, 201, r);
  },
});
route("/api/orders", {
  GET: (req, res, m, url) => sendJson(res, 200, listOrders(url.searchParams)),
});
route("/api/orders/(\\d+)", {
  GET: (req, res, m) => {
    const o = orders.get(idOf(m));
    if (!o) return fail(res, new Fail(404, "order_not_found", "No such order.", { id: idOf(m) }));
    sendJson(res, 200, o);
  },
});
route("/api/orders/(\\d+)/status", {
  PUT: async (req, res, m) => {
    const o = orders.get(idOf(m));
    if (!o) return fail(res, new Fail(404, "order_not_found", "No such order.", { id: idOf(m) }));
    const f = changeOrderStatus(o, await jsonBody(req));
    if (f) return fail(res, f);
    sendJson(res, 200, o);
  },
});

const server = http.createServer(async (req, res) => {
  res.req = req;
  res.setHeader("X-Request-Id", hex(8));
  const url = new URL(req.url, `http://${HOST}`);
  const isApi = url.pathname.startsWith("/api/");
  try {
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const allow = Object.keys(r.methods);
      if (allow.includes("GET")) allow.splice(allow.indexOf("GET") + 1, 0, "HEAD");
      const method = req.method === "HEAD" && r.methods.GET ? "GET" : req.method;
      const h = r.methods[method];
      if (!h) {
        res.setHeader("Allow", allow.join(", "));
        if (isApi) return sendJson(res, 405, { error: "method_not_allowed", message: "Method not allowed here.", allow });
        return sendHtml(res, 405, layout("Not allowed", `<h1>Method not allowed</h1><p>This address accepts ${allow.join(", ")}.</p>`, null));
      }
      return await h(req, res, m, url);
    }
    if (isApi) return sendJson(res, 404, { error: "not_found", message: "No such endpoint." });
    notFoundPage(res, null);
  } catch (e) {
    if (e instanceof Fail) {
      if (!res.headersSent) {
        if (isApi) return fail(res, e);
        return sendHtml(res, e.status, layout("Problem", `<h1>Problem</h1><p role="alert">${esc(e.body.message)}</p>`, null));
      }
      return;
    }
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: "internal", message: "Something went wrong." });
  }
});

server.listen(PORT, HOST, () => {
  if (process.env.SEEDLARK_PID_FILE) fs.writeFileSync(process.env.SEEDLARK_PID_FILE, String(process.pid));
  console.log(`Seedlark on http://${HOST}:${PORT}`);
});
const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
