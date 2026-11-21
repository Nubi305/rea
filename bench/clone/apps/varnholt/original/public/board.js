/* Varnholt manifests board. */
(function () {
  const D = window.Desk;

  function show(list) {
    const rows = document.getElementById("rows");
    rows.textContent = "";
    list.items.forEach(function (m) {
      const tr = document.createElement("tr");
      D.linkCell(tr, "/manifest?id=" + m.id, m.code);
      D.cell(tr, m.destination);
      D.cell(tr, D.label(m.status));
      D.cell(tr, String(m.parcelCount));
      D.cell(tr, D.weight(m.totalWeightKg));
      D.cell(tr, D.weight(m.remainingKg));
      D.cell(tr, D.money(m.totalChargeCents));
      rows.appendChild(tr);
    });
    D.set("count", list.total === 1 ? "1 manifest" : list.total + " manifests");
  }

  function load() {
    const status = document.getElementById("filter-status").value;
    const q = document.getElementById("filter-q").value.trim();
    const query = [];
    if (status) query.push("status=" + encodeURIComponent(status));
    if (q) query.push("q=" + encodeURIComponent(q));
    return D.call("GET", "/api/manifests" + (query.length ? "?" + query.join("&") : "")).then(function (r) {
      if (r.ok) show(r.data);
      else D.fail(r.data);
    });
  }

  document.getElementById("filter").addEventListener("submit", function (event) {
    event.preventDefault();
    D.notice("status", "");
    load();
  });

  document.getElementById("create").addEventListener("submit", function (event) {
    event.preventDefault();
    const body = {
      code: document.getElementById("new-code").value,
      destination: document.getElementById("new-destination").value,
    };
    const capacity = document.getElementById("new-capacity").value.trim();
    if (capacity !== "") body.capacityKg = Number(capacity);
    D.call("POST", "/api/manifests", body).then(function (r) {
      if (!r.ok) return D.fail(r.data);
      document.getElementById("create").reset();
      return load().then(function () {
        D.notice("status", "Created manifest " + r.data.code);
      });
    });
  });

  show(D.boot().manifests);
})();
