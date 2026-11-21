// Writes hidden/rules.json and checks every cited step exists and every rule is shown.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
// The hidden folder: the parent of this script's folder, wherever it is.
const H = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const A = "heldout-api", P = "heldout-pages";
const R = (id, difficulty, rule, api = [], pages = []) => ({
  id, difficulty, rule,
  cases: [...(api.length ? [{ scenario: A, step_ids: api }] : []), ...(pages.length ? [{ scenario: P, step_ids: pages }] : [])],
});
const rules = [
  R("R01-sku-normalised", "visible", "A SKU is trimmed and upper-cased, then must be three letters, a dash and four digits (422 sku_format), and the SKU is the first field checked.",
    ["variety-create-normalised", "variety-sku-format", "variety-first-error-wins"], ["form-errors-kept-values", "form-created-redirect"]),
  R("R02-sku-unique-ignoring-case", "edge", "A SKU already held by another variety is refused whatever its case, on create and on edit (409 sku_taken with existingId); a variety may keep its own SKU.",
    ["variety-sku-taken-case", "variety-edit-sku-taken", "variety-edit-no-change"], ["page-edit-sku-taken"]),
  R("R03-name-collapsed-3-to-32", "edge", "A name is trimmed with inner whitespace collapsed to one space, and must then have 3 to 32 characters (422 name_length).",
    ["variety-create-normalised", "variety-name-short", "variety-name-long", "variety-name-max"]),
  R("R04-kind-normalised", "edge", "A kind is trimmed and lower-cased and must be vegetable, herb or flower, both on records (422 kind_invalid) and in the list filter.",
    ["variety-create-normalised", "variety-kind-invalid", "list-kind-all-statuses", "list-kind-invalid"]),
  R("R05-price-to-nearest-5-cents", "edge", "A price in euros (string or number, at most three decimals, no comma) is rounded to the nearest 5 cents, halves up.",
    ["variety-create-normalised", "variety-price-round-down", "variety-price-format"]),
  R("R06-price-range-after-rounding", "edge", "The rounded price must be from 0.50 to 50.00 euros (422 price_range), so 0.47 is refused, 0.48 becomes 0.50 and 50.024 becomes 50.00 while 50.025 is refused.",
    ["variety-price-below-range", "variety-price-range-edge-stock-default", "variety-price-upper-edge", "variety-price-above-range"]),
  R("R07-stock-field", "edge", "Stock is a whole number from 0 to 999 and defaults to 0; status defaults to active.",
    ["variety-price-range-edge-stock-default", "variety-stock-invalid"]),
  R("R08-catalogue-default-order", "visible", "The catalogue lists active varieties by name without letter case (then id), four to a page.",
    ["fp-varieties", "fp-varieties-page-2", "fp-varieties-page-3"], ["page-catalogue"]),
  R("R09-sort-tie-break", "edge", "Sorting by price, stock or SKU orders the primary key in the asked direction but always breaks ties by name ascending without case, then id.",
    ["list-price-asc-tie", "list-price-desc-tie", "list-price-desc-last-page"], ["page-catalogue-sorted"]),
  R("R10-page-clamped", "edge", "A page past the end shows the last page and a page that is not a positive whole number shows page 1, never an error.",
    ["list-page-clamp-high", "list-page-clamp-junk"], ["page-catalogue-clamped"]),
  R("R11-sort-fallback", "edge", "Sort and direction are read without case; an unknown sort means name and an unknown direction means ascending, never an error.",
    ["list-sort-unknown", "list-sku-desc"]),
  R("R12-search", "visible", "The search text is trimmed and matched without case against name or SKU.",
    ["list-search-name", "list-search-sku"], ["page-catalogue-search"]),
  R("R13-retired-hidden", "edge", "Retired varieties are left out of the list unless status=retired or status=all is asked; another status is 422 status_invalid.",
    ["list-search-retired-hidden", "list-status-retired", "list-kind-all-statuses", "list-status-invalid"]),
  R("R14-basket-quantity-and-merge", "edge", "A basket quantity is a whole number from 1 to 12 (422 qty_invalid); adding a variety already in the basket adds to its line, and a line may not pass 12 packets (409 line_limit with inBasket).",
    ["basket-add-qty-zero", "basket-add-qty-over", "basket-add-basil", "basket-merge-bulk-discount", "basket-line-limit"], ["page-add-refused-kept"]),
  R("R15-basket-retired-or-unknown", "visible", "A retired variety cannot be added (409 variety_retired) and an unknown one is 404 variety_not_found.",
    ["basket-add-retired", "basket-add-unknown"]),
  R("R16-basket-stock", "edge", "A basket line may not hold more packets than the variety's stock, on add (judged on the merged total) and on a quantity change (409 out_of_stock with available and requested).",
    ["basket-add-sold-out", "basket-over-stock", "basket-set-over-stock"]),
  R("R17-basket-five-lines", "multi-step", "A basket holds at most five varieties (409 basket_full), but adding to a variety already in a full basket is allowed.",
    ["basket-full", "basket-merge-when-full"]),
  R("R18-bulk-discount", "edge", "A line of six or more packets gets 10% off that line, rounded down to the cent.",
    ["basket-merge-bulk-discount", "promo-minimum-again"], ["page-basket-bulk"]),
  R("R19-basket-line-order", "edge", "Basket lines are listed by line total descending, ties by SKU ascending, not in the order they were added.",
    ["basket-line-order-tie", "basket-merge-when-full", "promo-minimum-again"]),
  R("R20-promo-codes", "multi-step", "Codes are trimmed and read without case; HERBS20 takes 20% of the herb lines (half up), SPRING5 takes 5.00 euros and is refused below 15.00 of goods (409 promo_minimum); a new code replaces the old one; unknown is 422 promo_unknown.",
    ["promo-unknown", "promo-herbs", "promo-spring-replaces"], ["page-promo-minimum", "page-promo-applied"]),
  R("R21-promo-kept-when-below-minimum", "multi-step", "A SPRING5 code stays on the basket when its goods drop below 15.00 but gives nothing (applied false) until they reach it again.",
    ["promo-below-minimum-kept", "promo-minimum-again"]),
  R("R22-shipping", "multi-step", "Shipping is 3.50 euros when goods after the code are under 25.00 and free from 25.00; an empty basket pays nothing.",
    ["basket-add-basil", "promo-herbs", "basket-live-price-free-shipping", "checkout-empties-basket"], ["page-promo-applied"]),
  R("R23-live-price-snapshot-order", "multi-step", "A basket prices its lines at the variety's current price, while an order keeps the prices it was placed at.",
    ["basket-live-price-free-shipping", "order-prices-snapshot"]),
  R("R24-checkout", "visible", "Checkout turns the basket into an order SL-(1000+id) in status placed, takes its packets from stock, empties the basket and drops its code; an empty basket is 409 basket_empty.",
    ["checkout-places-order", "checkout-empties-basket", "checkout-empty-refused", "stock-taken-at-checkout"], ["page-order-placed", "page-variety-after-order"]),
  R("R25-checkout-rechecks", "multi-step", "Checkout checks each line again in basket order, refusing a retired variety (variety_retired) or a line above current stock (out_of_stock), and changes nothing when it refuses.",
    ["checkout-stock-rechecked", "checkout-retired-first-line"]),
  R("R26-order-state-machine", "multi-step", "Orders go placed to packed or cancelled, packed to shipped or cancelled; shipped and cancelled are final; anything else is 409 invalid_transition with from, to and allowed, and a non-status is 422.",
    ["order-skip-refused", "order-status-unknown", "order-pack", "order-back-refused", "order-same-refused", "order-cancelled-final", "order-shipped-final"], ["page-order-packed"]),
  R("R27-cancel-restores-stock", "multi-step", "Cancelling an order puts its packets back into stock.",
    ["order-cancel-packed", "cancel-restores-stock"]),
  R("R28-delete-variety", "multi-step", "A variety on any order cannot be deleted (409 variety_in_use with the order count); deleting another removes it from every basket and reports how many lines went.",
    ["variety-delete-in-use", "variety-delete-in-use-placed", "variety-delete-cascades-basket", "basket-after-cascade"]),
  R("R29-revision-and-etag", "multi-step", "A variety's rev and ETag \"v<id>.<rev>\" change only when a stored value changes (stock taken at checkout included); a matching If-None-Match gets 304.",
    ["etag-not-modified", "variety-edit-no-change", "etag-unchanged-after-no-op", "variety-edit-price", "etag-changed-after-edit", "stock-taken-at-checkout", "cancel-restores-stock"]),
  R("R30-orders-list", "visible", "Orders list newest first, filter by status without case (422 for an unknown status), and an unknown order is 404.",
    ["fp-orders", "orders-newest-first", "orders-filter-status", "orders-filter-invalid", "order-missing"], ["page-orders"]),
  R("R31-protocol", "visible", "Unknown routes answer 404 (JSON under /api, a page elsewhere) and a known route with a wrong method answers 405 listing the allowed methods.",
    ["route-unknown", "method-not-allowed", "method-not-allowed-collection"], ["page-missing"]),
  R("R32-forms-keep-values", "visible", "A refused form is shown again with every problem listed, the fields marked and the typed values kept.",
    [], ["form-errors-kept-values", "page-edit-sku-taken", "page-add-refused-kept", "page-promo-minimum"]),
  R("R33-post-redirect-get", "visible", "A successful form post redirects to a page that shows a notice: the new variety, the variety with its basket count, the basket, the order.",
    [], ["form-created-redirect", "page-added-notice", "page-promo-applied", "page-order-placed", "page-order-packed"]),
];
const steps = {};
for (const sc of [A, P]) steps[sc] = JSON.parse(fs.readFileSync(`${H}/${sc}.json`, "utf8")).actions.map((a) => a.step_id);
let bad = 0;
const cited = new Set();
for (const r of rules) {
  if (!r.cases.length) { console.log("no steps", r.id); bad++; }
  for (const c of r.cases) for (const s of c.step_ids) { if (!steps[c.scenario].includes(s)) { console.log("missing", r.id, c.scenario, s); bad++; } cited.add(c.scenario + "/" + s); }
}
const uncited = [];
for (const sc of [A, P]) for (const s of steps[sc]) if (!cited.has(sc + "/" + s) && !s.startsWith("setup-") && !s.startsWith("fp-")) uncited.push(sc + "/" + s);
fs.writeFileSync(`${H}/rules.json`, JSON.stringify({
  schema: "seedlark.hidden-rules/1",
  application: "Seedlark",
  scoring: "A rule agrees when every step it cites is unchanged in a comparison of the original's captures (left) with the clone's (right), using heldout-differences.json plus the clone's name rename; it disagrees when any cited step is changed, and is undecided when a cited step is unknown or unstable.",
  scenarios: { [A]: "heldout-api.json", [P]: "heldout-pages-portable.json" },
  differences: "heldout-differences.json",
  rules,
}, null, 2) + "\n");
console.log("rules", rules.length, "bad", bad, "uncited behaviour steps", uncited.join(" "));
