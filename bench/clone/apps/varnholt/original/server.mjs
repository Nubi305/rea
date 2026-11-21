// Varnholt: a dispatch desk for a small courier. Manifests are van loads, parcels ride on them.
// Node standard library only. All data lives in memory and is rebuilt from the seed on every start.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4701);
const PID_FILE = process.env.VARNHOLT_PID_FILE ?? "";

const STATUSES = ["open", "sealed", "dispatched", "delivered"];
const NEXT_STATUS = {
  open: ["sealed"],
  sealed: ["open", "dispatched"],
  dispatched: ["delivered"],
  delivered: [],
};
const MAX_PARCELS = 6;
const MAX_WEIGHT_TENTHS = 300;
const DEFAULT_CAPACITY_KG = 50;
const MIN_CAPACITY_KG = 1;
const MAX_CAPACITY_KG = 200;
const BASE_CHARGE_CENTS = 350;
const CHARGE_PER_KG_CENTS = 120;
const MAX_BODY_BYTES = 16 * 1024;

// ---- store -----------------------------------------------------------------------------------

const manifests = new Map();
const parcels = new Map();
let nextManifestId = 1;
let nextParcelId = 1;

const chargeFor = (tenths, fragile) => {
  const billableKg = Math.floor((tenths + 9) / 10);
  const base = BASE_CHARGE_CENTS + CHARGE_PER_KG_CENTS * billableKg;
  return fragile ? Math.floor((base * 115 + 50) / 100) : base;
};

const seedManifest = (code, destination, status, capacityKg, uid, createdAt) => {
  const id = nextManifestId++;
  manifests.set(id, { id, uid, code, destination, status, capacityKg, createdAt });
  return id;
};
const seedParcel = (manifestId, recipient, tenths, fragile, uid, createdAt) => {
  const id = nextParcelId++;
  parcels.set(id, { id, uid, manifestId, recipient, tenths, fragile, createdAt });
};

const m1 = seedManifest("NR-101", "Northgate Depot", "open", 50, "mf_7c1e90ab", "2026-03-02T08:15:00.000Z");
const m2 = seedManifest("HB-204", "Harbour Row", "sealed", 40, "mf_02d4f6a1", "2026-03-02T09:40:00.000Z");
const m3 = seedManifest("EW-310", "Eastwick Lockers", "dispatched", 60, "mf_b83a11c7", "2026-03-03T07:05:00.000Z");
const m4 = seedManifest("SM-007", "South Mill", "delivered", 50, "mf_4e5f6071", "2026-03-03T11:30:00.000Z");
seedManifest("QA-550", "Quarry Lane", "open", 20, "mf_d09c3b2e", "2026-03-04T06:50:00.000Z");
seedParcel(m1, "Ines Marlow", 45, false, "pc_19aa04f3", "2026-03-02T08:20:00.000Z");
seedParcel(m1, "bao Tran", 45, false, "pc_5b7d2e80", "2026-03-02T08:24:00.000Z");
seedParcel(m1, "Odile Ferrant", 120, true, "pc_c3410f9d", "2026-03-02T08:31:00.000Z");
seedParcel(m2, "Tomas Reyes", 72, false, "pc_8e6a5512", "2026-03-02T09:44:00.000Z");
seedParcel(m2, "Wren Abara", 10, true, "pc_f0217b6c", "2026-03-02T09:52:00.000Z");
seedParcel(m3, "Kofi Lindqvist", 200, false, "pc_3d9e8a47", "2026-03-03T07:10:00.000Z");
seedParcel(m3, "Mira Stone", 33, false, "pc_a67c0d15", "2026-03-03T07:12:00.000Z");
seedParcel(m4, "Per Halloran", 99, true, "pc_62b8e3fa", "2026-03-03T11:36:00.000Z");

const parcelsOf = (manifestId) => [...parcels.values()].filter((p) => p.manifestId === manifestId);
const loadTenths = (manifestId, exceptId) =>
  parcelsOf(manifestId).reduce((sum, p) => (p.id === exceptId ? sum : sum + p.tenths), 0);
const kg = (tenths) => tenths / 10;
const foldName = (text) => text.toLowerCase();

const parcelView = (p) => ({
  id: p.id,
  uid: p.uid,
  manifestId: p.manifestId,
  recipient: p.recipient,
  weightKg: kg(p.tenths),
  fragile: p.fragile,
  chargeCents: chargeFor(p.tenths, p.fragile),
  createdAt: p.createdAt,
});

const manifestView = (m) => {
  const own = parcelsOf(m.id);
  const used = own.reduce((sum, p) => sum + p.tenths, 0);
  return {
    id: m.id,
    uid: m.uid,
    code: m.code,
    destination: m.destination,
    status: m.status,
    capacityKg: m.capacityKg,
    parcelCount: own.length,
    totalWeightKg: kg(used),
    remainingKg: kg(m.capacityKg * 10 - used),
    totalChargeCents: own.reduce((sum, p) => sum + chargeFor(p.tenths, p.fragile), 0),
    createdAt: m.createdAt,
  };
};

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedManifests = (list) =>
  [...list].sort(
    (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || compareText(a.code, b.code),
  );
const sortedParcels = (list) =>
  [...list].sort(
    (a, b) =>
      b.tenths - a.tenths || compareText(foldName(a.recipient), foldName(b.recipient)) || a.id - b.id,
  );

// ---- replies ---------------------------------------------------------------------------------

class Refusal extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.body = { error: code, message, ...details };
  }
}
const refuse = (status, code, message, details) => {
  throw new Refusal(status, code, message, details);
};

const sendJson = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
};

// ---- validation ------------------------------------------------------------------------------

const squeeze = (text) => text.trim().replace(/\s+/gu, " ");

const readCode = (value) => {
  if (typeof value !== "string" || value.trim() === "")
    refuse(422, "code_required", "A manifest needs a code.");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}-[0-9]{3}$/u.test(code))
    refuse(422, "code_format", "A code is two letters, a dash and three digits.", { pattern: "AA-000" });
  return code;
};

const readDestination = (value) => {
  if (typeof value !== "string" || value.trim() === "")
    refuse(422, "destination_required", "A manifest needs a destination.");
  const destination = squeeze(value);
  if (destination.length < 2 || destination.length > 60)
    refuse(422, "destination_length", "A destination has 2 to 60 characters.", { min: 2, max: 60 });
  return destination;
};

const readCapacity = (value) => {
  if (!Number.isInteger(value) || value < MIN_CAPACITY_KG || value > MAX_CAPACITY_KG)
    refuse(422, "capacity_invalid", "Capacity is a whole number of kilograms from 1 to 200.", {
      min: MIN_CAPACITY_KG,
      max: MAX_CAPACITY_KG,
    });
  return value;
};

const readRecipient = (value) => {
  if (typeof value !== "string" || value.trim() === "")
    refuse(422, "recipient_required", "A parcel needs a recipient.");
  const recipient = squeeze(value);
  if (recipient.length < 2 || recipient.length > 40)
    refuse(422, "recipient_length", "A recipient has 2 to 40 characters.", { min: 2, max: 40 });
  return recipient;
};

const readWeight = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value))
    refuse(422, "weight_invalid", "Weight is a number of kilograms above zero.");
  const tenths = Math.round(value * 10);
  if (tenths <= 0) refuse(422, "weight_invalid", "Weight is a number of kilograms above zero.");
  if (tenths > MAX_WEIGHT_TENTHS)
    refuse(422, "weight_over_limit", "A parcel weighs at most 30 kg.", { maxKg: kg(MAX_WEIGHT_TENTHS) });
  return tenths;
};

const readFragile = (value) => {
  if (typeof value !== "boolean") refuse(422, "fragile_invalid", "Fragile is true or false.");
  return value;
};

const requireOpen = (manifest) => {
  if (manifest.status !== "open")
    refuse(409, "manifest_locked", "Only an open manifest can be changed.", { status: manifest.status });
};

const requireFreeRecipient = (manifestId, recipient, exceptId) => {
  const clash = parcelsOf(manifestId)
    .sort((a, b) => a.id - b.id)
    .find((p) => p.id !== exceptId && foldName(p.recipient) === foldName(recipient));
  if (clash)
    refuse(409, "recipient_duplicate", "This manifest already carries a parcel for that recipient.", {
      existingId: clash.id,
    });
};

const requireRoom = (manifest, tenths, exceptId) => {
  const used = loadTenths(manifest.id, exceptId);
  if (used + tenths > manifest.capacityKg * 10)
    refuse(409, "capacity_exceeded", "That parcel does not fit the manifest's capacity.", {
      capacityKg: manifest.capacityKg,
      usedKg: kg(used),
      requestedKg: kg(tenths),
    });
};

const findManifest = (id) =>
  manifests.get(id) ?? refuse(404, "manifest_not_found", "No such manifest.", { id });
const findParcel = (id) => parcels.get(id) ?? refuse(404, "parcel_not_found", "No such parcel.", { id });

// ---- handlers --------------------------------------------------------------------------------

const listManifests = (query) => {
  let list = [...manifests.values()];
  const status = query.get("status");
  if (status !== null && status !== "") {
    if (!STATUSES.includes(status))
      refuse(422, "status_invalid", "Unknown status.", { allowed: STATUSES });
    list = list.filter((m) => m.status === status);
  }
  const q = (query.get("q") ?? "").trim().toLowerCase();
  if (q !== "")
    list = list.filter(
      (m) => m.code.toLowerCase().includes(q) || m.destination.toLowerCase().includes(q),
    );
  const items = sortedManifests(list).map(manifestView);
  return [200, { items, total: items.length }];
};

const createManifest = (body) => {
  const code = readCode(body.code);
  const destination = readDestination(body.destination);
  const capacityKg = body.capacityKg === undefined ? DEFAULT_CAPACITY_KG : readCapacity(body.capacityKg);
  const taken = [...manifests.values()].find((m) => m.code === code);
  if (taken) refuse(409, "code_taken", "Another manifest uses that code.", { existingId: taken.id });
  const id = nextManifestId++;
  const manifest = {
    id,
    uid: `mf_${randomBytes(4).toString("hex")}`,
    code,
    destination,
    status: "open",
    capacityKg,
    createdAt: new Date().toISOString(),
  };
  manifests.set(id, manifest);
  return [201, manifestView(manifest)];
};

const updateManifest = (id, body) => {
  const manifest = findManifest(id);
  const code = body.code === undefined ? manifest.code : readCode(body.code);
  const destination = body.destination === undefined ? manifest.destination : readDestination(body.destination);
  const capacityKg = body.capacityKg === undefined ? manifest.capacityKg : readCapacity(body.capacityKg);
  requireOpen(manifest);
  const taken = [...manifests.values()].find((m) => m.code === code && m.id !== id);
  if (taken) refuse(409, "code_taken", "Another manifest uses that code.", { existingId: taken.id });
  const used = loadTenths(id);
  if (capacityKg * 10 < used)
    refuse(409, "capacity_below_load", "Capacity cannot drop below what is already loaded.", {
      capacityKg,
      usedKg: kg(used),
    });
  Object.assign(manifest, { code, destination, capacityKg });
  return [200, manifestView(manifest)];
};

const changeStatus = (id, body) => {
  const manifest = findManifest(id);
  const to = body.status;
  if (typeof to !== "string" || !STATUSES.includes(to))
    refuse(422, "status_invalid", "Unknown status.", { allowed: STATUSES });
  const allowed = NEXT_STATUS[manifest.status];
  if (!allowed.includes(to))
    refuse(409, "invalid_transition", `A manifest that is ${manifest.status} cannot become ${to}.`, {
      from: manifest.status,
      to,
      allowed,
    });
  if (to === "sealed" && parcelsOf(id).length === 0)
    refuse(409, "manifest_empty", "An empty manifest cannot be sealed.");
  manifest.status = to;
  return [200, manifestView(manifest)];
};

const deleteManifest = (id) => {
  const manifest = findManifest(id);
  if (manifest.status === "dispatched")
    refuse(409, "manifest_in_transit", "A dispatched manifest cannot be deleted until it is delivered.", {
      status: manifest.status,
    });
  const own = parcelsOf(id);
  for (const parcel of own) parcels.delete(parcel.id);
  manifests.delete(id);
  return [200, { deleted: true, id, parcelsRemoved: own.length }];
};

const listParcels = (query) => {
  let list = [...parcels.values()];
  const raw = query.get("manifestId");
  if (raw !== null && raw !== "") {
    const manifestId = /^[0-9]+$/u.test(raw) ? Number(raw) : -1;
    findManifest(manifestId);
    list = list.filter((p) => p.manifestId === manifestId);
  }
  const items = sortedParcels(list).map(parcelView);
  return [200, { items, total: items.length }];
};

const createParcel = (body) => {
  if (!Number.isInteger(body.manifestId))
    refuse(422, "manifest_required", "A parcel belongs to a manifest.");
  const manifest = findManifest(body.manifestId);
  const recipient = readRecipient(body.recipient);
  const tenths = readWeight(body.weightKg);
  const fragile = body.fragile === undefined ? false : readFragile(body.fragile);
  requireOpen(manifest);
  if (parcelsOf(manifest.id).length >= MAX_PARCELS)
    refuse(409, "manifest_full", "A manifest carries at most 6 parcels.", { maxParcels: MAX_PARCELS });
  requireFreeRecipient(manifest.id, recipient, -1);
  requireRoom(manifest, tenths, -1);
  const id = nextParcelId++;
  const parcel = {
    id,
    uid: `pc_${randomBytes(4).toString("hex")}`,
    manifestId: manifest.id,
    recipient,
    tenths,
    fragile,
    createdAt: new Date().toISOString(),
  };
  parcels.set(id, parcel);
  return [201, parcelView(parcel)];
};

const updateParcel = (id, body) => {
  const parcel = findParcel(id);
  if (body.manifestId !== undefined && body.manifestId !== parcel.manifestId)
    refuse(422, "manifest_immutable", "A parcel cannot move to another manifest.", {
      manifestId: parcel.manifestId,
    });
  const recipient = body.recipient === undefined ? parcel.recipient : readRecipient(body.recipient);
  const tenths = body.weightKg === undefined ? parcel.tenths : readWeight(body.weightKg);
  const fragile = body.fragile === undefined ? parcel.fragile : readFragile(body.fragile);
  const manifest = manifests.get(parcel.manifestId);
  requireOpen(manifest);
  requireFreeRecipient(manifest.id, recipient, id);
  requireRoom(manifest, tenths, id);
  Object.assign(parcel, { recipient, tenths, fragile });
  return [200, parcelView(parcel)];
};

const deleteParcel = (id) => {
  const parcel = findParcel(id);
  requireOpen(manifests.get(parcel.manifestId));
  parcels.delete(id);
  return [200, { deleted: true, id }];
};

const summary = () => {
  const views = sortedManifests([...manifests.values()]).map(manifestView);
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const view of views) byStatus[view.status] += 1;
  const all = [...parcels.values()];
  const tenths = all.reduce((sum, p) => sum + p.tenths, 0);
  const inTransit = all
    .filter((p) => manifests.get(p.manifestId).status === "dispatched")
    .reduce((sum, p) => sum + p.tenths, 0);
  const loaded = views.filter((view) => view.parcelCount > 0);
  const heaviest = [...loaded].sort(
    (a, b) => b.totalWeightKg - a.totalWeightKg || compareText(a.code, b.code),
  )[0];
  return [
    200,
    {
      manifests: { ...byStatus, total: views.length },
      parcels: all.length,
      fragileParcels: all.filter((p) => p.fragile).length,
      totalWeightKg: kg(tenths),
      inTransitWeightKg: kg(inTransit),
      averageParcelWeightKg: all.length === 0 ? 0 : Math.round((tenths * 10) / all.length) / 100,
      totalChargeCents: all.reduce((sum, p) => sum + chargeFor(p.tenths, p.fragile), 0),
      heaviest: heaviest
        ? { id: heaviest.id, code: heaviest.code, totalWeightKg: heaviest.totalWeightKg }
        : null,
    },
  ];
};

// ---- routing ---------------------------------------------------------------------------------

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (size > MAX_BODY_BYTES)
        return reject(new Refusal(413, "body_too_large", "The request body is too large."));
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") return resolve({});
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return reject(new Refusal(400, "invalid_json", "The request body is not JSON."));
      }
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return reject(new Refusal(400, "invalid_json", "The request body is not a JSON object."));
      resolve(value);
    });
  });

const idOf = (text) => (/^[0-9]{1,9}$/u.test(text) ? Number(text) : null);

const api = async (req, url) => {
  const method = req.method ?? "GET";
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const [resource, rawId, tail] = parts;
  const wrongMethod = (allow) =>
    refuse(405, "method_not_allowed", "That method is not supported here.", { allow });

  if (parts.length === 1 && resource === "health") {
    if (method !== "GET") wrongMethod(["GET"]);
    return [200, { ok: true }];
  }
  if (parts.length === 1 && resource === "summary") {
    if (method !== "GET") wrongMethod(["GET"]);
    return summary();
  }
  if (resource === "manifests" || resource === "parcels") {
    const isManifest = resource === "manifests";
    if (parts.length === 1) {
      if (method === "GET") return isManifest ? listManifests(url.searchParams) : listParcels(url.searchParams);
      if (method === "POST") {
        const body = await readBody(req);
        return isManifest ? createManifest(body) : createParcel(body);
      }
      wrongMethod(["GET", "POST"]);
    }
    const id = idOf(rawId);
    if (id !== null && parts.length === 2) {
      if (method === "GET")
        return [200, isManifest ? manifestView(findManifest(id)) : parcelView(findParcel(id))];
      if (method === "PUT") {
        const body = await readBody(req);
        return isManifest ? updateManifest(id, body) : updateParcel(id, body);
      }
      if (method === "DELETE") return isManifest ? deleteManifest(id) : deleteParcel(id);
      wrongMethod(["GET", "PUT", "DELETE"]);
    }
    if (id !== null && parts.length === 3 && isManifest && tail === "status") {
      if (method !== "PUT") wrongMethod(["PUT"]);
      return changeStatus(id, await readBody(req));
    }
  }
  return refuse(404, "not_found", "No such route.");
};

// ---- pages -----------------------------------------------------------------------------------

const asset = (file, type) => ({ type, body: readFileSync(path.join(HERE, "public", file)) });
const page = (file) => readFileSync(path.join(HERE, "public", file), "utf8");
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";
const FILES = new Map([
  ["/assets/app.css", asset("app.css", "text/css; charset=utf-8")],
  ["/assets/common.js", asset("common.js", JS)],
  ["/assets/board.js", asset("board.js", JS)],
  ["/assets/manifest.js", asset("manifest.js", JS)],
  ["/assets/parcel.js", asset("parcel.js", JS)],
  ["/assets/summary.js", asset("summary.js", JS)],
]);

// Each page carries the data its first render needs, so the first render makes no request.
const attempt = (read) => {
  try {
    return { ok: true, data: read() };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, data: error.body };
    throw error;
  }
};
const queryId = (url) => idOf(url.searchParams.get("id") ?? "") ?? -1;
const PAGES = new Map([
  ["/", { html: page("board.html"), boot: () => ({ manifests: listManifests(new URLSearchParams())[1] }) }],
  [
    "/manifest",
    {
      html: page("manifest.html"),
      boot: (url) => {
        const id = queryId(url);
        const manifest = attempt(() => manifestView(findManifest(id)));
        return {
          manifest,
          parcels: manifest.ok ? listParcels(new URLSearchParams({ manifestId: String(id) }))[1] : null,
        };
      },
    },
  ],
  [
    "/parcel",
    {
      html: page("parcel.html"),
      boot: (url) => {
        const parcel = attempt(() => parcelView(findParcel(queryId(url))));
        return {
          parcel,
          manifest: parcel.ok ? manifestView(manifests.get(parcel.data.manifestId)) : null,
        };
      },
    },
  ],
  ["/summary", { html: page("summary.html"), boot: () => ({ summary: summary()[1] }) }],
  ["/about", { html: page("about.html"), boot: () => null }],
]);
const renderPage = (entry, url) => {
  const boot = entry.boot(url);
  const tag =
    boot === null
      ? ""
      : `<script id="boot" type="application/json">${JSON.stringify(boot).replaceAll("<", "\\u003c")}</script>`;
  return Buffer.from(entry.html.replace("<!--boot-->", () => tag), "utf8");
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    api(req, url)
      .then(([status, body]) => sendJson(res, status, body))
      .catch((error) => {
        if (error instanceof Refusal) return sendJson(res, error.status, error.body);
        sendJson(res, 500, { error: "internal", message: "Unexpected failure." });
      });
    return;
  }
  const readOnly = req.method === "GET" || req.method === "HEAD";
  const entry = readOnly ? PAGES.get(url.pathname) : undefined;
  const file = entry
    ? { type: HTML, body: renderPage(entry, url) }
    : readOnly
      ? FILES.get(url.pathname)
      : undefined;
  if (!file) {
    const text = "Not found\n";
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "content-length": text.length });
    res.end(req.method === "HEAD" ? undefined : text);
    return;
  }
  res.writeHead(200, { "content-type": file.type, "content-length": file.body.length });
  res.end(req.method === "HEAD" ? undefined : file.body);
});

const removePidFile = () => {
  if (PID_FILE === "") return;
  try {
    if (readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) rmSync(PID_FILE);
  } catch {
    // Already gone.
  }
};

server.on("error", (error) => {
  console.error(`varnholt: cannot listen on ${HOST}:${PORT}: ${error.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  // The pid file is written by the serving process itself, only once it holds the port.
  if (PID_FILE !== "") {
    mkdirSync(path.dirname(PID_FILE), { recursive: true });
    writeFileSync(PID_FILE, `${process.pid}\n`);
  }
  console.log(`varnholt listening on http://${HOST}:${PORT} pid ${process.pid}`);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    removePidFile();
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 1500).unref();
  });
