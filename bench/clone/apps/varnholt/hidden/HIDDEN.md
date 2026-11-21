# Varnholt: what the cloning agent is not told

Varnholt is a dispatch desk for a small courier. A manifest is one van load; parcels are booked onto a manifest.
Source: `/home/user/rea-trial/original` (`server.mjs`, `public/`). Control: `ctl.sh start|stop|reset|health`
(`PORT` selects the port, default 4701). Restarting is the reset: all data is in memory and rebuilt from the seed.

Files here:

- `heldout-rules.json`: 59 steps, all `request` steps, start page `/about`. Exercises every rule below.
- `heldout-pages.json`: 18 steps. Pages at the clean start, one form submit, then pages after API writes.
- `heldout-differences.json`: the 40 volatile fields (`uid`, `createdAt`) of the two scenarios, no renames. Add the
  rename from `Varnholt` to the clone's name before comparing a clone, or the on-screen text of every step differs.
- `expected-heldout-rules.txt`, `expected-heldout-pages-requests.txt`: each request step of the two scenarios with
  the original's status and body, replayed with `fetch` from a clean start. `uid` and `createdAt` of records created
  during the run differ on every run; everything else is the same after every restart.

Every expected answer below was produced by the running application (the two `expected-*.txt` files, or the extra
requests listed under "Checked outside the scenarios").

## Shape of the application

Pages: `/` (manifests board), `/manifest?id=N`, `/parcel?id=N`, `/summary`, `/about`. Each page's first render uses
data the server embeds in the HTML (`<script id="boot" type="application/json">`), so loading a page makes no API
request. Forms and buttons call the JSON API with `fetch`; after a successful write the board and the manifest page
fetch their data again.

API (all JSON, errors are `{"error": "<code>", "message": "...", ...details}`):

| Route                           | Methods          |
| ------------------------------- | ---------------- |
| `/api/manifests`                | GET, POST        |
| `/api/manifests/:id`            | GET, PUT, DELETE |
| `/api/manifests/:id/status`     | PUT `{status}`   |
| `/api/parcels[?manifestId=N]`   | GET, POST        |
| `/api/parcels/:id`              | GET, PUT, DELETE |
| `/api/summary`, `/api/health`   | GET              |

Manifest: `{id, uid, code, destination, status, capacityKg, parcelCount, totalWeightKg, remainingKg,
totalChargeCents, createdAt}`. Parcel: `{id, uid, manifestId, recipient, weightKg, fragile, chargeCents, createdAt}`.
Lists are `{items, total}`. Creates answer 201, everything else that succeeds 200.

Volatile by design: `createdAt` (ISO time of creation) and `uid` (`mf_` or `pc_` plus 8 random hex digits) of records
created after the start. Seed records have fixed values. `id` is a counter: deterministic after a restart.

Seed (ids are fixed): manifests 1 `NR-101` Northgate Depot open 50 kg; 2 `HB-204` Harbour Row sealed 40; 3 `EW-310`
Eastwick Lockers dispatched 60; 4 `SM-007` South Mill delivered 50; 5 `QA-550` Quarry Lane open 20, empty. Parcels:
1 Ines Marlow 4.5 (m1); 2 `bao Tran` 4.5 (m1); 3 Odile Ferrant 12.0 fragile (m1); 4 Tomas Reyes 7.2 (m2); 5 Wren Abara
1.0 fragile (m2); 6 Kofi Lindqvist 20.0 (m3); 7 Mira Stone 3.3 (m3); 8 Per Halloran 9.9 fragile (m4).

## The rules

Step names refer to `heldout-rules.json`; the first created manifest gets id 6, the first created parcel id 9.

### Visible in normal use

**R01 code-normalised.** A manifest code is trimmed and upper-cased, then must be two letters, a dash and three
digits.

- `manifest-create-normalised`: `POST /api/manifests {"code":"  kd-412 ","destination":"  Kestrel   Dock  "}` gives
  201 with `"id":6,"code":"KD-412","destination":"Kestrel Dock","status":"open","capacityKg":50`.
- `manifest-code-format`: code `"N-1010"` gives 422 `{"error":"code_format",...,"pattern":"AA-000"}`.
- Missing code: 422 `code_required`. Missing destination: 422 `destination_required`.

**R02 derived-totals.** A manifest reports `parcelCount`, `totalWeightKg` (sum of its parcels), `remainingKg`
(capacity minus that sum) and `totalChargeCents` (sum of its parcels' charges). They are never stored.

- `fp-manifests`: manifest 1 reads `"parcelCount":3,"totalWeightKg":21,"remainingKg":29,"totalChargeCents":3959`.
- `manifest-derived-totals`: `GET /api/manifests/6` after four parcels gives
  `"parcelCount":4,"totalWeightKg":50,"remainingKg":0,"totalChargeCents":7627`.

**R03 manifest-order.** Manifests list by status in the order open, sealed, dispatched, delivered, and by code
ascending within a status.

- `fp-manifests`: ids in order 1 (`NR-101`), 5 (`QA-550`), 2, 3, 4.
- `list-manifests-final`: `KD-412` (id 7, open) comes before `NR-101`.

**R04 statuses on screen.** The manifest page offers `Seal manifest` when open, `Reopen manifest` and
`Dispatch manifest` when sealed, `Mark delivered` when dispatched and nothing when delivered. Money is shown as
`$39.59` from cents, weights with one decimal and ` kg`, and the parcel count as `N of 6 parcels`
(`heldout-pages.json`, the `page-manifest-*` steps).

### Needs an edge probe

**R05 code-unique.** A code in use is refused whatever case it was typed in, on create and on edit:
409 `code_taken` with the holder's id.

- `manifest-code-taken`: `POST /api/manifests {"code":"nr-101","destination":"Elsewhere"}` gives
  409 `{"error":"code_taken",...,"existingId":1}`.
- Outside the scenarios: `PUT /api/manifests/1 {"code":"qa-550"}` gives 409 `code_taken`, `existingId` 5.

**R06 recipient-unique-per-manifest.** A recipient is trimmed and inner runs of whitespace become one space; the case
typed is kept. Within one manifest two parcels may not have the same recipient, compared without letter case. Another
manifest may.

- `parcel-round-half-up-fragile`: recipient `"  Ada   Okafor "` is stored as `"Ada Okafor"` (parcel 9, manifest 6).
- `parcel-recipient-duplicate-case`: `{"manifestId":6,"recipient":"ADA  okafor","weightKg":1}` gives
  409 `{"error":"recipient_duplicate",...,"existingId":9}`.
- `parcel-recipient-other-manifest`: `{"manifestId":5,"recipient":"ada okafor","weightKg":1}` gives 201, id 11,
  recipient `"ada okafor"`.

**R07 text-limits.** Destination 2 to 60 characters, recipient 2 to 40, measured after trimming and collapsing.

- `manifest-destination-short`: destination `" x "` gives 422 `{"error":"destination_length",...,"min":2,"max":60}`.
- `parcel-recipient-short`: recipient `" D "` gives 422 `{"error":"recipient_length",...,"min":2,"max":40}`.

**R08 weight-rounding.** `weightKg` must be a JSON number. It is rounded to the nearest 0.1 kg, half up. A weight
that rounds to 0 or less is refused.

- `parcel-round-half-up-fragile`: 2.25 is stored as 2.3. `parcel-round-then-bill`: 2.04 is stored as 2.
- `parcel-id-not-reused`: 0.25 is stored as 0.3. `parcel-shrink-own-weight`: 15.25 is stored as 15.3.
- `parcel-weight-rounds-to-zero`: 0.04 gives 422 `weight_invalid`. `parcel-weight-string`: `"4.5"` gives
  422 `weight_invalid`.

**R09 weight-limit.** A parcel weighs at most 30 kg, judged after rounding.

- `parcel-weight-limit-edge`: 30.04 is accepted and stored as 30 (charge 3950).
- `parcel-weight-over-limit`: 30.25 gives 422 `{"error":"weight_over_limit",...,"maxKg":30}`.

**R10 charge.** `chargeCents` = 350 + 120 for every started kilogram of the rounded weight. A fragile parcel pays 15%
more, rounded half up to the cent. It is recomputed on every edit.

- 2.04 kg, not fragile: stored 2.0, two started kilograms, 590 (billing the raw 2.04 would give 710).
- 2.25 kg fragile: stored 2.3, three started kilograms, 710, times 1.15 is 816.5, charged 817.
- Seed: 12.0 kg fragile is 2059 (1790 × 1.15 = 2058.5); 1.0 kg fragile is 541; 9.9 kg fragile is 1783.
- `parcel-shrink-own-weight`: `PUT /api/parcels/13 {"weightKg":15.25,"fragile":true}` gives `"weightKg":15.3`,
  `"chargeCents":2611` (2270 × 1.15 = 2610.5).

**R11 parcel-order.** Parcels list by weight descending; equal weights by recipient ascending without letter case;
then by id.

- `list-parcels-tie-break`: `GET /api/parcels?manifestId=1` gives ids 3, 2, 1: `bao Tran` (4.5) before
  `Ines Marlow` (4.5). A case-sensitive comparison would put `Ines Marlow` first.

**R12 capacity-field.** `capacityKg` defaults to 50 and must be a whole number from 1 to 200.

- `manifest-capacity-over` (201) and `manifest-capacity-fraction` (12.5) give
  422 `{"error":"capacity_invalid",...,"min":1,"max":200}`.

**R13 list-filters.** `?status=` keeps one status and refuses an unknown one; `?q=` keeps manifests whose code or
destination contains the text, without letter case. `?manifestId=` on parcels answers 404 for an unknown manifest.

- `list-manifests-open`: ids 1, 5. `list-manifests-search` (`q=LOCK`): id 3 only.
- `list-manifests-bad-status`: 422 `{"error":"status_invalid",...,"allowed":["open","sealed","dispatched","delivered"]}`.

### Needs several steps

**R14 capacity-quota.** The parcels of a manifest may weigh at most its `capacityKg` in total. Reaching it exactly is
allowed. An edit is judged without the parcel's own old weight. Capacity cannot be lowered below the load.

- `parcel-fills-capacity`: with 34.3 kg on manifest 6 (capacity 50), 15.7 kg is accepted (201, id 13).
- `parcel-over-capacity`: then 0.1 kg gives
  409 `{"error":"capacity_exceeded",...,"capacityKg":50,"usedKg":50,"requestedKg":0.1}`.
- `parcel-grow-over-capacity`: `PUT /api/parcels/9 {"weightKg":2.4}` gives 409 `capacity_exceeded` with
  `"usedKg":47.7,"requestedKg":2.4`.
- `parcel-shrink-own-weight`: 15.7 to 15.3 on parcel 13 is accepted.
- `manifest-capacity-below-load`: `PUT /api/manifests/6 {"capacityKg":49}` gives
  409 `{"error":"capacity_below_load",...,"capacityKg":49,"usedKg":49.6}`.

**R15 parcel-quota.** A manifest carries at most 6 parcels. The count is checked before the recipient and the
capacity.

- `setup-fill-4` to `setup-fill-6` bring manifest 1 to six parcels (ids 14, 15, 16).
- `parcel-seventh-refused`: 409 `{"error":"manifest_full",...,"maxParcels":6}`.
- `parcel-full-before-duplicate`: recipient `"ines marlow"` (a duplicate) also gives `manifest_full`.

**R16 state-machine.** `PUT /api/manifests/:id/status {"status": S}`. Allowed: open to sealed; sealed to open or
dispatched; dispatched to delivered; delivered to nothing. Anything else, including the status it already has, is
409 `invalid_transition` with `from`, `to` and `allowed`. A value that is not a status is 422 `status_invalid`.

- `status-skip-refused`: open to dispatched gives `"from":"open","to":"dispatched","allowed":["sealed"]`.
- `status-seal`, `status-reopen`, `status-dispatch`, `status-deliver`: 200 with the new status.
- `status-same-refused`: open to open, 409. `status-unknown`: `"lost"`, 422.
- `status-back-refused`: dispatched to sealed gives `"allowed":["delivered"]`.
- `status-delivered-final`: delivered to open gives `"allowed":[]`.

**R17 seal-needs-parcels.** An empty manifest cannot be sealed.

- `seal-empty-refused`: `PUT /api/manifests/5/status {"status":"sealed"}` gives 409 `{"error":"manifest_empty",...}`.

**R18 lock.** Only an open manifest can change: its fields, and adding, editing or deleting its parcels, all answer
409 `{"error":"manifest_locked",...,"status":"<status>"}` otherwise. The lock is checked after field validation and
before the quotas.

- With manifest 6 sealed: `parcel-add-locked`, `parcel-edit-locked` (`PUT /api/parcels/9 {"fragile":false}`),
  `parcel-delete-locked` (`DELETE /api/parcels/9`) and `manifest-edit-locked` all give 409 `manifest_locked`,
  `"status":"sealed"`.
- After `status-reopen`, `parcel-delete-open` (`DELETE /api/parcels/10`) gives 200 `{"deleted":true,"id":10}`.

**R19 delete-and-cascade.** A dispatched manifest cannot be deleted. Deleting any other manifest deletes its parcels
and reports how many.

- `manifest-delete-dispatched-refused`: 409 `{"error":"manifest_in_transit",...,"status":"dispatched"}`.
- `manifest-delete-cascades` (manifest 6, now delivered): 200 `{"deleted":true,"id":6,"parcelsRemoved":3}`.
- `parcel-gone-after-cascade`: `GET /api/parcels/9` gives 404 `{"error":"parcel_not_found",...,"id":9}`.

**R20 ids-and-freed-codes.** Ids are never reused, and a deleted manifest's code is free again.

- `manifest-code-free-again`: `POST /api/manifests {"code":"kd-412","destination":"Kestrel Dock","capacityKg":20}`
  gives 201 with `"id":7,"code":"KD-412"`.
- `parcel-id-not-reused`: the next parcel gets id 17, although parcels 9, 10, 12 and 13 are gone.

**R21 summary.** `GET /api/summary` is derived: manifests per status and in total, parcels, fragile parcels,
`totalWeightKg`, `inTransitWeightKg` (parcels on dispatched manifests only), `averageParcelWeightKg` (two decimals,
0 without parcels), `totalChargeCents`, and `heaviest` (the loaded manifest with the greatest weight; the lower code
wins a tie; null without parcels).

- `fp-summary`: `{"manifests":{"open":2,"sealed":1,"dispatched":1,"delivered":1,"total":5},"parcels":8,
  "fragileParcels":3,"totalWeightKg":62.4,"inTransitWeightKg":23.3,"averageParcelWeightKg":7.8,
  "totalChargeCents":11173,"heaviest":{"id":3,"code":"EW-310","totalWeightKg":23.3}}`.
- `summary-while-dispatched`: `"dispatched":2,"total":6`, `"parcels":15,"fragileParcels":5,"totalWeightKg":114,
  "inTransitWeightKg":70.9,"averageParcelWeightKg":7.6,"totalChargeCents":20431`, heaviest `KD-412` at 47.6.
- `summary-final`: `"open":3`, `"parcels":13,"fragileParcels":3,"totalWeightKg":66.7,"inTransitWeightKg":23.3,
  "averageParcelWeightKg":5.13,"totalChargeCents":13523`, heaviest `NR-101` at 24.
- Outside the scenarios, from a clean start: create `aa-001` and book 23.3 kg onto it; the summary's heaviest is
  `AA-001` (a tie with `EW-310`), and the average is 9.52 (85.7 / 9).

**R22 parcel-stays.** A parcel cannot move: a `manifestId` in an edit that differs from its own is refused.

- `parcel-move-refused`: `PUT /api/parcels/13 {"manifestId":1}` gives
  422 `{"error":"manifest_immutable",...,"manifestId":6}`.

**R23 order of checks.** Existence (404), then field validation (422), then conflicts (409) in the order locked,
full, duplicate recipient, capacity.

- `parcel-manifest-missing`: `{"manifestId":99,...}` gives 404 `{"error":"manifest_not_found",...,"id":99}`.
- `parcel-add-locked`: manifest 6 is sealed and full to 0.4 kg; the answer is `manifest_locked`.
- `parcel-full-before-duplicate`: see R15.

## Checked outside the scenarios

From a clean start on port 4701, each with `curl`:

- `POST /api/manifests {"destination":"No code"}`: 422 `code_required`.
- `POST /api/manifests {"code":"AB-123"}`: 422 `destination_required`.
- `POST /api/parcels {"recipient":"No manifest","weightKg":1}`: 422 `manifest_required`.
- `POST /api/parcels {"manifestId":1,"weightKg":1}`: 422 `recipient_required`.
- `POST /api/parcels {"manifestId":1,"recipient":"Flag Test","weightKg":1,"fragile":"yes"}`: 422 `fragile_invalid`.
- `GET /api/manifests/999`: 404 `manifest_not_found`. `GET /api/nope`: 404 `not_found`.
- `POST /api/manifests` with body `{bad`: 400 `invalid_json`.
- `PATCH /api/manifests/1`: 405 `{"error":"method_not_allowed",...,"allow":["GET","PUT","DELETE"]}`.
- `PUT /api/manifests/1 {"destination":"  North   Gate "}`: 200, destination `"North Gate"`.
- `DELETE /api/manifests/2` (sealed): 200 `{"deleted":true,"id":2,"parcelsRemoved":2}`, then `GET /api/parcels/4`: 404.

## The held-out scenarios, proven

Two instances of this application served as "original" (port 4702) and "clone" (port 4703). A throwaway run folder
from `rea init-clone-run` rendered the capture inputs; each scenario was captured twice per side, each capture after
`ctl.sh reset`. Then `rea compare-scenario-behavior --left … --left … --right … --right … --detail complete
--exit-code`:

- Without declarations, `heldout-rules`: exit 2, verdict `unknown`, 60 steps (59 and REA's `scenario_start`), 41
  `unchanged`, 19 `unstable`. Every finding is `undeclared-volatile` on the body, at `/uid` and `/createdAt` (18 steps
  each) and at `/items/*/uid` and `/items/*/createdAt` (`list-manifests-final`). Both start states `clean`.
- Without declarations, `heldout-pages`: exit 2, verdict `unknown`, 19 steps, 18 `unchanged`, 1 `unstable`:
  `api-add-parcel`, `undeclared-volatile` at `/uid` and `/createdAt`.
- With `--differences heldout-differences.json --scenario <id>`: both exit 0, verdict `unchanged`, 60 of 60 and 19 of
  19 steps `unchanged`, no limitations.

No reply body was lost in any of the eight captures. A real clone needs the rename added to the differences file.

What the scenarios deliberately avoid, because the original itself is not steady there: a click whose effect arrives
after a `fetch` (the on-screen text right after the click is racy; a first draft with such steps as `setup-` steps
came out `unstable` on those steps and once put the manifest page's reload requests in the following step). The one
click kept, `page-parcel-save`, waits for its reply with `save_response` and the page then renders from that reply.
