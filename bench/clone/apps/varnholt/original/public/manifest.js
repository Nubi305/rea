/* Varnholt manifest page: status changes, parcels, edits and deletion. */
(function () {
  const D = window.Desk;
  const id = new URLSearchParams(location.search).get("id") || "";
  const ACTIONS = {
    open: [["Seal manifest", "sealed"]],
    sealed: [["Reopen manifest", "open"], ["Dispatch manifest", "dispatched"]],
    dispatched: [["Mark delivered", "delivered"]],
    delivered: [],
  };

  function showManifest(m) {
    document.title = "Manifest " + m.code + " - Varnholt";
    D.set("heading", "Manifest " + m.code);
    D.set("f-destination", m.destination);
    D.set("f-status", D.label(m.status));
    D.set("f-capacity", m.capacityKg + " kg");
    D.set("f-loaded", D.weight(m.totalWeightKg));
    D.set("f-room", D.weight(m.remainingKg));
    D.set("f-charges", D.money(m.totalChargeCents));
    const actions = document.getElementById("actions");
    actions.textContent = "";
    ACTIONS[m.status].forEach(function (pair) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[0];
      button.addEventListener("click", function () {
        D.call("PUT", "/api/manifests/" + id + "/status", { status: pair[1] }).then(function (r) {
          if (!r.ok) return D.fail(r.data);
          return load().then(function () {
            D.notice("status", "Manifest is now " + r.data.status);
          });
        });
      });
      actions.appendChild(button);
    });
    document.getElementById("detail").hidden = false;
  }

  function showParcels(list) {
    const rows = document.getElementById("rows");
    rows.textContent = "";
    list.items.forEach(function (p) {
      const tr = document.createElement("tr");
      D.linkCell(tr, "/parcel?id=" + p.id, p.recipient);
      D.cell(tr, D.weight(p.weightKg));
      D.cell(tr, p.fragile ? "Yes" : "No");
      D.cell(tr, D.money(p.chargeCents));
      rows.appendChild(tr);
    });
    D.set("parcel-count", list.total + " of 6 parcels");
  }

  function missing(data) {
    document.getElementById("detail").hidden = true;
    D.set("heading", "Manifest");
    D.fail(data);
  }

  function load() {
    return Promise.all([
      D.call("GET", "/api/manifests/" + encodeURIComponent(id)),
      D.call("GET", "/api/parcels?manifestId=" + encodeURIComponent(id)),
    ]).then(function (both) {
      if (!both[0].ok) return missing(both[0].data);
      showManifest(both[0].data);
      if (both[1].ok) showParcels(both[1].data);
    });
  }

  document.getElementById("add").addEventListener("submit", function (event) {
    event.preventDefault();
    const body = {
      manifestId: Number(id),
      recipient: document.getElementById("p-recipient").value,
      weightKg: D.numberOrNull(document.getElementById("p-weight").value),
      fragile: document.getElementById("p-fragile").checked,
    };
    D.call("POST", "/api/parcels", body).then(function (r) {
      if (!r.ok) return D.fail(r.data);
      document.getElementById("add").reset();
      return load().then(function () {
        D.notice("status", "Added " + r.data.recipient + ", " + D.money(r.data.chargeCents));
      });
    });
  });

  document.getElementById("edit").addEventListener("submit", function (event) {
    event.preventDefault();
    const body = {};
    const code = document.getElementById("e-code").value;
    const destination = document.getElementById("e-destination").value;
    const capacity = document.getElementById("e-capacity").value.trim();
    if (code.trim() !== "") body.code = code;
    if (destination.trim() !== "") body.destination = destination;
    if (capacity !== "") body.capacityKg = Number(capacity);
    D.call("PUT", "/api/manifests/" + id, body).then(function (r) {
      if (!r.ok) return D.fail(r.data);
      document.getElementById("edit").reset();
      return load().then(function () {
        D.notice("status", "Saved manifest " + r.data.code);
      });
    });
  });

  document.getElementById("delete").addEventListener("click", function () {
    D.call("DELETE", "/api/manifests/" + id).then(function (r) {
      if (!r.ok) return D.fail(r.data);
      document.getElementById("detail").hidden = true;
      D.set("heading", "Manifest");
      D.notice("status", "Deleted the manifest and " + r.data.parcelsRemoved + " of its parcels");
    });
  });

  const boot = D.boot();
  if (boot.manifest.ok) {
    showManifest(boot.manifest.data);
    showParcels(boot.parcels);
  } else {
    missing(boot.manifest.data);
  }
})();
