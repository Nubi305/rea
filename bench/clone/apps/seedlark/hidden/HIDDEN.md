# Seedlark: what the cloning agent is not told

Seedlark is a seed-packet catalogue for small gardens: varieties (the catalogue), a basket per browser, and an
order book. Source: `original/` beside this folder (`server.mjs`, `public/seedlark.css`). Control:
`ctl.sh start|stop|reset|health` (`PORT` selects the port, default 5360). The directory is relocatable: `ctl.sh`
finds `server.mjs` beside itself and keeps its pid file and log in `.run/` there. Restarting is the reset: all data
is in memory and rebuilt from the seed.

Files here:

- `rules.json`: the 33 rules, each with one sentence, a difficulty and the held-out steps that show it, plus how to
  score a clone rule by rule.
- `heldout-api.json`: 97 steps, all `request` steps, start page `/`. Fingerprint steps first.
- `heldout-pages.json`: 44 steps. Pages by `goto`, two forms filled and submitted (one refused, one accepted), a basket
  built and checked out through forms, an order moved on with its button, and two `request` steps.
- `heldout-differences.json`: the 26 volatile fields (`uid`, `createdAt`) of the two scenarios, no renames. Add the
  rename from `Seedlark` to the clone's name before comparing a clone, or the on-screen text of every page differs.
- `expected-heldout-api.txt`: each step of `heldout-api` with the original's status and body, replayed with `fetch`
  and one cookie jar from a clean start (`tools/replay.mjs`). A second replay after a restart agreed on everything
  but `uid` and `createdAt` of records created during the run.
- `expected-heldout-pages.txt`: each step of `heldout-pages` with the page address afterwards (origin removed) and
  the accessibility text, from the original's first capture.
- `tools/`: the scripts that wrote the scenarios and `heldout-pages-portable.json` (`gen.mjs`), `rules.json`
  (`rules.mjs`) and the replay (`replay.mjs`). They find this folder from where they are, so they run from any copy.
- `heldout-pages-portable.json`: `heldout-pages.json` with its nine markup-bound waits replaced; `rules.json` replays
  it (see "In the benchmark" below).
- `selftest-mutant.json`: the R09 mutant below, as one replacement in `server.mjs`.

## In the benchmark

This folder is the author's `hidden/` with these changes, made when the application was brought into
`bench/clone/apps/seedlark`:

- `heldout-pages.json` waits on this application's data attributes (`[data-alert=...]`, `[data-notice=...]`, nine
  steps). A clean-room clone does not have them, the wait fails there, and no later step runs. `tools/gen.mjs` now also
  writes `heldout-pages-portable.json`, the same scenario with each of those waits finding the element by its role
  (`[role=alert]` or `[role=status]`; every page those steps reach holds one alert or one status and no other).
  `rules.json` names that file for `heldout-pages`.
- `tools/gen.mjs` and `tools/rules.mjs` wrote into the author's folder by its absolute path; they now find this folder
  from where they are. `tools/capture.sh` (which pointed at the author's scratch folder) and `tools/diffs.cjs` (which
  read comparison results kept only there) were not brought in: `node bench/harness/clone-check-app.mjs --app
  seedlark` repeats the captures and the comparison, and `heldout-differences.json` is kept as written.

## Shape of the application

Server-rendered HTML with forms and no client script; every write through a page is POST, then 303, then GET. A form
that is refused is answered with the same page again (422 or 409), every problem listed in a `role=alert` box, the
fields marked `aria-invalid` and the typed values kept.

| Page | What it does |
| --- | --- |
| `GET /` | product name, counts of varieties, varieties in stock, orders waiting to ship |
| `GET /varieties?q=&kind=&status=&sort=&dir=&page=` | catalogue table, search form (GET), sort links, `Page N of M` with Previous/Next |
| `GET /varieties/new`, `POST /varieties` | create form; success 303 to `/varieties/:id?created=1` |
| `GET /varieties/:id` | detail, `Add to basket` form (`POST /basket/lines`), edit link, delete button |
| `GET /varieties/:id/edit`, `POST /varieties/:id` | edit form; success 303 to `/varieties/:id?saved=1` |
| `POST /varieties/:id/delete` | 303 to `/varieties`, or 409 page |
| `GET /basket`, `POST /basket/promo`, `POST /basket/checkout` | basket, code form, checkout; 303 to `/basket?applied=1` and `/orders/:id?placed=1` |
| `GET /orders`, `GET /orders/:id`, `POST /orders/:id/status` | order list, order page with one button per allowed transition |

API (JSON; errors are `{"error": "<code>", "message": "...", ...details}`):

| Route | Methods |
| --- | --- |
| `/api/varieties` (same query as the page) | GET, POST |
| `/api/varieties/:id` | GET (ETag, 304), PUT, DELETE |
| `/api/basket` | GET, DELETE (empties it) |
| `/api/basket/lines` | POST `{varietyId, qty}` |
| `/api/basket/lines/:varietyId` | PUT `{qty}`, DELETE |
| `/api/basket/promo` | POST `{code}`, DELETE |
| `/api/checkout` | POST |
| `/api/orders[?status=]`, `/api/orders/:id` | GET |
| `/api/orders/:id/status` | PUT `{status}` |
| `/api/health` | GET |

Variety: `{id, uid, sku, name, kind, priceCents, price, stock, status, rev, createdAt}` (`price` is the euros as text,
`"2.45"`). List: `{items, total, page, pages, pageSize: 4, sort, dir}`. Basket: `{lines, itemCount, subtotalCents,
promo, shippingCents, totalCents}`, a line `{varietyId, sku, name, kind, qty, unitCents, discountCents, lineCents}`,
`promo` null or `{code, discountCents, applied}`. Order: `{id, uid, number, status, lines, itemCount, subtotalCents,
promo, shippingCents, totalCents, createdAt}`. Orders list `{items, total}`. Creates answer 201 (variety, order);
basket writes answer 200 with the whole basket.

Money on pages is euros from cents: `€2.45`, a discount `-€1.47`, shipping `free` at 0. Stock 0 shows `Sold out`;
the detail page says `N packets` (also `1 packets`). The nav shows `Basket (N)` with N the packets in the basket.

## The mess, on purpose

- **Basket cookie.** `seedlark_basket=<24 hex digits>`, random, set by the first request of a browser that has no
  valid one (`HttpOnly; SameSite=Lax; Path=/`). It only names an in-memory basket; a cookie the server does not know
  (for example after a restart) gets a new empty basket. The value never appears in a body.
- **Request id.** Every response carries `X-Request-Id` with 16 random hex digits, new on every request.
- **Generated id and server time.** A created variety gets `uid` `var_` plus 8 random hex digits, an order `ord_` plus
  8; both get `createdAt`, the ISO time of creation. Seed records have fixed values. `id`, `rev` and the order
  `number` are counters: deterministic after a restart.

Everything else is deterministic after a restart. No rule depends on the clock or on randomness. The comparison
covers reply bodies, statuses, page addresses and accessibility text, not header values, so only `uid` and
`createdAt` need declaring (`heldout-differences.json`).

## Seed

Varieties (id, SKU, name, kind, price, stock, status): 1 `TOM-0101` Brandywine Tomato vegetable 3.45 38; 2 `BAS-0204`
Genovese Basil herb 2.45 22; 3 `CAL-0310` `calendula Pacific` flower 2.10 12; 4 `CAR-0402` Chantenay Carrot vegetable
2.10 54; 5 `DIL-0505` Bouquet Dill herb 1.95 0; 6 `SWP-0611` Sweet Pea Cupani flower 3.95 8; 7 `KAL-0720` Cavolo Nero
Kale vegetable 2.85 30; 8 `CHV-0815` Chives herb 1.95 17; 9 `ZIN-0909` Zinnia Envy flower 3.20 5 **retired**;
10 `PEA-1002` Alderman Pea vegetable 3.45 22; 11 `COR-1110` Coriander Calypso herb 2.30 14; 12 `NAS-1212` Nasturtium
Empress flower 2.50 9. All `rev` 1.

Orders: 1 `SL-1001` shipped, 2 × tomato (total 1040); 2 `SL-1002` packed, 3 × basil and 1 × chives (1280); 3
`SL-1003` placed, 6 × carrot (1134 after the bulk discount, total 1484).

## The rules

Step names refer to `heldout-api.json` unless marked (pages). In `heldout-api` the first created variety is id 13
(`BEE-0042`) and the first order id 4 (`SL-1004`); in `heldout-pages` the same.

### Visible in normal use

**R01 sku-normalised.** Trimmed, upper-cased, then three letters, a dash and four digits.
- `variety-create-normalised`: `POST /api/varieties {"sku":"  bee-0042 ","name":"  Borage   Blue  ","kind":" HERB ","price":"2.425","stock":7}`
  gives 201 `"id":13,"sku":"BEE-0042","name":"Borage Blue","kind":"herb","priceCents":245,"price":"2.45","stock":7,"status":"active","rev":1`.
- `variety-sku-format`: `"TO-101"` gives 422 `{"error":"sku_format",...,"field":"sku","pattern":"AAA-0000"}`.
- `variety-first-error-wins`: all four fields bad; the API answers the first in field order (sku, name, kind, price,
  stock, status): `sku_format`. The page lists all of them (pages `form-errors-kept-values`: 3 problems).

**R08 catalogue-default-order.** Active varieties by name without letter case, then id; four to a page.
- `fp-varieties` ids 10, 5, 1, 3 (`calendula Pacific` sits between Brandywine and Cavolo; a case-sensitive sort would
  put it last); `fp-varieties-page-2` 7, 4, 8, 11; `fp-varieties-page-3` 2, 12, 6; `total` 11, `pages` 3.

**R12 search.** `q` is trimmed and matched without case in name or SKU.
- `list-search-name` (`q=%20PEA%20`): ids 10, 6. `list-search-sku` (`q=0815`): id 8.

**R15 basket-retired-or-unknown.** `basket-add-retired` (variety 9): 409 `variety_retired`, `varietyId` 9.
`basket-add-unknown` (99): 404 `{"error":"variety_not_found",...,"id":99}`.

**R24 checkout.** `checkout-places-order`: 201 `"id":4,"number":"SL-1004","status":"placed"`, lines calendula 6
(1134, discount 126), sweet pea 2 (790), carrot 2 (420), subtotal 2344, SPRING5 500, shipping 350, total 2194.
`checkout-empties-basket`: lines empty, promo null, all zero. `checkout-empty-refused`: 409 `basket_empty`.
`stock-taken-at-checkout`: calendula stock 6 (was 12), `rev` 4. Pages: `page-order-placed` shows `Order SL-1004`,
`status: Order placed. Thank you.`; `page-variety-after-order` shows `1 packets` for Borage (7 minus 6).

**R30 orders-list.** Newest first; `?status=` read without case; unknown 422; unknown order 404.
- `fp-orders` ids 3, 2, 1. `orders-newest-first` 4, 3, 2, 1. `orders-filter-status` (`CANCELLED`): id 4.
  `orders-filter-invalid`: 422 `status_invalid` with `allowed` `["placed","packed","shipped","cancelled"]`.
  `order-missing`: 404 `order_not_found`. Pages `page-orders`: rows `SL-1004 packed 6 €14.08` … `SL-1001 shipped 2 €10.40`.

**R31 protocol.** `route-unknown` (`GET /api/seeds`): 404 `{"error":"not_found",...}`. `method-not-allowed`
(`PATCH /api/varieties/1`): 405, header `Allow: GET, HEAD, PUT, DELETE`, body `"allow":["GET","HEAD","PUT","DELETE"]`.
`method-not-allowed-collection` (`DELETE /api/orders`): `"allow":["GET","HEAD"]`. Pages `page-missing`
(`/varieties/99`): heading `Page not found`.

**R32 forms-keep-values** (pages). `form-errors-kept-values`: after `bee-1`, `  Borage   Blue `, herb, `0.47`,
`lots`, the page at `/varieties` has an alert `3 problems to fix:` (SKU, price, stock messages), those three textboxes
`[invalid]` with `bee-1`, `0.47`, `lots`, the name kept and `herb` selected. `page-edit-sku-taken`: editing variety 2
to `chv-0815` gives the edit page again with `Another variety uses that SKU.` `page-add-refused-kept`: quantity 13 gives
the variety page with the alert and `textbox "Quantity": "13"`. `page-promo-minimum`: `spring5` on a 13.23 basket
gives `This code needs goods worth 15.00 euros.` and the code kept.

**R33 post-redirect-get** (pages). `form-created-redirect` lands on `/varieties/13?created=1` with
`status: Variety created.`; `page-added-notice` on `/varieties/13?added=1` with `6 in your basket.` and `Basket (6)`;
`page-promo-applied` on `/basket?applied=1`; `page-order-placed` on `/orders/4?placed=1`; `page-order-packed` on
`/orders/4?changed=1` with `status: Order updated.` and only `Mark shipped` and `Cancel order` left.

### Needs an edge probe

**R02 sku-unique-ignoring-case.** `variety-sku-taken-case` (`tom-0101`): 409 `{"error":"sku_taken",...,"field":"sku","existingId":1}`.
`variety-edit-sku-taken` (`PUT /api/varieties/1 {"sku":"bas-0204"}`): 409, `existingId` 2. `variety-edit-no-change`:
`PUT /api/varieties/1` with its own SKU in lower case is accepted.

**R03 name-collapsed-3-to-32.** `variety-name-short` (`"  Ab   "`) and `variety-name-long` (33 characters): 422
`{"error":"name_length",...,"min":3,"max":32}`. `variety-name-max`: `"Abcdefghij   Abcdefghij Abcdefghij"` collapses
to 32 characters and is accepted (id 17).

**R04 kind-normalised.** `" HERB "` is stored as `herb`. `variety-kind-invalid` (`shrub`): 422 `kind_invalid` with
`allowed` `["vegetable","herb","flower"]`. `list-kind-all-statuses` (`kind=FLOWER&status=all`): ids 3, 12, 6, 9.
`list-kind-invalid` (`kind=tree`): 422 `kind_invalid`.

**R05 price-to-nearest-5-cents.** Halves up, computed on the decimal text, never on a float.
- `"2.425"` gives 245 (2.425 is exactly half way between 2.40 and 2.45). `variety-price-round-down`: the number `2.42`
  gives 240. `variety-price-format`: `"2,40"` gives 422 `price_format`.

**R06 price-range-after-rounding.** `variety-price-below-range` (`"0.47"`, rounds to 0.45): 422
`{"error":"price_range",...,"min":"0.50","max":"50.00"}`. `variety-price-range-edge-stock-default` (`"0.48"`): 201 with
`"priceCents":50`. `variety-price-upper-edge` (`"50.024"`): 201 with 5000. `variety-price-above-range` (`"50.025"`): 422.

**R07 stock-field.** `variety-price-range-edge-stock-default` has no stock: `"stock":0,"status":"active"`.
`variety-stock-invalid` (1000): 422 `{"error":"stock_invalid",...,"min":0,"max":999}`.

**R09 sort-tie-break.** The direction applies to the sort key only; ties go by name ascending without case, then id.
- `list-price-asc-tie`: 5 (Bouquet Dill 1.95), 8 (Chives 1.95), 3 (calendula 2.10), 4 (Chantenay 2.10).
- `list-price-desc-tie`: 6 (3.95), 10 (Alderman Pea 3.45), 1 (Brandywine 3.45), 7. Reversing the tie too gives 6, 1, 10.
- `list-price-desc-last-page`: 4, 5, 8 (Chantenay before Bouquet Dill, Bouquet Dill before Chives).
- Pages `page-catalogue-sorted` (`?sort=price&dir=desc&page=2`): Nasturtium, Genovese Basil, Coriander, calendula,
  header `Price (descending)`.

**R10 page-clamped.** `list-page-clamp-high` (`page=99`): `"page":3`, ids 2, 12, 6. `list-page-clamp-junk`
(`page=-2`): page 1. Pages `page-catalogue-clamped` (`?page=7`): `Page 3 of 3`.

**R11 sort-fallback.** `list-sort-unknown` (`sort=colour&dir=sideways`): `"sort":"name","dir":"asc"`, same order as
`fp-varieties`. `list-sku-desc` (`sort=SKU&dir=DESC`): `"sort":"sku","dir":"desc"`, ids 1, 6, 10, 12.

**R13 retired-hidden.** `list-search-retired-hidden` (`q=zin`): `total` 0. `list-status-retired`: id 9 only.
`list-status-invalid` (`status=gone`): 422 `status_invalid` with `allowed` `["active","retired","all"]`.

**R14 basket-quantity-and-merge.** `basket-add-qty-zero` and `basket-add-qty-over` (13): 422
`{"error":"qty_invalid",...,"min":1,"max":12}`. `basket-add-basil` (4) then `basket-merge-bulk-discount` (3): one line
of 7. `basket-line-limit` (6 more): 409 `{"error":"line_limit",...,"max":12,"inBasket":7}`.

**R16 basket-stock.** Judged on the merged total. `basket-add-sold-out` (dill, stock 0): 409
`{"error":"out_of_stock",...,"varietyId":5,"available":0,"requested":1}`. `basket-over-stock` (sweet pea 9 of 8):
`"available":8,"requested":9`. `basket-set-over-stock` (`PUT /api/basket/lines/6 {"qty":9}`): the same.

**R18 bulk-discount.** Six or more packets of one variety: 10% off the line, rounded down to the cent.
- `basket-merge-bulk-discount`: 7 × 2.45 = 17.15, discount 171 (171.5 rounded down), line 1544.
- `promo-minimum-again`: 6 × 2.10 = 12.60, discount 126, line 1134. Pages `page-basket-bulk`: Borage 6 × €2.45,
  `-€1.47`, `€13.23`, shipping `€3.50`, total `€16.73`.

**R19 basket-line-order.** By line total descending, then SKU ascending.
- `basket-line-order-tie`: carrot was added before calendula; both lines are 210 and `CAL-0310` comes first.
- `basket-merge-when-full`: carrot grows to 420 and moves ahead of calendula. `promo-minimum-again`: calendula at 1134
  moves to the top.

### Needs several steps

**R17 basket-five-lines.** `basket-full` (chives as a sixth variety): 409 `{"error":"basket_full",...,"maxLines":5}`.
`basket-merge-when-full` (one more carrot): 200.

**R20 promo-codes.** `promo-unknown` (`FREESEEDS`): 422 `promo_unknown`. `promo-herbs` (`"  herbs20 "`): code
`HERBS20`, 20% of the herb lines (1544 × 0.2 = 308.8) half up: 309. `promo-spring-replaces` (`spring5`): code
`SPRING5`, 500. Pages: `spring5` on a 13.23 basket is refused (409 `promo_minimum`, `"minimumCents":1500` in the API);
`herbs20` then gives `Code HERBS20 -€2.65` (1323 × 0.2 = 264.6 half up 265), total `€14.08`.

**R21 promo-kept-when-below-minimum.** `promo-below-minimum-kept`: after removing basil and tomato, subtotal 1420;
`"promo":{"code":"SPRING5","discountCents":0,"applied":false}`, total 1770. `promo-minimum-again`: subtotal 2344,
the code applies again, 500 off.

**R22 shipping.** 350 while goods after the code are under 2500, else 0; an empty basket 0.
- `basket-add-basil`: 980, shipping 350. `promo-herbs`: 2334 − 309 = 2025, shipping 350 (judging the subtotal before the
  code would give the same here). `basket-live-price-free-shipping`: 3384 − 309 = 3075, shipping 0.
- `checkout-empties-basket`: shipping 0. Pages `page-promo-applied`: 1323 − 265 = 1058, shipping `€3.50`.

**R23 live-price-snapshot-order.** `variety-edit-price` raised the tomato to 3.50; `basket-live-price-free-shipping`
prices 3 tomatoes at 350 each (1050). `setup-reprice-sweet-pea` raises sweet pea to 4.00 after checkout;
`order-prices-snapshot` still has `"unitCents":395` and total 2194.

**R25 checkout-rechecks.** Lines are checked in basket order. `checkout-stock-rechecked` (sweet pea stock set to 1): 409
`{"error":"out_of_stock",...,"varietyId":6,"available":1,"requested":2}`. `checkout-retired-first-line` (calendula
retired too, and listed first): 409 `variety_retired`, `varietyId` 3. Neither changes stock or the basket.

**R26 order-state-machine.** placed → packed | cancelled; packed → shipped | cancelled; shipped, cancelled final.
- `order-skip-refused`: placed to shipped, 409 `{"error":"invalid_transition",...,"from":"placed","to":"shipped","allowed":["packed","cancelled"]}`.
- `order-status-unknown` (`lost`): 422 `status_invalid`. `order-pack` (`" PACKED "`): 200 packed.
- `order-back-refused` (packed to placed) and `order-same-refused` (packed to packed): 409, `allowed` `["shipped","cancelled"]`.
- `order-cancelled-final`: `"allowed":[]`. `order-shipped-final` (order 1 to cancelled): `"allowed":[]`.

**R27 cancel-restores-stock.** `order-cancel-packed`: 200 cancelled. `cancel-restores-stock`: calendula stock back to
12, `rev` 5.

**R28 delete-variety.** `variety-delete-in-use` (tomato, on shipped order 1) and `variety-delete-in-use-placed`
(carrot, on order 3): 409 `{"error":"variety_in_use",...,"orders":1}`. `variety-delete-cascades-basket` (Borage,
2 in the basket): 200 `{"deleted":true,"id":13,"basketLinesRemoved":1}`; `basket-after-cascade`: three lines, total 2194.

**R29 revision-and-etag.** `ETag: "v<id>.<rev>"` on `GET /api/varieties/:id`; `If-None-Match` equal to it (or `*`)
gives 304 with no body. `rev` goes up by one only when a stored value changes.
- `etag-not-modified`: 304. `variety-edit-no-change` (same name with extra spaces, own SKU in lower case): 200, `rev` 1.
  `etag-unchanged-after-no-op`: still 304. `variety-edit-price`: `rev` 2. `etag-changed-after-edit`: 200, `rev` 2.
- Stock changes count: calendula is at `rev` 4 after retire, reactivate and checkout (`stock-taken-at-checkout`) and
  5 after the cancel (`cancel-restores-stock`).

## Checked outside the scenarios

From a clean start on port 5360 with `curl`: `PATCH /api/varieties/1` answers 405 with `Allow: GET, HEAD, PUT,
DELETE`; `GET /api/varieties/1` answers `ETag: "v1.1"` and the same request with `If-None-Match: "v1.1"` answers
304. `ctl.sh start` twice: the second refuses (`already running`, exit 1); with another process on the port it
refuses (`taken by another process`, exit 1); `stop` reports the port free.

## The held-out scenarios, proven

A throwaway run folder from `rea init-clone-run` (original on 5361, clone on 5362) rendered the capture inputs. Two
copies of this directory served the two sides. Each scenario was captured twice per side with
`rea capture-browser-scenario`, each capture after `ctl.sh reset`. Then
`rea compare-scenario-behavior --left … --left … --right … --right … --detail complete --exit-code`:

- Without declarations: `heldout-api` exit 2, verdict `unknown`, 98 steps (97 and `scenario_start`), 86 unchanged,
  12 `unstable`, each finding `undeclared-volatile` at `/uid` and `/createdAt` (or `/items/*/uid`, `/items/*/createdAt`
  on the order lists). `heldout-pages` exit 2, 45 steps, 44 unchanged, `api-orders-after-pages` unstable the same way.
- With `--differences heldout-differences.json --scenario <id>`: both exit 0, verdict `unchanged`, 98 of 98 and 45 of
  45 steps unchanged, no limitations.
- A broken copy (R09: the descending sort also reversed the tie-break) compared against the original's captures:
  `heldout-api` exit 1 with `list-price-desc-tie` and `list-price-desc-last-page` changed and every other step
  unchanged; `heldout-pages` exit 1 with only `page-catalogue-sorted` changed. All three are R09 steps, so R09 alone
  disagrees.

Two things in the first drafts made correct instances compare badly, and the material avoids them:

- Replies with `Cache-Control: no-store` lost their bodies at random in the capture: 11 of 99 requests in one capture
  ended `net::ERR_ABORTED`, about a dozen steps per scenario came out `unknown` (`not-recorded`) and created records
  came out `changed` on `/uid` because only one capture held a body. Without the header: 0 of 99. The application
  sends no `Cache-Control` except `no-cache` on the ETag route.
- A form POST with an empty body (the checkout button alone) was `unknown` on both sides (`request` `not-recorded`):
  the capture does not expose an empty request body. The checkout and delete forms carry a hidden `confirm=yes`.
