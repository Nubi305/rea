/* Varnholt summary page: totals derived from every manifest and parcel. */
(function () {
  const D = window.Desk;
  const s = D.boot().summary;
  D.set("s-manifests", String(s.manifests.total));
  D.set("s-open", String(s.manifests.open));
  D.set("s-sealed", String(s.manifests.sealed));
  D.set("s-dispatched", String(s.manifests.dispatched));
  D.set("s-delivered", String(s.manifests.delivered));
  D.set("s-parcels", String(s.parcels));
  D.set("s-fragile", String(s.fragileParcels));
  D.set("s-weight", D.weight(s.totalWeightKg));
  D.set("s-transit", D.weight(s.inTransitWeightKg));
  D.set("s-average", s.averageParcelWeightKg.toFixed(2) + " kg");
  D.set("s-charges", D.money(s.totalChargeCents));
  D.set("s-heaviest", s.heaviest ? s.heaviest.code + " at " + D.weight(s.heaviest.totalWeightKg) : "None");
  document.getElementById("totals").hidden = false;
})();
