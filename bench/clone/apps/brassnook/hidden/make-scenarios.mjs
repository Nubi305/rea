#!/usr/bin/env node
// Writes heldout-api.json, heldout-pages.json, heldout-pages-portable.json and rules.json beside this file.
// Run: node make-scenarios.mjs
import { writeFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const T = 15000;
const get = (step_id, path) => ({ step_id, action: "request", method: "GET", path, timeout_ms: T });
const send = (step_id, method, path, json) => ({ step_id, action: "request", method, path, ...(json === undefined ? {} : { json }), timeout_ms: T });
const post = (id, path, json) => send(id, "POST", path, json);
const put = (id, path, json) => send(id, "PUT", path, json);
const del = (id, path) => send(id, "DELETE", path);
const bk = (o) => ({ roomId: 2, band: "Probe Band", players: 2, date: "2026-12-09", start: "10:00", minutes: 60, ...o });

const api = {
  start_path: "/",
  actions: [
    get("fp-rooms", "/api/rooms"),
    get("fp-bookings", "/api/bookings"),
    get("fp-summary", "/api/summary"),
    get("day-sheet-blue", "/api/rooms/1/day?date=2026-12-08"),
    get("day-sheet-sunday", "/api/rooms/1/day?date=2026-12-13"),
    get("day-sheet-bad-date", "/api/rooms/1/day?date=2026-02-29"),
    get("list-limit-clamped", "/api/bookings?limit=99"),
    get("list-limit-zero", "/api/bookings?limit=0"),
    get("list-page-two", "/api/bookings?limit=3&offset=3"),
    get("list-status-filter", "/api/bookings?status=cancelled"),
    get("list-status-bad", "/api/bookings?status=done"),
    get("list-band-filter", "/api/bookings?band=LOW"),
    get("list-room-missing", "/api/bookings?roomId=42"),
    post("room-create-normalised", "/api/rooms", { name: "  Écho   Chamber! ", capacity: 5, rateCents: 1250 }),
    post("room-name-taken-slug", "/api/rooms", { name: "blue-ROOM" }),
    post("room-name-taken-accent", "/api/rooms", { name: "CAFE stage" }),
    post("room-name-short", "/api/rooms", { name: " Ab " }),
    post("room-name-missing", "/api/rooms", {}),
    post("room-capacity-over", "/api/rooms", { name: "Loft", capacity: 13 }),
    post("room-rate-step", "/api/rooms", { name: "Loft", rateCents: 1275 }),
    post("room-create-defaults", "/api/rooms", { name: "Loft" }),
    get("rooms-order-after", "/api/rooms"),
    post("booking-create-normalised", "/api/bookings", { roomId: 6, band: "  north   Wind ", players: 3, date: "2026-12-08", start: "12:00", minutes: 45 }),
    post("booking-half-even-down", "/api/bookings", { roomId: 5, band: "Glass Harbour", players: 2, date: "2026-12-08", start: "12:00", minutes: 45 }),
    post("booking-evening-split", "/api/bookings", { roomId: 2, band: "Fen Lights", players: 4, date: "2026-12-08", start: "17:30", minutes: 60 }),
    post("booking-start-off-grid", "/api/bookings", bk({ start: "10:10" })),
    post("booking-start-format", "/api/bookings", bk({ start: "9:00" })),
    post("booking-minutes-short", "/api/bookings", bk({ minutes: 20 })),
    post("booking-minutes-step", "/api/bookings", bk({ minutes: 50 })),
    post("booking-too-late", "/api/bookings", bk({ start: "22:00", minutes: 90 })),
    post("booking-too-early", "/api/bookings", bk({ start: "07:45", minutes: 30 })),
    post("booking-last-slot", "/api/bookings", bk({ band: "Late Owls", start: "21:30", minutes: 90 })),
    post("booking-bad-date", "/api/bookings", bk({ date: "2026-02-29" })),
    post("booking-sunday", "/api/bookings", bk({ date: "2026-12-13" })),
    post("booking-players-zero", "/api/bookings", bk({ players: 0 })),
    post("booking-room-missing", "/api/bookings", bk({ roomId: 42, start: "nope" })),
    post("booking-band-short", "/api/bookings", bk({ band: "  X  " })),
    post("booking-inactive-room", "/api/bookings", bk({ roomId: 4, players: 5 })),
    post("booking-too-many-players", "/api/bookings", bk({ roomId: 1, players: 7, date: "2026-12-08", start: "18:30" })),
    post("booking-overlap", "/api/bookings", bk({ roomId: 1, band: "Moss", date: "2026-12-08", start: "19:30" })),
    post("booking-touching", "/api/bookings", bk({ roomId: 1, band: "Moss", date: "2026-12-08", start: "20:00" })),
    post("booking-cancelled-frees-slot", "/api/bookings", bk({ band: "Velvet Static", players: 4, date: "2026-12-10", start: "09:00", minutes: 45 })),
    post("band-second-booking", "/api/bookings", bk({ roomId: 5, band: " the  LOW tides", players: 3, date: "2026-12-08", start: "14:00" })),
    post("band-third-refused", "/api/bookings", bk({ band: "THE LOW TIDES", players: 3, date: "2026-12-08", start: "08:00" })),
    put("status-skip-refused", "/api/bookings/14/status", { status: "checked_in" }),
    put("status-unknown", "/api/bookings/14/status", { status: "done" }),
    put("status-cancel-tentative", "/api/bookings/14/status", { status: "cancelled" }),
    post("band-limit-after-cancel", "/api/bookings", bk({ band: "THE LOW TIDES", players: 3, date: "2026-12-08", start: "08:00" })),
    put("status-cancelled-final", "/api/bookings/14/status", { status: "confirmed" }),
    put("status-confirm", "/api/bookings/5/status", { status: "confirmed" }),
    put("room-rate-change", "/api/rooms/5", { rateCents: 2000 }),
    get("booking-repriced", "/api/bookings/9"),
    get("booking-price-locked", "/api/bookings/5"),
    put("booking-edit-confirmed", "/api/bookings/5", { minutes: 60 }),
    put("booking-edit-own-slot", "/api/bookings/9", { start: "12:15", minutes: 30 }),
    put("booking-edit-overlap", "/api/bookings/9", { start: "11:00" }),
    put("booking-edit-status-field", "/api/bookings/9", { status: "confirmed" }),
    del("booking-delete-confirmed", "/api/bookings/5"),
    put("status-cancel-confirmed", "/api/bookings/5/status", { status: "cancelled" }),
    get("summary-after-fee", "/api/summary"),
    del("booking-delete-cancelled", "/api/bookings/5"),
    get("day-sheet-atrium-after", "/api/rooms/5/day?date=2026-12-08"),
    put("status-check-in", "/api/bookings/1/status", { status: "checked_in" }),
    put("status-back-refused", "/api/bookings/1/status", { status: "confirmed" }),
    put("room-capacity-below-booking", "/api/rooms/1", { capacity: 4 }),
    put("room-rename-taken", "/api/rooms/2", { name: "ATRIUM" }),
    put("room-deactivate", "/api/rooms/2", { active: false }),
    put("confirm-in-inactive-room", "/api/bookings/10/status", { status: "confirmed" }),
    post("booking-in-deactivated-room", "/api/bookings", bk({ band: "Late Owls", date: "2026-12-11" })),
    del("room-delete-busy", "/api/rooms/1"),
    del("room-delete-cascade", "/api/rooms/6"),
    get("booking-gone-after-cascade", "/api/bookings/8"),
    post("room-name-free-again", "/api/rooms", { name: "Echo chamber" }),
    post("booking-id-not-reused", "/api/bookings", bk({ roomId: 3, band: "Tin Choir", players: 8, date: "2026-12-09", start: "08:00", minutes: 60 })),
    get("summary-final", "/api/summary"),
    get("bookings-final", "/api/bookings?limit=25"),
    get("rooms-final", "/api/rooms"),
  ],
};

const T2 = 15000;
const goto = (step_id, path) => ({ step_id, action: "goto", destination: { url: `{origin}${path}` }, wait_until: "load", timeout_ms: T2 });
const ready = (step_id) => ({ step_id, action: "wait_for", locator: { kind: "css", selector: "body[data-ready]" }, state: "visible", timeout_ms: T2 });
const fill = (step_id, name, value) => ({ step_id, action: "fill", locator: { kind: "role", role: "textbox", name }, value: { source: "literal", value }, timeout_ms: T2 });

const pages = {
  start_path: "/bookings",
  actions: [
    get("fp-rooms", "/api/rooms"),
    get("fp-bookings", "/api/bookings"),
    goto("setup-open-rooms", "/"),
    ready("page-rooms"),
    goto("setup-open-room", "/room?id=1"),
    ready("page-room-day"),
    goto("setup-open-room-sunday", "/room?id=3&date=2026-12-13"),
    ready("page-room-sunday"),
    goto("setup-open-booking", "/booking?id=1"),
    ready("page-booking-confirmed"),
    goto("setup-open-booking-cancelled", "/booking?id=7"),
    ready("page-booking-cancelled"),
    goto("setup-open-bookings", "/bookings?status=tentative"),
    ready("page-bookings-filtered"),
    goto("setup-open-booking-missing", "/booking?id=99"),
    ready("page-booking-missing"),
    goto("setup-open-room-form", "/room?id=5"),
    ready("setup-room-form-ready"),
    fill("setup-type-band", "Band", "  Quiet   Harbour "),
    fill("setup-type-players", "Players", "2"),
    fill("setup-type-start", "Start", "12:00"),
    fill("setup-type-minutes", "Minutes", "45"),
    {
      step_id: "page-request-booking",
      action: "click",
      locator: { kind: "role", role: "button", name: "Request booking" },
      save_response: { method: "POST", path: "/api/bookings", save: [{ name: "booking", json_pointer: "/id" }] },
      timeout_ms: T2,
    },
    { step_id: "page-request-notice", action: "wait_for", locator: { kind: "css", selector: "#notice:not(:empty)" }, state: "visible", timeout_ms: T2 },
    get("api-booking-created", "/api/bookings/8"),
    goto("setup-open-new-booking", "/booking?id=8"),
    ready("page-new-booking"),
    goto("setup-open-bookings-after", "/bookings?band=harbour"),
    ready("page-bookings-after"),
  ],
};

// heldout-pages.json waits on this application's own markup (body[data-ready], #notice), which a clean-room clone
// does not have: the wait fails there and no later step runs. heldout-pages-portable.json is the same scenario with
// each of those waits finding the element by what it shows on screen or by its role and name instead, chosen so that
// the wait does not depend on a value a rule decides: a clone that breaks a rule still gets past it, and the step
// after shows the difference. Nothing else changes, and rules.json replays the portable file.
const textIs = (text) => ({ kind: "css", selector: `text=${JSON.stringify(text)}` });
const textMatches = (pattern) => ({ kind: "css", selector: `text=/${pattern}/` });
const link = (name) => ({ kind: "role", role: "link", name });
const DAY_SHEET = String.raw`^\d+ minutes booked, \d+\.\d% of opening hours\.$`;
const LIST_COUNT = String.raw`^Showing \d+ to \d+ of \d+\.$`;
const PORTABLE_WAITS = {
  "page-rooms": textMatches(String.raw`^\d+ rooms\.$`),
  "page-room-day": textMatches(DAY_SHEET),
  "page-room-sunday": textIs("Café Stage"),
  "page-booking-confirmed": link("Blue Room"),
  "page-booking-cancelled": link("Blue Room"),
  "page-bookings-filtered": textMatches(LIST_COUNT),
  "page-booking-missing": textIs("Booking not found"),
  "setup-room-form-ready": textMatches(DAY_SHEET),
  "page-request-notice": textMatches("^Requested "),
  "page-new-booking": link("atrium"),
  "page-bookings-after": textMatches(LIST_COUNT),
};
const portablePages = {
  ...pages,
  actions: pages.actions.map((a) => (PORTABLE_WAITS[a.step_id] ? { ...a, locator: PORTABLE_WAITS[a.step_id] } : a)),
};
for (const a of portablePages.actions)
  if (a.locator?.kind === "css" && !a.locator.selector.startsWith("text=")) throw new Error(`${a.step_id} still waits on markup`);

// rule id -> [statement, difficulty, [[scenario, [steps]]...]]
const R = (id, difficulty, rule, cases) => ({ id, difficulty, rule, cases: cases.map(([scenario, step_ids]) => ({ scenario, step_ids })) });
const A = "heldout-api";
const P = "heldout-pages";
const SCENARIO_FILES = { [A]: "heldout-api.json", [P]: "heldout-pages-portable.json" };
const rules = [
  R("R01-room-name-slug", "visible", "A room name is trimmed with inner whitespace collapsed, and its slug is the name without accents, lower-cased, with every run of other characters turned into one dash and no dash at either end.", [[A, ["room-create-normalised", "room-create-defaults", "room-name-free-again"]]]),
  R("R02-room-name-unique", "edge", "Two rooms may not share a slug, so names that differ only in case, accents or punctuation collide: 409 name_taken with existingId, on create and on rename; a deleted room's name is free again.", [[A, ["room-name-taken-slug", "room-name-taken-accent", "room-rename-taken", "room-name-free-again"]]]),
  R("R03-room-fields", "edge", "A room name has 3 to 40 characters after collapsing (name_required when missing), capacity is a whole number 1 to 12 (default 4), rateCents 500 to 20000 in steps of 50 (default 1500), active defaults to true.", [[A, ["room-name-short", "room-name-missing", "room-capacity-over", "room-rate-step", "room-create-defaults"]]]),
  R("R04-room-order", "edge", "Rooms list active rooms first, then by capacity descending, then by name ignoring letter case.", [[A, ["fp-rooms", "rooms-order-after", "rooms-final"]], [P, ["page-rooms"]]]),
  R("R05-booking-record", "visible", "A new booking starts tentative, gets a reference BK- plus its id padded to four digits, and reports its end time and room name.", [[A, ["booking-create-normalised", "booking-last-slot"]], [P, ["page-request-booking", "api-booking-created"]]]),
  R("R06-band-normalised", "visible", "A band name is trimmed with inner whitespace collapsed and its case kept; it has 2 to 40 characters.", [[A, ["booking-create-normalised", "band-second-booking", "booking-band-short"]], [P, ["page-request-booking"]]]),
  R("R07-time-grid", "edge", "A start is HH:MM on a quarter hour (start_invalid otherwise) and a booking lasts 30 to 240 minutes in steps of 15 (minutes_invalid).", [[A, ["booking-start-off-grid", "booking-start-format", "booking-minutes-short", "booking-minutes-step"]]]),
  R("R08-opening-hours", "edge", "A booking must start at or after 08:00 and end at or before 23:00 (outside_hours); ending exactly at 23:00 is allowed.", [[A, ["booking-too-late", "booking-too-early", "booking-last-slot"]]]),
  R("R09-calendar", "edge", "A date must be a real calendar day written YYYY-MM-DD (date_invalid), and the studio is closed on Sundays (closed_day; the day sheet reports closed).", [[A, ["booking-bad-date", "booking-sunday", "day-sheet-sunday", "day-sheet-bad-date"]], [P, ["page-room-sunday"]]]),
  R("R10-price", "edge", "The price is the room's hourly rate pro rata, minutes from 18:00 on cost a quarter more, and the total is rounded to the cent with halves going to the even cent.", [[A, ["booking-create-normalised", "booking-half-even-down", "booking-evening-split", "booking-last-slot", "booking-touching", "booking-edit-own-slot"]], [P, ["page-request-booking", "api-booking-created", "page-new-booking", "page-bookings-after"]]]),
  R("R11-no-overlap", "multi-step", "Active bookings of one room may not overlap (409 slot_taken with conflictId); touching is allowed, cancelled bookings do not block, and an edit is not blocked by the booking's own slot.", [[A, ["booking-overlap", "booking-touching", "booking-cancelled-frees-slot", "booking-edit-own-slot", "booking-edit-overlap"]]]),
  R("R12-players", "edge", "Players is a whole number from 1 (players_invalid); more players than the room's capacity is 409 room_too_small.", [[A, ["booking-players-zero", "booking-too-many-players"]]]),
  R("R13-inactive-room", "multi-step", "A room that is not active refuses new bookings and confirmations with 409 room_inactive.", [[A, ["booking-inactive-room", "room-deactivate", "confirm-in-inactive-room", "booking-in-deactivated-room"]]]),
  R("R14-band-daily-limit", "multi-step", "A band, compared without case and with whitespace collapsed, holds at most two active bookings on one date across all rooms (409 band_daily_limit with existingIds); a cancelled booking frees its place.", [[A, ["band-second-booking", "band-third-refused", "band-limit-after-cancel"]]]),
  R("R15-check-order", "edge", "Checks run in the order: room exists (404), fields (422), then room inactive, room too small, slot taken, band limit (409).", [[A, ["booking-room-missing", "booking-inactive-room", "booking-too-many-players"]]]),
  R("R16-state-machine", "multi-step", "Status moves tentative to confirmed or cancelled, confirmed to checked_in or cancelled, checked_in to completed, and never out of completed or cancelled; other moves are 409 invalid_transition with from, to and allowed, an unknown status is 422 status_invalid, and an edit cannot set the status.", [[A, ["status-skip-refused", "status-unknown", "status-cancel-tentative", "status-cancelled-final", "status-confirm", "status-check-in", "status-back-refused", "booking-edit-status-field"]]]),
  R("R17-price-locked", "multi-step", "A tentative booking's price follows its room's current rate; confirming captures the price, so a later rate change leaves confirmed bookings as they were.", [[A, ["status-confirm", "room-rate-change", "booking-repriced", "booking-price-locked"]]]),
  R("R18-cancellation-fee", "multi-step", "Cancelling a confirmed booking charges half its price rounded down to the cent as feeCents; cancelling a tentative booking charges nothing.", [[A, ["status-cancel-tentative", "status-cancel-confirmed", "summary-after-fee", "fp-bookings"]], [P, ["page-booking-cancelled"]]]),
  R("R19-booking-lock", "multi-step", "Only a tentative booking can be edited and only a tentative or cancelled booking deleted; otherwise 409 booking_locked with its status.", [[A, ["booking-edit-confirmed", "booking-delete-confirmed", "booking-delete-cancelled"]]]),
  R("R20-capacity-floor", "multi-step", "A room's capacity cannot drop below the players of its largest active booking (409 capacity_below_booking).", [[A, ["room-capacity-below-booking"]]]),
  R("R21-room-delete", "multi-step", "A room holding confirmed or checked-in bookings cannot be deleted (409 room_busy); otherwise it is deleted with all its bookings, the reply counts them, and ids are never reused.", [[A, ["room-delete-busy", "room-delete-cascade", "booking-gone-after-cascade", "room-name-free-again", "booking-id-not-reused"]]]),
  R("R22-booking-order-paging", "edge", "Bookings list by date, then start, then room name ignoring case, then id; limit defaults to 10, is clamped to 25, must be at least 1, and replies carry total, limit and offset.", [[A, ["fp-bookings", "list-limit-clamped", "list-limit-zero", "list-page-two", "bookings-final"]], [P, ["page-bookings-filtered"]]]),
  R("R23-list-filters", "edge", "status filters exactly and refuses an unknown value, band matches a substring without case, and an unknown roomId is 404.", [[A, ["list-status-filter", "list-status-bad", "list-band-filter", "list-room-missing"]], [P, ["page-bookings-after"]]]),
  R("R24-day-sheet", "multi-step", "A room's day sheet lists its non-cancelled bookings in time order, the booked minutes, utilisation of the 900 opening minutes to one decimal, and the free gaps of at least 30 minutes.", [[A, ["day-sheet-blue", "day-sheet-atrium-after"]], [P, ["page-room-day"]]]),
  R("R25-summary", "multi-step", "The summary counts rooms, active rooms and bookings per status; revenue is the price of confirmed, checked-in and completed bookings plus cancellation fees; the pipeline is the price of tentative bookings; the busiest room has the most non-cancelled minutes.", [[A, ["fp-summary", "summary-after-fee", "summary-final"]]]),
  R("R26-pages", "visible", "The pages show prices as pounds from pence, statuses in words, only the status buttons the state machine allows, and a not-found message for an unknown booking.", [[P, ["page-booking-confirmed", "page-booking-cancelled", "page-booking-missing", "page-new-booking"]]]),
];

writeFileSync(new URL("heldout-api.json", here), JSON.stringify(api, null, 2) + "\n");
writeFileSync(new URL("heldout-pages.json", here), JSON.stringify(pages, null, 2) + "\n");
writeFileSync(new URL("heldout-pages-portable.json", here), JSON.stringify(portablePages, null, 2) + "\n");
writeFileSync(new URL("rules.json", here), JSON.stringify({ application: "Brassnook", scenarios: SCENARIO_FILES, rules }, null, 2) + "\n");
// A page's on-screen text is listed at the first step that shows a difference, often the goto before the
// wait: every cited page-* wait step also cites the goto step in front of it.
for (const r of rules)
  for (const c of r.cases) {
    if (c.scenario !== P) continue;
    const out = [];
    for (const s of c.step_ids) {
      const i = pages.actions.findIndex((a) => a.step_id === s);
      const prev = pages.actions[i - 1];
      if (pages.actions[i].action === "wait_for" && prev && prev.action === "goto" && !out.includes(prev.step_id)) out.push(prev.step_id);
      if (!out.includes(s)) out.push(s);
    }
    c.step_ids = out;
  }
writeFileSync(new URL("rules.json", here), JSON.stringify({ application: "Brassnook", scenarios: SCENARIO_FILES, rules }, null, 2) + "\n");
const ids = { [A]: new Set(api.actions.map((a) => a.step_id)), [P]: new Set(pages.actions.map((a) => a.step_id)) };
for (const r of rules) for (const c of r.cases) for (const s of c.step_ids) if (!ids[c.scenario].has(s)) throw new Error(`${r.id}: unknown step ${c.scenario}/${s}`);
console.log(`${api.actions.length} api steps, ${pages.actions.length} page steps, ${rules.length} rules`);
