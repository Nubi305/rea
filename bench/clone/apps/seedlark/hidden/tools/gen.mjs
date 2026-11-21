// Writes the held-out scenarios into the hidden folder.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
// The hidden folder: the parent of this script's folder, wherever it is.
const H = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const req = (step_id, method, path, json, inm) => {
  const s = { step_id, action: "request", method, path };
  if (inm) s.headers = [{ name: "If-None-Match", value: { source: "literal", value: inm } }];
  if (json !== undefined) s.json = json;
  s.timeout_ms = 15000;
  return s;
};
const G = (id, p) => req(id, "GET", p);
const api = [
  G("fp-varieties", "/api/varieties"),
  G("fp-varieties-page-2", "/api/varieties?page=2"),
  G("fp-varieties-page-3", "/api/varieties?page=3"),
  G("fp-orders", "/api/orders"),
  G("fp-basket", "/api/basket"),
  G("list-price-asc-tie", "/api/varieties?sort=price"),
  G("list-price-desc-tie", "/api/varieties?sort=price&dir=desc"),
  G("list-price-desc-last-page", "/api/varieties?sort=price&dir=desc&page=3"),
  G("list-sku-desc", "/api/varieties?sort=SKU&dir=DESC"),
  G("list-page-clamp-high", "/api/varieties?page=99"),
  G("list-page-clamp-junk", "/api/varieties?page=-2"),
  G("list-sort-unknown", "/api/varieties?sort=colour&dir=sideways"),
  G("list-search-name", "/api/varieties?q=%20PEA%20"),
  G("list-search-sku", "/api/varieties?q=0815"),
  G("list-search-retired-hidden", "/api/varieties?q=zin"),
  G("list-status-retired", "/api/varieties?status=retired"),
  G("list-kind-all-statuses", "/api/varieties?kind=FLOWER&status=all"),
  G("list-kind-invalid", "/api/varieties?kind=tree"),
  G("list-status-invalid", "/api/varieties?status=gone"),
  req("variety-create-normalised", "POST", "/api/varieties", { sku: "  bee-0042 ", name: "  Borage   Blue  ", kind: " HERB ", price: "2.425", stock: 7 }),
  req("variety-price-round-down", "POST", "/api/varieties", { sku: "LEM-0001", name: "Lemon Balm", kind: "herb", price: 2.42, stock: 3 }),
  req("variety-price-below-range", "POST", "/api/varieties", { sku: "MIN-0047", name: "Tiny Price", kind: "flower", price: "0.47" }),
  req("variety-price-range-edge-stock-default", "POST", "/api/varieties", { sku: "MIN-0048", name: "Tiny Price", kind: "flower", price: "0.48" }),
  req("variety-price-upper-edge", "POST", "/api/varieties", { sku: "MAX-5002", name: "Gold Seed", kind: "flower", price: "50.024" }),
  req("variety-price-above-range", "POST", "/api/varieties", { sku: "MAX-5003", name: "Gold Seed", kind: "flower", price: "50.025" }),
  req("variety-price-format", "POST", "/api/varieties", { sku: "COM-0001", name: "Comma Price", kind: "herb", price: "2,40" }),
  req("variety-sku-taken-case", "POST", "/api/varieties", { sku: "tom-0101", name: "Another Tomato", kind: "vegetable", price: "3" }),
  req("variety-sku-format", "POST", "/api/varieties", { sku: "TO-101", name: "Short Sku", kind: "vegetable", price: "3" }),
  req("variety-name-short", "POST", "/api/varieties", { sku: "NAM-0001", name: "  Ab   ", kind: "herb", price: "3" }),
  req("variety-name-long", "POST", "/api/varieties", { sku: "NAM-0002", name: "Abcdefghij Abcdefghij Abcdefghijk", kind: "herb", price: "3" }),
  req("variety-name-max", "POST", "/api/varieties", { sku: "NAM-0003", name: "Abcdefghij   Abcdefghij Abcdefghij", kind: "herb", price: "3" }),
  req("variety-kind-invalid", "POST", "/api/varieties", { sku: "KIN-0001", name: "Box Hedge", kind: "shrub", price: "3" }),
  req("variety-stock-invalid", "POST", "/api/varieties", { sku: "STK-0001", name: "Many Seeds", kind: "herb", price: "3", stock: 1000 }),
  req("variety-first-error-wins", "POST", "/api/varieties", { sku: "x", name: "y", kind: "z", price: "0" }),
  G("variety-read-created", "/api/varieties/13"),
  req("etag-not-modified", "GET", "/api/varieties/1", undefined, '"v1.1"'),
  req("variety-edit-no-change", "PUT", "/api/varieties/1", { name: "  Brandywine   Tomato ", sku: "tom-0101" }),
  req("etag-unchanged-after-no-op", "GET", "/api/varieties/1", undefined, '"v1.1"'),
  req("variety-edit-sku-taken", "PUT", "/api/varieties/1", { sku: "bas-0204" }),
  req("variety-edit-price", "PUT", "/api/varieties/1", { price: "3.50" }),
  req("etag-changed-after-edit", "GET", "/api/varieties/1", undefined, '"v1.1"'),
  req("basket-add-retired", "POST", "/api/basket/lines", { varietyId: 9, qty: 1 }),
  req("basket-add-qty-zero", "POST", "/api/basket/lines", { varietyId: 2, qty: 0 }),
  req("basket-add-qty-over", "POST", "/api/basket/lines", { varietyId: 2, qty: 13 }),
  req("basket-add-sold-out", "POST", "/api/basket/lines", { varietyId: 5, qty: 1 }),
  req("basket-add-unknown", "POST", "/api/basket/lines", { varietyId: 99, qty: 1 }),
  req("basket-add-basil", "POST", "/api/basket/lines", { varietyId: 2, qty: 4 }),
  req("basket-merge-bulk-discount", "POST", "/api/basket/lines", { varietyId: 2, qty: 3 }),
  req("basket-line-limit", "POST", "/api/basket/lines", { varietyId: 2, qty: 6 }),
  req("basket-over-stock", "POST", "/api/basket/lines", { varietyId: 6, qty: 9 }),
  req("basket-add-sweet-pea", "POST", "/api/basket/lines", { varietyId: 6, qty: 2 }),
  req("promo-unknown", "POST", "/api/basket/promo", { code: "FREESEEDS" }),
  req("promo-herbs", "POST", "/api/basket/promo", { code: "  herbs20 " }),
  req("basket-live-price-free-shipping", "POST", "/api/basket/lines", { varietyId: 1, qty: 3 }),
  req("promo-spring-replaces", "POST", "/api/basket/promo", { code: "spring5" }),
  req("basket-add-carrot", "POST", "/api/basket/lines", { varietyId: 4, qty: 1 }),
  req("basket-line-order-tie", "POST", "/api/basket/lines", { varietyId: 3, qty: 1 }),
  req("basket-full", "POST", "/api/basket/lines", { varietyId: 8, qty: 1 }),
  req("basket-merge-when-full", "POST", "/api/basket/lines", { varietyId: 4, qty: 1 }),
  req("setup-remove-basil", "DELETE", "/api/basket/lines/2"),
  req("promo-below-minimum-kept", "DELETE", "/api/basket/lines/1"),
  req("basket-remove-missing", "DELETE", "/api/basket/lines/2"),
  req("basket-set-over-stock", "PUT", "/api/basket/lines/6", { qty: 9 }),
  req("promo-minimum-again", "PUT", "/api/basket/lines/3", { qty: 6 }),
  req("setup-add-borage", "POST", "/api/basket/lines", { varietyId: 13, qty: 2 }),
  req("variety-delete-cascades-basket", "DELETE", "/api/varieties/13"),
  G("basket-after-cascade", "/api/basket"),
  req("variety-delete-in-use", "DELETE", "/api/varieties/1"),
  req("variety-delete-in-use-placed", "DELETE", "/api/varieties/4"),
  req("setup-shrink-sweet-pea", "PUT", "/api/varieties/6", { stock: 1 }),
  req("checkout-stock-rechecked", "POST", "/api/checkout"),
  req("setup-retire-calendula", "PUT", "/api/varieties/3", { status: " RETIRED " }),
  req("checkout-retired-first-line", "POST", "/api/checkout"),
  req("setup-reactivate-calendula", "PUT", "/api/varieties/3", { status: "active" }),
  req("setup-restore-sweet-pea", "PUT", "/api/varieties/6", { stock: 8 }),
  req("checkout-places-order", "POST", "/api/checkout"),
  G("checkout-empties-basket", "/api/basket"),
  req("checkout-empty-refused", "POST", "/api/checkout"),
  G("stock-taken-at-checkout", "/api/varieties/3"),
  req("setup-reprice-sweet-pea", "PUT", "/api/varieties/6", { price: "4.00" }),
  G("order-prices-snapshot", "/api/orders/4"),
  req("order-skip-refused", "PUT", "/api/orders/4/status", { status: "shipped" }),
  req("order-status-unknown", "PUT", "/api/orders/4/status", { status: "lost" }),
  req("order-pack", "PUT", "/api/orders/4/status", { status: " PACKED " }),
  req("order-back-refused", "PUT", "/api/orders/4/status", { status: "placed" }),
  req("order-same-refused", "PUT", "/api/orders/4/status", { status: "packed" }),
  req("order-cancel-packed", "PUT", "/api/orders/4/status", { status: "cancelled" }),
  G("cancel-restores-stock", "/api/varieties/3"),
  req("order-cancelled-final", "PUT", "/api/orders/4/status", { status: "packed" }),
  req("order-shipped-final", "PUT", "/api/orders/1/status", { status: "cancelled" }),
  G("orders-newest-first", "/api/orders"),
  G("orders-filter-status", "/api/orders?status=CANCELLED"),
  G("orders-filter-invalid", "/api/orders?status=lost"),
  G("order-missing", "/api/orders/99"),
  G("route-unknown", "/api/seeds"),
  req("method-not-allowed", "PATCH", "/api/varieties/1", { name: "x" }),
  req("method-not-allowed-collection", "DELETE", "/api/orders"),
];
fs.writeFileSync(H + "/heldout-api.json", JSON.stringify({ start_path: "/", actions: api }, null, 2) + "\n");

const goto = (step_id, p) => ({ step_id, action: "goto", destination: { url: "{origin}" + p }, wait_until: "load", timeout_ms: 15000 });
const role = (r, name) => ({ kind: "role", role: r, name });
const fill = (step_id, label, value) => ({ step_id, action: "fill", locator: role("textbox", label), value: { source: "literal", value }, timeout_ms: 15000 });
const pick = (step_id, label, value) => ({ step_id, action: "select_option", locator: role("combobox", label), value: { source: "literal", value }, timeout_ms: 15000 });
const click = (step_id, name) => ({ step_id, action: "click", locator: role("button", name), timeout_ms: 15000 });
const waitCss = (step_id, selector) => ({ step_id, action: "wait_for", locator: { kind: "css", selector }, state: "visible", timeout_ms: 15000 });
const pages = [
  req("fp-varieties", "GET", "/api/varieties"),
  goto("fp-home", "/"),
  goto("page-catalogue", "/varieties"),
  goto("page-catalogue-sorted", "/varieties?sort=price&dir=desc&page=2"),
  goto("page-catalogue-search", "/varieties?q=%20KALE%20"),
  goto("page-catalogue-clamped", "/varieties?page=7"),
  goto("page-new-form", "/varieties/new"),
  fill("setup-fill-sku", "SKU", "bee-1"),
  fill("setup-fill-name", "Name", "  Borage   Blue "),
  pick("setup-pick-kind", "Kind", "herb"),
  fill("setup-fill-price", "Price in euros", "0.47"),
  fill("setup-fill-stock", "Stock", "lots"),
  click("setup-submit-invalid", "Create variety"),
  waitCss("form-errors-kept-values", "[data-alert=form]"),
  fill("setup-fix-sku", "SKU", "bee-0042"),
  fill("setup-fix-price", "Price in euros", "2.425"),
  fill("setup-fix-stock", "Stock", "7"),
  click("setup-submit-valid", "Create variety"),
  waitCss("form-created-redirect", "[data-notice=created]"),
  fill("setup-qty-too-many", "Quantity", "13"),
  click("setup-add-too-many", "Add to basket"),
  waitCss("page-add-refused-kept", "[data-alert=add]"),
  fill("setup-qty-six", "Quantity", "6"),
  click("setup-add-six", "Add to basket"),
  waitCss("page-added-notice", "[data-notice=added]"),
  goto("page-basket-bulk", "/basket"),
  fill("setup-code-spring", "Promotion code", "spring5"),
  click("setup-apply-spring", "Apply code"),
  waitCss("page-promo-minimum", "[data-alert=basket]"),
  fill("setup-code-herbs", "Promotion code", "herbs20"),
  click("setup-apply-herbs", "Apply code"),
  waitCss("page-promo-applied", "[data-notice=applied]"),
  click("setup-place-order", "Place order"),
  waitCss("page-order-placed", "[data-notice=placed]"),
  click("setup-mark-packed", "Mark packed"),
  waitCss("page-order-packed", "[data-notice=changed]"),
  goto("page-orders", "/orders"),
  goto("page-variety-after-order", "/varieties/13"),
  goto("page-edit-form", "/varieties/2/edit"),
  fill("setup-edit-sku", "SKU", "chv-0815"),
  click("setup-edit-save", "Save changes"),
  waitCss("page-edit-sku-taken", "[data-alert=form]"),
  goto("page-missing", "/varieties/99"),
  req("api-orders-after-pages", "GET", "/api/orders"),
];
fs.writeFileSync(H + "/heldout-pages.json", JSON.stringify({ start_path: "/", actions: pages }, null, 2) + "\n");
// heldout-pages.json waits on this application's own data attributes ([data-alert=...], [data-notice=...]), which a
// clean-room clone does not have: the wait fails there and no later step runs. heldout-pages-portable.json is the same
// scenario with each of those waits finding the element by its role instead: every page these steps reach holds one
// alert or one status and no other. Nothing else changes, and rules.json replays the portable file.
const portableWait = (selector) => (selector.startsWith("[data-alert=") ? "[role=alert]" : selector.startsWith("[data-notice=") ? "[role=status]" : null);
const portablePages = pages.map((a) => {
  if (a.locator?.kind !== "css") return a;
  const selector = portableWait(a.locator.selector);
  if (selector === null) throw new Error(`${a.step_id}: no portable wait for ${a.locator.selector}`);
  return { ...a, locator: { kind: "css", selector } };
});
fs.writeFileSync(H + "/heldout-pages-portable.json", JSON.stringify({ start_path: "/", actions: portablePages }, null, 2) + "\n");
console.log(api.length, pages.length);
