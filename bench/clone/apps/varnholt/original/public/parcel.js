/* Varnholt parcel page: edit and delete one parcel. */
(function () {
  const D = window.Desk;
  const id = new URLSearchParams(location.search).get("id") || "";

  function show(p) {
    document.title = "Parcel for " + p.recipient + " - Varnholt";
    D.set("heading", "Parcel for " + p.recipient);
    D.set("f-weight", D.weight(p.weightKg));
    D.set("f-fragile", p.fragile ? "Yes" : "No");
    D.set("f-charge", D.money(p.chargeCents));
    document.getElementById("e-fragile").checked = p.fragile;
    document.getElementById("detail").hidden = false;
  }

  function gone(data) {
    document.getElementById("detail").hidden = true;
    D.set("heading", "Parcel");
    D.fail(data);
  }

  document.getElementById("edit").addEventListener("submit", function (event) {
    event.preventDefault();
    const body = { fragile: document.getElementById("e-fragile").checked };
    const recipient = document.getElementById("e-recipient").value;
    const weight = document.getElementById("e-weight").value.trim();
    if (recipient.trim() !== "") body.recipient = recipient;
    if (weight !== "") body.weightKg = D.numberOrNull(weight);
    D.call("PUT", "/api/parcels/" + id, body).then(function (r) {
      if (!r.ok) return D.fail(r.data);
      document.getElementById("e-recipient").value = "";
      document.getElementById("e-weight").value = "";
      show(r.data);
      D.notice("status", "Saved, charge is now " + D.money(r.data.chargeCents));
    });
  });

  document.getElementById("delete").addEventListener("click", function () {
    D.call("DELETE", "/api/parcels/" + id).then(function (r) {
      if (!r.ok) return D.fail(r.data);
      document.getElementById("detail").hidden = true;
      D.set("heading", "Parcel");
      D.notice("status", "Deleted the parcel");
    });
  });

  const boot = D.boot();
  if (boot.parcel.ok) {
    const link = document.getElementById("f-manifest");
    link.href = "/manifest?id=" + boot.manifest.id;
    link.textContent = boot.manifest.code + " to " + boot.manifest.destination;
    show(boot.parcel.data);
  } else {
    gone(boot.parcel.data);
  }
})();
