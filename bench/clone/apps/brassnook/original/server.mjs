#!/usr/bin/env node
// Brassnook: room bookings for a rehearsal studio. Node standard library only, one process,
// data in memory and rebuilt from the seed at every start.
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 5340);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC = new URL("./public/", import.meta.url);

const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 23 * 60;
const STATUSES = ["tentative", "confirmed", "checked_in", "completed", "cancelled"];
const TRANSITIONS = {
  tentative: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled"],
  checked_in: ["completed"],
  completed: [],
  cancelled: [],
};
const ACTIVE = new Set(["tentative", "confirmed", "checked_in"]);
const BAND_DAILY_LIMIT = 2;
const PAGE_DEFAULT = 10;
const PAGE_MAX = 25;

// ---------- seed ----------
const SEED_ROOMS = [
  { id: 1, uid: "rm_51c0e2a7", name: "Blue Room", capacity: 6, rateCents: 1500, active: true, createdAt: "2026-11-02T09:00:00.000Z" },
  { id: 2, uid: "rm_8d14f6b3", name: "Annexe", capacity: 4, rateCents: 1250, active: true, createdAt: "2026-11-02T09:05:00.000Z" },
  { id: 3, uid: "rm_2a9e7c40", name: "Café Stage", capacity: 10, rateCents: 2400, active: true, createdAt: "2026-11-02T09:10:00.000Z" },
  { id: 4, uid: "rm_f3b605d9", name: "Drum Booth", capacity: 2, rateCents: 900, active: false, createdAt: "2026-11-02T09:15:00.000Z" },
  { id: 5, uid: "rm_6e7a19c2", name: "atrium", capacity: 6, rateCents: 1350, active: true, createdAt: "2026-11-03T10:00:00.000Z" },
];
const SEED_BOOKINGS = [
  { id: 1, uid: "bk_0c4f2e91", roomId: 1, band: "The Low Tides", players: 5, date: "2026-12-08", start: "18:00", minutes: 120, status: "confirmed", createdAt: "2026-11-10T12:00:00.000Z" },
  { id: 2, uid: "bk_7b21d3a8", roomId: 1, band: "Marrow Quartet", players: 4, date: "2026-12-08", start: "10:00", minutes: 90, status: "tentative", createdAt: "2026-11-10T12:30:00.000Z" },
  { id: 3, uid: "bk_e5a90f16", roomId: 3, band: "Saltmarsh Choir", players: 10, date: "2026-12-09", start: "19:00", minutes: 120, status: "checked_in", createdAt: "2026-11-11T08:15:00.000Z" },
  { id: 4, uid: "bk_19c8b7e2", roomId: 2, band: "Kiln", players: 3, date: "2026-12-08", start: "14:00", minutes: 60, status: "completed", createdAt: "2026-11-11T09:40:00.000Z" },
  { id: 5, uid: "bk_a3f6c054", roomId: 5, band: "Paper Lanterns", players: 2, date: "2026-12-08", start: "10:00", minutes: 90, status: "tentative", createdAt: "2026-11-12T16:20:00.000Z" },
  { id: 6, uid: "bk_5d02e7bb", roomId: 2, band: "Velvet Static", players: 4, date: "2026-12-10", start: "09:00", minutes: 45, status: "cancelled", createdAt: "2026-11-12T17:05:00.000Z" },
  { id: 7, uid: "bk_c87e3d1f", roomId: 1, band: "Opal Fern", players: 3, date: "2026-12-11", start: "08:00", minutes: 60, status: "cancelled", createdAt: "2026-11-13T07:55:00.000Z" },
];
// Prices captured when a booking was confirmed, and fees of cancelled confirmed bookings.
const SEED_LOCKED = { 1: 3750, 3: 6000, 4: 1250, 7: 1500 };
const SEED_FEES = { 6: 0, 7: 750 };

let rooms = [];
let bookings = [];
let nextRoomId = 6;
let nextBookingId = 8;

function seed() {
  rooms = SEED_ROOMS.map((r) => ({ ...r, slug: slugify(r.name) }));
  bookings = SEED_BOOKINGS.map((b) => ({
    ...b,
    lockedCents: SEED_LOCKED[b.id] ?? null,
    feeCents: SEED_FEES[b.id] ?? 0,
  }));
  nextRoomId = 6;
  nextBookingId = 8;
}

// ---------- helpers ----------
function collapse(s) {
  return s.trim().replace(/\s+/g, " ");
}
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function bandKey(band) {
  return collapse(band).toLowerCase();
}
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function weekday(s) {
  return new Date(`${s}T00:00:00Z`).getUTCDay();
}
// numerator / denominator rounded to an integer, ties to the even neighbour
function roundHalfEven(num, den) {
  const q = Math.floor(num / den);
  const r = num - q * den;
  if (r * 2 < den) return q;
  if (r * 2 > den) return q + 1;
  return q % 2 === 0 ? q : q + 1;
}
// Minutes from 18:00 cost a quarter more.
function priceFor(rateCents, start, minutes) {
  const s = toMin(start);
  const e = s + minutes;
  const evening = Math.max(0, e - Math.max(s, 18 * 60));
  const day = minutes - evening;
  return roundHalfEven(rateCents * (day * 4 + evening * 5), 240);
}
function roomOf(b) {
  return rooms.find((r) => r.id === b.roomId);
}
function bookingTotal(b) {
  if (b.lockedCents !== null) return b.lockedCents;
  const room = roomOf(b);
  return room ? priceFor(room.rateCents, b.start, b.minutes) : 0;
}
function viewBooking(b) {
  const room = roomOf(b);
  return {
    id: b.id,
    uid: b.uid,
    ref: `BK-${String(b.id).padStart(4, "0")}`,
    roomId: b.roomId,
    roomName: room ? room.name : null,
    band: b.band,
    players: b.players,
    date: b.date,
    start: b.start,
    end: toHHMM(toMin(b.start) + b.minutes),
    minutes: b.minutes,
    status: b.status,
    totalCents: bookingTotal(b),
    feeCents: b.feeCents,
    createdAt: b.createdAt,
  };
}
function viewRoom(r) {
  return {
    id: r.id,
    uid: r.uid,
    name: r.name,
    slug: r.slug,
    capacity: r.capacity,
    rateCents: r.rateCents,
    active: r.active,
    openBookings: bookings.filter((b) => b.roomId === r.id && ACTIVE.has(b.status)).length,
    createdAt: r.createdAt,
  };
}
function cmpText(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
function sortedRooms() {
  return rooms.slice().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.capacity !== b.capacity) return b.capacity - a.capacity;
    return cmpText(a.name, b.name) || a.id - b.id;
  });
}
function sortBookings(list) {
  return list.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.start !== b.start) return toMin(a.start) - toMin(b.start);
    const ra = roomOf(a);
    const rb = roomOf(b);
    return cmpText(ra ? ra.name : "", rb ? rb.name : "") || a.id - b.id;
  });
}
function newUid(prefix) {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const fail = (status, code, message, extra) => {
  throw new HttpError(status, code, message, extra);
};

// ---------- rooms ----------
function readRoomFields(body, current) {
  const out = {};
  if (body.name !== undefined || !current) {
    if (body.name === undefined || body.name === null || (typeof body.name === "string" && body.name.trim() === ""))
      fail(422, "name_required", "A room needs a name.");
    if (typeof body.name !== "string") fail(422, "name_required", "A room needs a name.");
    const name = collapse(body.name);
    if (name.length < 3 || name.length > 40) fail(422, "name_length", "A room name has 3 to 40 characters.", { min: 3, max: 40 });
    const slug = slugify(name);
    if (slug === "") fail(422, "name_length", "A room name has 3 to 40 characters.", { min: 3, max: 40 });
    out.name = name;
    out.slug = slug;
  }
  if (body.capacity !== undefined || !current) {
    const c = body.capacity === undefined ? 4 : body.capacity;
    if (!Number.isInteger(c) || c < 1 || c > 12)
      fail(422, "capacity_invalid", "Capacity is a whole number of players from 1 to 12.", { min: 1, max: 12 });
    out.capacity = c;
  }
  if (body.rateCents !== undefined || !current) {
    const r = body.rateCents === undefined ? 1500 : body.rateCents;
    if (!Number.isInteger(r) || r < 500 || r > 20000 || r % 50 !== 0)
      fail(422, "rate_invalid", "The hourly rate is 500 to 20000 cents in steps of 50.", { min: 500, max: 20000, step: 50 });
    out.rateCents = r;
  }
  if (body.active !== undefined || !current) {
    const a = body.active === undefined ? true : body.active;
    if (typeof a !== "boolean") fail(422, "active_invalid", "active is true or false.");
    out.active = a;
  }
  return out;
}
function createRoom(body) {
  const f = readRoomFields(body, null);
  const clash = rooms.find((r) => r.slug === f.slug);
  if (clash) fail(409, "name_taken", "Another room has that name.", { existingId: clash.id });
  const room = { id: nextRoomId++, uid: newUid("rm"), ...f, createdAt: new Date().toISOString() };
  rooms.push(room);
  return room;
}
function updateRoom(room, body) {
  const f = readRoomFields(body, room);
  if (f.slug !== undefined) {
    const clash = rooms.find((r) => r.slug === f.slug && r.id !== room.id);
    if (clash) fail(409, "name_taken", "Another room has that name.", { existingId: clash.id });
  }
  if (f.capacity !== undefined) {
    const largest = bookings
      .filter((b) => b.roomId === room.id && ACTIVE.has(b.status))
      .reduce((m, b) => Math.max(m, b.players), 0);
    if (f.capacity < largest)
      fail(409, "capacity_below_booking", "An open booking has more players than that.", { capacity: f.capacity, largestBooking: largest });
  }
  Object.assign(room, f);
  return room;
}
function deleteRoom(room) {
  const held = bookings.filter((b) => b.roomId === room.id && (b.status === "confirmed" || b.status === "checked_in"));
  if (held.length) fail(409, "room_busy", "The room has confirmed bookings.", { heldBookings: held.length });
  const removed = bookings.filter((b) => b.roomId === room.id).length;
  bookings = bookings.filter((b) => b.roomId !== room.id);
  rooms = rooms.filter((r) => r.id !== room.id);
  return { deleted: true, id: room.id, bookingsRemoved: removed };
}
function daySheet(room, date) {
  if (!validDate(date)) fail(422, "date_invalid", "A date is a real day written YYYY-MM-DD.");
  if (weekday(date) === 0) return { roomId: room.id, date, closed: true, bookings: [], bookedMinutes: 0, utilisationPct: 0, freeSlots: [] };
  const list = sortBookings(bookings.filter((b) => b.roomId === room.id && b.date === date && b.status !== "cancelled"));
  const booked = list.reduce((s, b) => s + b.minutes, 0);
  const free = [];
  let cursor = OPEN_MIN;
  for (const b of list) {
    const s = toMin(b.start);
    if (s - cursor >= 30) free.push({ start: toHHMM(cursor), end: toHHMM(s) });
    cursor = Math.max(cursor, s + b.minutes);
  }
  if (CLOSE_MIN - cursor >= 30) free.push({ start: toHHMM(cursor), end: toHHMM(CLOSE_MIN) });
  return {
    roomId: room.id,
    date,
    closed: false,
    bookings: list.map(viewBooking),
    bookedMinutes: booked,
    utilisationPct: Math.floor((booked * 1000) / (CLOSE_MIN - OPEN_MIN) + 0.5) / 10,
    freeSlots: free,
  };
}

// ---------- bookings ----------
function readBookingFields(body, current) {
  const merged = { ...(current || {}), ...body };
  if (merged.roomId === undefined || merged.roomId === null) fail(422, "room_required", "A booking needs a room.");
  if (!Number.isInteger(merged.roomId)) fail(422, "room_required", "A booking needs a room.");
  const room = rooms.find((r) => r.id === merged.roomId);
  if (!room) fail(404, "room_not_found", "No such room.", { id: merged.roomId });
  if (typeof merged.band !== "string" || merged.band.trim() === "") fail(422, "band_required", "A booking needs a band name.");
  const band = collapse(merged.band);
  if (band.length < 2 || band.length > 40) fail(422, "band_length", "A band name has 2 to 40 characters.", { min: 2, max: 40 });
  const players = merged.players === undefined ? 1 : merged.players;
  if (!Number.isInteger(players) || players < 1) fail(422, "players_invalid", "Players is a whole number from 1.");
  if (!validDate(merged.date)) fail(422, "date_invalid", "A date is a real day written YYYY-MM-DD.");
  if (typeof merged.start !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(merged.start) || toMin(merged.start) % 15 !== 0)
    fail(422, "start_invalid", "A start time is HH:MM on a quarter hour.");
  const minutes = merged.minutes;
  if (!Number.isInteger(minutes) || minutes < 30 || minutes > 240 || minutes % 15 !== 0)
    fail(422, "minutes_invalid", "A booking lasts 30 to 240 minutes in steps of 15.", { min: 30, max: 240, step: 15 });
  const s = toMin(merged.start);
  if (s < OPEN_MIN || s + minutes > CLOSE_MIN) fail(422, "outside_hours", "The studio is open from 08:00 to 23:00.", { opens: "08:00", closes: "23:00" });
  if (weekday(merged.date) === 0) fail(422, "closed_day", "The studio is closed on Sundays.");
  return { room, fields: { roomId: room.id, band, players, date: merged.date, start: merged.start, minutes } };
}
function checkConflicts(room, f, selfId) {
  if (!room.active) fail(409, "room_inactive", "The room takes no bookings.", { roomId: room.id });
  if (f.players > room.capacity) fail(409, "room_too_small", "Too many players for the room.", { capacity: room.capacity, players: f.players });
  const s = toMin(f.start);
  const e = s + f.minutes;
  const clash = sortBookings(
    bookings.filter(
      (b) =>
        b.id !== selfId &&
        b.roomId === room.id &&
        b.date === f.date &&
        ACTIVE.has(b.status) &&
        toMin(b.start) < e &&
        s < toMin(b.start) + b.minutes,
    ),
  )[0];
  if (clash) fail(409, "slot_taken", "The room is booked at that time.", { conflictId: clash.id });
  const same = bookings.filter((b) => b.id !== selfId && b.date === f.date && ACTIVE.has(b.status) && bandKey(b.band) === bandKey(f.band));
  if (same.length >= BAND_DAILY_LIMIT)
    fail(409, "band_daily_limit", "A band holds at most two bookings a day.", { limit: BAND_DAILY_LIMIT, existingIds: same.map((b) => b.id).sort((a, b) => a - b) });
}
function createBooking(body) {
  const { room, fields } = readBookingFields(body, null);
  checkConflicts(room, fields, null);
  const b = { id: nextBookingId++, uid: newUid("bk"), ...fields, status: "tentative", lockedCents: null, feeCents: 0, createdAt: new Date().toISOString() };
  bookings.push(b);
  return b;
}
function updateBooking(b, body) {
  if (body.status !== undefined) fail(422, "status_readonly", "Change the status with PUT /api/bookings/:id/status.");
  const allowed = {};
  for (const k of ["roomId", "band", "players", "date", "start", "minutes"]) if (body[k] !== undefined) allowed[k] = body[k];
  const { room, fields } = readBookingFields(allowed, b);
  if (b.status !== "tentative") fail(409, "booking_locked", "Only a tentative booking can change.", { status: b.status });
  checkConflicts(room, fields, b.id);
  Object.assign(b, fields);
  return b;
}
function setStatus(b, to) {
  if (!STATUSES.includes(to)) fail(422, "status_invalid", "Unknown status.", { allowed: STATUSES });
  const allowed = TRANSITIONS[b.status];
  if (!allowed.includes(to)) fail(409, "invalid_transition", "That status change is not allowed.", { from: b.status, to, allowed });
  if (to === "confirmed") {
    const room = roomOf(b);
    if (!room.active) fail(409, "room_inactive", "The room takes no bookings.", { roomId: room.id });
    b.lockedCents = bookingTotal(b);
  }
  if (to === "cancelled") b.feeCents = b.status === "confirmed" ? Math.floor(bookingTotal(b) / 2) : 0;
  b.status = to;
  return b;
}
function deleteBooking(b) {
  if (b.status !== "tentative" && b.status !== "cancelled") fail(409, "booking_locked", "Only a tentative or cancelled booking can be deleted.", { status: b.status });
  bookings = bookings.filter((x) => x.id !== b.id);
  return { deleted: true, id: b.id };
}
function listBookings(q) {
  let list = bookings;
  if (q.has("roomId")) {
    const id = Number(q.get("roomId"));
    if (!rooms.some((r) => r.id === id)) fail(404, "room_not_found", "No such room.", { id: Number.isInteger(id) ? id : null });
    list = list.filter((b) => b.roomId === id);
  }
  if (q.has("status")) {
    const s = q.get("status");
    if (!STATUSES.includes(s)) fail(422, "status_invalid", "Unknown status.", { allowed: STATUSES });
    list = list.filter((b) => b.status === s);
  }
  if (q.has("band")) {
    const t = collapse(q.get("band")).toLowerCase();
    list = list.filter((b) => b.band.toLowerCase().includes(t));
  }
  if (q.has("date")) list = list.filter((b) => b.date === q.get("date"));
  let limit = PAGE_DEFAULT;
  if (q.has("limit")) {
    limit = Number(q.get("limit"));
    if (!Number.isInteger(limit) || limit < 1) fail(422, "limit_invalid", "limit is a whole number from 1.", { max: PAGE_MAX });
    limit = Math.min(limit, PAGE_MAX);
  }
  let offset = 0;
  if (q.has("offset")) {
    offset = Number(q.get("offset"));
    if (!Number.isInteger(offset) || offset < 0) fail(422, "offset_invalid", "offset is a whole number from 0.");
  }
  const sorted = sortBookings(list);
  return { items: sorted.slice(offset, offset + limit).map(viewBooking), total: sorted.length, limit, offset };
}
function summary() {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const b of bookings) byStatus[b.status] += 1;
  let revenue = 0;
  for (const b of bookings) {
    if (b.status === "confirmed" || b.status === "checked_in" || b.status === "completed") revenue += bookingTotal(b);
    if (b.status === "cancelled") revenue += b.feeCents;
  }
  let busiest = null;
  for (const r of rooms.slice().sort((a, b) => a.id - b.id)) {
    const mins = bookings.filter((b) => b.roomId === r.id && b.status !== "cancelled").reduce((s, b) => s + b.minutes, 0);
    if (mins > 0 && (!busiest || mins > busiest.bookedMinutes)) busiest = { id: r.id, name: r.name, bookedMinutes: mins };
  }
  return {
    rooms: rooms.length,
    activeRooms: rooms.filter((r) => r.active).length,
    bookings: { ...byStatus, total: bookings.length },
    revenueCents: revenue,
    pipelineCents: bookings.filter((b) => b.status === "tentative").reduce((s, b) => s + bookingTotal(b), 0),
    busiestRoom: busiest,
  };
}
function exportAll() {
  const days = [];
  for (let d = 7; d <= 13; d += 1) days.push(`2026-12-${String(d).padStart(2, "0")}`);
  const grid = [];
  for (const r of sortedRooms()) {
    for (const date of days) {
      for (let m = OPEN_MIN; m < CLOSE_MIN; m += 15) {
        const holder = bookings.find(
          (b) => b.roomId === r.id && b.date === date && b.status !== "cancelled" && toMin(b.start) <= m && m < toMin(b.start) + b.minutes,
        );
        grid.push({ roomId: r.id, date, slot: toHHMM(m), state: weekday(date) === 0 ? "closed" : holder ? `booked:${holder.id}` : "free" });
      }
    }
  }
  return { product: "Brassnook", week: { from: days[0], to: days[6] }, rooms: sortedRooms().map(viewRoom), bookings: sortBookings(bookings).map(viewBooking), grid };
}

// ---------- http ----------
function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 65536) fail(413, "body_too_large", "The body is too large.");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    fail(400, "invalid_json", "The body is not JSON.");
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) fail(400, "invalid_json", "The body must be a JSON object.");
  return v;
}
function methods(req, allow) {
  if (!allow.includes(req.method)) fail(405, "method_not_allowed", "Method not allowed.", { allow });
}
function idParam(s) {
  return /^\d+$/.test(s) ? Number(s) : NaN;
}
function findRoom(id) {
  const r = rooms.find((x) => x.id === id);
  if (!r) fail(404, "room_not_found", "No such room.", { id: Number.isNaN(id) ? null : id });
  return r;
}
function findBooking(id) {
  const b = bookings.find((x) => x.id === id);
  if (!b) fail(404, "booking_not_found", "No such booking.", { id: Number.isNaN(id) ? null : id });
  return b;
}

async function api(req, res, url) {
  const p = url.pathname;
  let m;
  if (p === "/api/health") {
    methods(req, ["GET"]);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/summary") {
    methods(req, ["GET"]);
    return send(res, 200, summary());
  }
  if (p === "/api/export") {
    methods(req, ["GET"]);
    return send(res, 200, exportAll(), { "content-disposition": 'attachment; filename="brassnook-week.json"' });
  }
  if (p === "/api/rooms") {
    methods(req, ["GET", "POST"]);
    if (req.method === "GET") {
      const list = sortedRooms().map(viewRoom);
      return send(res, 200, { items: list, total: list.length });
    }
    return send(res, 201, viewRoom(createRoom(await readJson(req))));
  }
  if ((m = p.match(/^\/api\/rooms\/([^/]+)\/day$/))) {
    methods(req, ["GET"]);
    return send(res, 200, daySheet(findRoom(idParam(m[1])), url.searchParams.get("date")));
  }
  if ((m = p.match(/^\/api\/rooms\/([^/]+)$/))) {
    methods(req, ["GET", "PUT", "DELETE"]);
    const room = findRoom(idParam(m[1]));
    if (req.method === "GET") return send(res, 200, viewRoom(room));
    if (req.method === "PUT") return send(res, 200, viewRoom(updateRoom(room, await readJson(req))));
    return send(res, 200, deleteRoom(room));
  }
  if (p === "/api/bookings") {
    methods(req, ["GET", "POST"]);
    if (req.method === "GET") return send(res, 200, listBookings(url.searchParams));
    return send(res, 201, viewBooking(createBooking(await readJson(req))));
  }
  if ((m = p.match(/^\/api\/bookings\/([^/]+)\/status$/))) {
    methods(req, ["PUT"]);
    const b = findBooking(idParam(m[1]));
    const body = await readJson(req);
    return send(res, 200, viewBooking(setStatus(b, body.status)));
  }
  if ((m = p.match(/^\/api\/bookings\/([^/]+)$/))) {
    methods(req, ["GET", "PUT", "DELETE"]);
    const b = findBooking(idParam(m[1]));
    if (req.method === "GET") return send(res, 200, viewBooking(b));
    if (req.method === "PUT") return send(res, 200, viewBooking(updateBooking(b, await readJson(req))));
    return send(res, 200, deleteBooking(b));
  }
  fail(404, "not_found", "No such route.");
}

const PAGES = { "/": "rooms.html", "/room": "room.html", "/bookings": "bookings.html", "/booking": "booking.html", "/activity": "activity.html" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

async function serveFile(res, name) {
  const body = await readFile(new URL(name, PUBLIC));
  const ext = name.slice(name.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "content-length": body.length });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") fail(405, "method_not_allowed", "Method not allowed.", { allow: ["GET"] });
    if (PAGES[url.pathname]) return await serveFile(res, PAGES[url.pathname]);
    const asset = url.pathname.match(/^\/static\/([a-z]+\.(?:js|css))$/);
    if (asset) return await serveFile(res, asset[1]);
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Brassnook: not found</title><h1>Page not found</h1>");
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message, ...err.extra });
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "internal", message: "Something went wrong." });
  }
});

seed();
server.listen(PORT, HOST, async () => {
  if (process.env.BRASSNOOK_PID_FILE) await writeFile(process.env.BRASSNOOK_PID_FILE, `${process.pid}\n`);
  console.log(`Brassnook on http://${HOST}:${PORT}`);
});
const stop = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
