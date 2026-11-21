# Brassnook: what the cloning agent is not told

Brassnook books the rooms of a rehearsal studio. A room has a size and an hourly rate; a band books a room for a
date, a start and a length, and the booking moves through a small life cycle.
Source: `original/` beside this folder (`server.mjs`, `public/`). Control: `ctl.sh start|stop|reset|health`
(`PORT` selects the port, default 5340). The directory is relocatable: `ctl.sh` finds `server.mjs` beside itself and
keeps its pid file and log in `.run/` there. Restarting is the reset: all data is in memory, rebuilt from the seed.

Files here:

- `heldout-api.json`: 77 steps, all `request` steps, start page `/` (the rooms page).
- `heldout-pages.json`: 29 steps: two fingerprint requests, eight pages (each a `goto` then a `wait_for` on
  `body[data-ready]`), one form submit that waits for its reply, one request, two pages after it.
- `heldout-differences.json`: the 46 volatile fields (`uid`, `createdAt`) of the two scenarios, no renames. Add the
  rename from `Brassnook` to the clone's name before comparing a clone, or the on-screen text of every step differs.
- `rules.json`: the 26 rules, each with one sentence, its difficulty and the steps that show it.
- `expected-heldout-api.txt`, `expected-heldout-pages-requests.txt`: each request step with the original's status and
  body, replayed by `replay.mjs` with `fetch` from a clean start. `uid` and `createdAt` of records created during the
  run differ on every run; everything else is the same after every restart (two replays compared equal with those
  two fields masked).
- `make-scenarios.mjs`: writes the two scenarios, `heldout-pages-portable.json` and `rules.json` (and checks that
  every cited step exists).
- `heldout-pages-portable.json`: `heldout-pages.json` with its eleven markup-bound waits replaced; `rules.json` replays
  it (see "In the benchmark" below).
- `selftest-mutant.json`: the R10 mutant below, as one replacement in `server.mjs`.

## In the benchmark

This folder is the author's `hidden/` with these changes, made when the application was brought into
`bench/clone/apps/brassnook`:

- `heldout-pages.json` waits on this application's markup (`body[data-ready]` ten times, `#notice:not(:empty)` once).
  A clean-room clone does not have that markup, the wait fails there, and no later step runs. `make-scenarios.mjs` now
  also writes `heldout-pages-portable.json`, the same scenario with each of those waits finding the element by what
  it shows or by its role and name (`text=/^\d+ rooms\.$/`, the link of the booking's room, and so on), chosen so
  that the wait does not depend on a value a rule decides. `rules.json` names that file for `heldout-pages`.
- `GET /api/summary` no longer sends `Cache-Control: no-store`. With it, the capture lost that reply's body at random
  (`summary-after-fee`, `summary-final` or `fp-summary` came out `unknown` on two unmodified instances), which left
  R18 and R25 undecided; the layout in `bench/clone/README.md` excludes `no-store` for that reason.
- `proof/` (the author's capture and compare scripts, which pointed at the author's scratch folder, and their
  comparison results) was not brought in. `node bench/harness/clone-check-app.mjs --app brassnook` repeats the proof
  below, and `--mutant` repeats the R10 mutant.

## Shape of the application

Pages, all built in the browser by `/static/app.js` after it fetches the JSON API (the HTML holds only a
"Loading…" placeholder; when the page is built, `body` gets `data-ready="1"`):

| Page              | Shows                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| `/`               | rooms table, "Add a room" form                                                     |
| `/room?id=N[&date=YYYY-MM-DD]` | room facts, the day sheet (default 2026-12-08), "Book this room" form, "Room settings" form |
| `/bookings[?status=&band=&offset=]` | filter form, bookings table, "Showing a to b of n", Previous/Next page links |
| `/booking?id=N`   | booking facts, the status buttons allowed now, the share link                      |
| `/activity`       | summary counts, "Last updated" clock, link to the export                           |

API (JSON; errors are `{"error": "<code>", "message": "...", ...details}`; creates answer 201, other successes 200):

| Route                                   | Methods                       |
| --------------------------------------- | ----------------------------- |
| `/api/rooms`                            | GET, POST                     |
| `/api/rooms/:id`                        | GET, PUT, DELETE              |
| `/api/rooms/:id/day?date=YYYY-MM-DD`    | GET                           |
| `/api/bookings[?roomId&status&band&date&limit&offset]` | GET, POST      |
| `/api/bookings/:id`                     | GET, PUT, DELETE              |
| `/api/bookings/:id/status`              | PUT `{status}`                |
| `/api/summary`, `/api/export`, `/api/health`            | GET           |

Room: `{id, uid, name, slug, capacity, rateCents, active, openBookings, createdAt}` (`openBookings` counts tentative,
confirmed and checked-in bookings). Booking: `{id, uid, ref, roomId, roomName, band, players, date, start, end, minutes,
status, totalCents, feeCents, createdAt}`. Booking lists are `{items, total, limit, offset}`; the room list is
`{items, total}`. Other errors: unknown route 404 `not_found`; wrong method 405 `method_not_allowed` with `allow`; a
body that is not a JSON object 400 `invalid_json`; unknown ids 404 `room_not_found` / `booking_not_found` with `id`.

Seed (ids fixed; first created room gets id 6, first created booking id 8). Rooms: 1 `Blue Room` 6 players 1500/h
active; 2 `Annexe` 4, 1250; 3 `Café Stage` 10, 2400; 4 `Drum Booth` 2, 900, **inactive**; 5 `atrium` (lower case)
6, 1350. Bookings: 1 Blue The Low Tides 5p 2026-12-08 18:00 120 min confirmed (price locked 3750); 2 Blue Marrow
Quartet 4p 12-08 10:00 90 tentative; 3 Café Saltmarsh Choir 10p 12-09 19:00 120 checked_in (6000); 4 Annexe Kiln 3p
12-08 14:00 60 completed (1250); 5 atrium Paper Lanterns 2p 12-08 10:00 90 tentative; 6 Annexe Velvet Static 4p
12-10 09:00 45 cancelled while tentative (fee 0); 7 Blue Opal Fern 3p 12-11 08:00 60 cancelled while confirmed
(price 1500, fee 750). 2026-12-07 is a Monday; 2026-12-13 is a Sunday.

## The mess, each piece once (a scorer must account for it)

| Mess | Where | Effect on comparison |
| --- | --- | --- |
| A clock | `/activity`: "Last updated HH:MM:SS" from the browser's clock | on-screen text differs on every load; cannot be declared |
| A cache-busting query | `/activity` fetches `/api/summary?_=<Date.now()>` | the request line differs on every load |
| A share link with the application's own address | `/booking?id=N`: "Share this booking: http://host:port/booking?id=N" from `location.origin` | none: REA reads the left side's address as the right's (12 values rewritten in the pages proof) |
| ~~`Cache-Control: no-store`~~ | removed in the benchmark copy (see above) | |
| An export over 64 KiB | `GET /api/export` (191,273 bytes from a clean start; `content-disposition: attachment`) | a capture never records a body over 64 KiB, so a step on it is `unknown`; the held-out scenarios do not touch it |
| A generated id and a server timestamp | `uid` (`rm_`/`bk_` + 8 random hex) and `createdAt` (ISO time) of every record created after the start; seed records have fixed values | declared in `heldout-differences.json`, step by step |

The held-out scenarios therefore never visit `/activity` and never request `/api/export`. Observed: an earlier draft
of `heldout-api.json` started on `/activity`; with two clean captures per side every one of its 78 steps came out
`unstable` (`repeats-differ` on the on-screen text of every step and on the `GET /api/summary?_=…` request line at
`scenario_start`), see `proof/cmp-mess-activity-start.json`. The start page is now `/`.

## The rules

Step names refer to `heldout-api.json` unless marked (pages). `rules.json` holds the same list in machine form.

### Visible in normal use

**R01 room-name-slug.** A room name is trimmed and inner whitespace collapsed; the slug is the name with accents
removed, lower-cased, every run of other characters turned into one `-`, no dash at either end.

- `room-create-normalised`: `POST /api/rooms {"name":"  Écho   Chamber! ","capacity":5,"rateCents":1250}` gives 201
  `"id":6,"name":"Écho Chamber!","slug":"echo-chamber"`.
- `room-name-free-again`: `{"name":"Echo chamber"}` gives 201 `"id":8,"slug":"echo-chamber"`.

**R05 booking-record.** A new booking is `tentative`, its `ref` is `BK-` plus the id padded to four digits, `end` is
start plus minutes, `roomName` is the room's name.

- `booking-create-normalised`: `POST /api/bookings {"roomId":6,"band":"  north   Wind ","players":3,"date":"2026-12-08",
  "start":"12:00","minutes":45}` gives 201 `"id":8,"ref":"BK-0008","roomName":"Écho Chamber!","band":"north Wind",
  "end":"12:45","status":"tentative","totalCents":938`.
- Pages `page-request-booking`: the "Book this room" form on `/room?id=5` (band `"  Quiet   Harbour "`, 2 players,
  12:00, 45 minutes) answers 201 BK-0008 and shows `Requested BK-0008 for £10.12.`

**R06 band-normalised.** A band name is trimmed, inner whitespace collapsed, case kept; 2 to 40 characters.

- `band-second-booking`: `" the  LOW tides"` is stored as `"the LOW tides"`.
- `booking-band-short`: `"  X  "` gives 422 `{"error":"band_length",...,"min":2,"max":40}`.

**R26 pages.** Money is pounds from pence (`£37.50`), statuses in words (`Checked in`), only the buttons the state
machine allows (`Confirm booking`, `Check in`, `Mark completed`, `Cancel booking`; "No further changes." when none), a
cancelled booking shows `Cancellation fee`, and `/booking?id=99` shows "Booking not found". (pages:
`page-booking-confirmed`: BK-0001 offers `Check in` and `Cancel booking`; `page-booking-cancelled`: BK-0007 shows fee
£7.50 and no buttons; `page-booking-missing`; `page-new-booking`.)

### Needs an edge probe

**R02 room-name-unique.** Two rooms may not share a slug, so names differing only in case, accents or punctuation
collide: 409 `name_taken` with `existingId`, on create and on rename. A deleted room's name is free again.

- `room-name-taken-slug`: `{"name":"blue-ROOM"}` gives 409 `"existingId":1`.
- `room-name-taken-accent`: `{"name":"CAFE stage"}` gives 409 `"existingId":3`.
- `room-rename-taken`: `PUT /api/rooms/2 {"name":"ATRIUM"}` gives 409 `"existingId":5`.

**R03 room-fields.** Name 3 to 40 characters after collapsing (422 `name_length` `min 3 max 40`; missing:
`name_required`); capacity a whole number 1 to 12, default 4 (`capacity_invalid`); `rateCents` 500 to 20000 in steps of
50, default 1500 (`rate_invalid` with `step 50`); `active` defaults to true.

- `room-name-short` (`" Ab "`), `room-name-missing` (`{}`), `room-capacity-over` (13), `room-rate-step` (1275).
- `room-create-defaults`: `{"name":"Loft"}` gives 201 `"id":7,"capacity":4,"rateCents":1500,"active":true`.

**R04 room-order.** Active rooms first, then capacity descending, then name ignoring case.

- `fp-rooms`: 3 Café Stage, 5 atrium, 1 Blue Room, 2 Annexe, 4 Drum Booth. A case-sensitive sort puts `Blue Room`
  before `atrium`.
- `rooms-order-after`: Café Stage, atrium, Blue Room, Écho Chamber!, Annexe, Loft, Drum Booth.

**R07 time-grid.** `start` is `HH:MM` on a quarter hour, else 422 `start_invalid`; `minutes` 30 to 240 in steps of 15,
else 422 `minutes_invalid` with `min`, `max`, `step`.

- `booking-start-off-grid` (`10:10`), `booking-start-format` (`9:00`), `booking-minutes-short` (20),
  `booking-minutes-step` (50).

**R08 opening-hours.** Start at or after 08:00 and end at or before 23:00, else 422 `outside_hours`
`{"opens":"08:00","closes":"23:00"}`.

- `booking-too-late` (22:00 for 90), `booking-too-early` (07:45). `booking-last-slot`: 21:30 for 90 ends 23:00, 201.

**R09 calendar.** A date is a real day written `YYYY-MM-DD` (422 `date_invalid`); Sundays are closed (422
`closed_day`; the day sheet answers `"closed":true` with nothing in it).

- `booking-bad-date` and `day-sheet-bad-date` (2026-02-29), `booking-sunday` (2026-12-13), `day-sheet-sunday`.
- Pages `page-room-sunday`: "Closed on Sundays."

**R10 price.** Rate pro rata by the minute; minutes from 18:00 on cost a quarter more; the total is rounded to the cent
with an exact half going to the even cent. In integers: `round_half_even(rate × (dayMinutes×4 + eveningMinutes×5) / 240)`.

- `booking-create-normalised`: 1250 × 45 min = 937.5 → 938.
- `booking-half-even-down`: atrium 1350 × 45 min = 1012.5 → **1012** (half up would give 1013).
- `booking-evening-split`: Annexe 17:30 for 60: 1250 × 270 / 240 = 1406.25 → 1406.
- `booking-last-slot`: 1250 × 450 / 240 = 2343.75 → 2344. `booking-touching`: 1500 × 300 / 240 = 1875.
- Pages: the requested booking costs £10.12 (`page-request-booking`, `api-booking-created`, `page-new-booking`,
  `page-bookings-after`).

**R12 players.** `players` is a whole number from 1 (422 `players_invalid`); more than the room's capacity is 409
`room_too_small` `{"capacity":6,"players":7}` (`booking-players-zero`, `booking-too-many-players`).

**R15 check-order.** Room exists (404) before field checks (422) before conflicts (409) in the order room inactive, room
too small, slot taken, band limit.

- `booking-room-missing`: room 42 with start `"nope"` gives 404 `{"error":"room_not_found",...,"id":42}`.
- `booking-inactive-room`: Drum Booth with 5 players (capacity 2) gives `room_inactive`, not `room_too_small`.
- `booking-too-many-players`: Blue Room 18:30 overlaps booking 1 but answers `room_too_small`.

**R22 booking-order-paging.** Bookings list by date, start, room name ignoring case, then id. `limit` defaults to 10, is
clamped to 25, must be a whole number from 1 (422 `limit_invalid` `{"max":25}`); replies carry `total`, `limit`,
`offset`.

- `fp-bookings`: ids 5, 2, 4, 1, 3, 6, 7: booking 5 (atrium) before 2 (Blue Room) at the same 10:00.
- `list-limit-clamped` (`limit=99`): `"limit":25`. `list-limit-zero`: 422. `list-page-two` (`limit=3&offset=3`):
  ids 1, 3, 6, `"total":7`.
- `bookings-final`: 15, 2, 9, 4, 14, 10, 1, 12, 16, 3, 11, 6, 13, 7 (Annexe before atrium at 14:00; 6 before 13 at the
  same room and time).

**R23 list-filters.** `status` filters exactly and refuses an unknown value (422 `status_invalid` with `allowed`);
`band` matches a substring without case; an unknown `roomId` is 404 `room_not_found`.

- `list-status-filter` (cancelled: 6, 7), `list-status-bad` (`done`), `list-band-filter` (`LOW`: 1),
  `list-room-missing` (42). Pages `page-bookings-after` (`band=harbour`: BK-0008).

### Needs several steps

**R11 no-overlap.** Bookings that are tentative, confirmed or checked in may not overlap in one room: 409 `slot_taken`
with `conflictId` (the earliest overlapping booking). Touching is allowed, cancelled and completed bookings do not
block, and an edit is not blocked by the booking's own slot.

- `booking-overlap`: Blue 12-08 19:30 gives 409 `"conflictId":1`. `booking-touching`: 20:00 gives 201 id 12.
- `booking-cancelled-frees-slot`: Annexe 12-10 09:00 (booking 6 is cancelled) gives 201 id 13.
- `booking-edit-own-slot`: `PUT /api/bookings/9 {"start":"12:15","minutes":30}` gives 200.
- `booking-edit-overlap`: `PUT /api/bookings/9 {"start":"11:00"}` gives 409 `"conflictId":5`.

**R13 inactive-room.** An inactive room refuses new bookings and confirmations: 409 `room_inactive` `{"roomId":N}`.

- `booking-inactive-room` (Drum Booth); `room-deactivate` (`PUT /api/rooms/2 {"active":false}`, 200) then
  `confirm-in-inactive-room` (booking 10) and `booking-in-deactivated-room` both 409.

**R14 band-daily-limit.** One band, compared without case and with whitespace collapsed, holds at most two active
bookings on one date across all rooms: 409 `band_daily_limit` `{"limit":2,"existingIds":[...]}`; cancelling frees a
place.

- `band-second-booking`: `" the  LOW tides"` on 12-08 (atrium) gives 201 id 14 (booking 1 is The Low Tides).
- `band-third-refused`: `"THE LOW TIDES"` on 12-08 (Annexe 08:00) gives 409 `"existingIds":[1,14]`.
- `status-cancel-tentative` cancels 14; `band-limit-after-cancel`: the same request gives 201 id 15.

**R16 state-machine.** `PUT /api/bookings/:id/status`: tentative → confirmed | cancelled; confirmed → checked_in |
cancelled; checked_in → completed; completed and cancelled are final. Other moves: 409 `invalid_transition` with
`from`, `to`, `allowed`; an unknown status 422 `status_invalid`; a `status` in `PUT /api/bookings/:id` is 422
`status_readonly`.

- `status-skip-refused` (14 tentative → checked_in: `"allowed":["confirmed","cancelled"]`), `status-unknown`,
  `status-cancelled-final` (`"allowed":[]`), `status-confirm` (5), `status-check-in` (1), `status-back-refused`
  (checked_in → confirmed: `"allowed":["completed"]`), `booking-edit-status-field`.

**R17 price-locked.** A tentative booking's price follows its room's current rate; confirming captures the price.

- `status-confirm` (booking 5, 2025), `room-rate-change` (`PUT /api/rooms/5 {"rateCents":2000}`),
  `booking-repriced` (tentative booking 9 now 1500), `booking-price-locked` (booking 5 still 2025).

**R18 cancellation-fee.** Cancelling a confirmed booking sets `feeCents` to half its price rounded down; cancelling a
tentative one charges 0. Fees count as revenue.

- `status-cancel-tentative`: `"feeCents":0`. `status-cancel-confirmed` (booking 5, 2025): `"feeCents":1012`.
- `summary-after-fee`: `"revenueCents":12762` (11750 + 1012). Seed booking 7 carries fee 750.

**R19 booking-lock.** Only a tentative booking can be edited, only a tentative or cancelled one deleted; otherwise 409
`booking_locked` `{"status":...}`. Field checks come before the lock.

- `booking-edit-confirmed` (`PUT /api/bookings/5 {"minutes":60}`), `booking-delete-confirmed`: 409, `"status":"confirmed"`.
- `booking-delete-cancelled`: `DELETE /api/bookings/5` after cancelling gives 200 `{"deleted":true,"id":5}`.

**R20 capacity-floor.** A room's capacity cannot drop below the players of its largest active booking.

- `room-capacity-below-booking`: `PUT /api/rooms/1 {"capacity":4}` gives 409
  `{"error":"capacity_below_booking",...,"capacity":4,"largestBooking":5}`.

**R21 room-delete.** A room holding confirmed or checked-in bookings cannot be deleted (409 `room_busy`
`{"heldBookings":N}`); otherwise it goes with all its bookings and the reply counts them. Ids are never reused.

- `room-delete-busy`: room 1 gives 409 `"heldBookings":1`. `room-delete-cascade`: room 6 gives 200
  `{"deleted":true,"id":6,"bookingsRemoved":1}`; `booking-gone-after-cascade`: booking 8 is 404.
- `room-name-free-again`: the next room is id 8; `booking-id-not-reused`: the next booking is id 16.

**R24 day-sheet.** `GET /api/rooms/:id/day?date=` lists the room's non-cancelled bookings of that date in time order,
`bookedMinutes`, `utilisationPct` (booked minutes of the 900 opening minutes, one decimal), and `freeSlots`: the gaps of
at least 30 minutes between 08:00 and 23:00.

- `day-sheet-blue`: bookings 2, 1; `"bookedMinutes":210,"utilisationPct":23.3`; free 08:00–10:00, 11:30–18:00,
  20:00–23:00.
- `day-sheet-atrium-after`: booking 9 only, 30 minutes, 3.3; free 08:00–12:15, 12:45–23:00.

**R25 summary.** `GET /api/summary`: `rooms`, `activeRooms`, bookings per status and `total`; `revenueCents` = prices of
confirmed, checked-in and completed bookings plus every cancellation fee; `pipelineCents` = prices of tentative
bookings; `busiestRoom` = the room with the most non-cancelled booked minutes (lower id on a tie; no tie is shown).

- `fp-summary`: `{"rooms":5,"activeRooms":4,"bookings":{"tentative":2,"confirmed":1,"checked_in":1,"completed":1,
  "cancelled":2,"total":7},"revenueCents":11750,"pipelineCents":4275,"busiestRoom":{"id":1,"name":"Blue Room",
  "bookedMinutes":210}}`.
- `summary-after-fee` (above) and `summary-final`: `"rooms":7,"activeRooms":5`, 14 bookings, `"revenueCents":11750,
  "pipelineCents":13463`, busiest Annexe 315.

## Checked outside the scenarios

From a clean start on port 5340 with `curl`: `PATCH /api/rooms/1` gives 405 with `"allow":["GET","PUT","DELETE"]`;
`POST /api/rooms` with body `{bad` gives 400 `invalid_json`; `GET /api/nope` gives 404 `not_found`; a booking with
`"roomId":"2"` gives 422 `room_required`; `GET /api/export` is 191,273 bytes with `content-disposition: attachment`;
`GET /api/summary` carried `cache-control: no-store` (removed since). `ctl.sh start` on a port another process holds prints "refusing
to start: port 5343 is taken by another process" and exits 1; `stop` then `health` exits 1; a second `stop` reports the
port free.

## The held-out scenarios, proven

Two copies of `original/` served as "original" (port 5341) and "clone" (port 5342). A run folder from
`rea init-clone-run` (REA at 0e089b3) rendered the capture inputs; each scenario was captured twice per side with
`capture-browser-scenario`, each capture after `ctl.sh reset` (`proof/capture.sh`), then compared with
`rea compare-scenario-behavior --left ×2 --right ×2 --detail complete --exit-code` (`proof/cmp.sh`):

- Without declarations: `heldout-api` exit 2, 78 steps (77 and `scenario_start`), 59 `unchanged`, 19 `unstable`;
  `heldout-pages` exit 2, 30 steps, 26 `unchanged`, 4 `unstable`. Every finding is `undeclared-volatile` at `uid` and
  `createdAt` (also under `/items/*/` and `/bookings/*/`). `proof/cmp-nodecl-*.json`.
- With `--differences heldout-differences.json --scenario <id>`: both exit 0, verdict `unchanged`, 78 of 78 and 30 of
  30 steps `unchanged`, no limitations. `proof/cmp-decl-*.json`. The pages comparison rewrote the original's address
  in 12 values (the share link).
- Every `goto` step's on-screen text already held the built page (no capture recorded "Loading…"), so the goto steps
  are steady; `rules.json` cites each goto together with the `wait_for` after it, because REA lists an on-screen text
  difference only at the first step that shows it.

Rule broken in a copy, compared against the same original captures:

- R10 (halves rounded up instead of to even): `heldout-api` exit 1, only `booking-half-even-down` `changed`
  (`/totalCents` 1012 → 1013); `heldout-pages` exit 1, `page-request-booking`, `api-booking-created`,
  `setup-open-new-booking` and `setup-open-bookings-after` `changed` (text £10.12 → £10.13 and `/totalCents`).
  All are R10 steps in `rules.json`. `proof/cmp-mutR10-*.json`.
- R14 (band names compared with case): `heldout-api` exit 1, `band-third-refused` (409 → 201) and
  `band-limit-after-cancel` (201 → 409 `slot_taken`, because the first created the booking) `changed`, nothing else;
  `heldout-pages` unchanged. Both are R14 steps. `proof/cmp-mutR14-*.json`.

Not every step of a rule catches every way of breaking it (937.5 rounds to 938 both half-up and half-even), so a
scorer should call a rule broken when any of its steps is `changed`, and agreed when all are `unchanged`.
