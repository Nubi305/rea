/* Varnholt shared client helpers: JSON calls, notices and formatting. */
window.Desk = (function () {
  const MESSAGES = {
    code_required: "Enter a code",
    code_format: "A code looks like AB-123",
    code_taken: "That code is already in use",
    destination_required: "Enter a destination",
    destination_length: "A destination has 2 to 60 characters",
    capacity_invalid: "Capacity is a whole number from 1 to 200",
    capacity_below_load: "Capacity cannot drop below what is loaded",
    recipient_required: "Enter a recipient",
    recipient_length: "A recipient has 2 to 40 characters",
    recipient_duplicate: "This manifest already has a parcel for that recipient",
    weight_invalid: "Enter a weight above zero",
    weight_over_limit: "A parcel weighs at most 30 kg",
    capacity_exceeded: "That parcel does not fit on this manifest",
    manifest_full: "A manifest carries at most 6 parcels",
    manifest_locked: "Only an open manifest can be changed",
    manifest_empty: "An empty manifest cannot be sealed",
    manifest_in_transit: "A dispatched manifest cannot be deleted",
    invalid_transition: "That status change is not allowed",
    manifest_not_found: "This manifest no longer exists",
    parcel_not_found: "This parcel no longer exists",
  };

  function call(method, path, body) {
    const options = { method: method, headers: {} };
    if (body !== undefined) {
      options.headers["content-type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function notice(role, text) {
    const box = document.getElementById("notice");
    box.textContent = "";
    if (!text) return;
    const line = document.createElement("p");
    line.setAttribute("role", role);
    line.textContent = text;
    box.appendChild(line);
  }

  function fail(data) {
    notice("alert", MESSAGES[data.error] || data.message || "Something went wrong");
  }

  function money(cents) {
    const whole = Math.floor(cents / 100);
    const rest = String(cents % 100).padStart(2, "0");
    return "$" + whole + "." + rest;
  }

  function weight(kg) {
    return kg.toFixed(1) + " kg";
  }

  function label(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function cell(row, text) {
    const td = document.createElement("td");
    td.textContent = text;
    row.appendChild(td);
    return td;
  }

  function linkCell(row, href, text) {
    const td = document.createElement("td");
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    td.appendChild(a);
    row.appendChild(td);
  }

  function set(id, text) {
    document.getElementById(id).textContent = text;
  }

  function numberOrNull(text) {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }

  function boot() {
    return JSON.parse(document.getElementById("boot").textContent);
  }

  return {
    boot: boot, call: call, notice: notice, fail: fail, money: money, weight: weight, label: label,
    cell: cell, linkCell: linkCell, set: set, numberOrNull: numberOrNull,
  };
})();
