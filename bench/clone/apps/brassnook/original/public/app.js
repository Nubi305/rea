// Brassnook client: every page is built here from the JSON API.
(function () {
  "use strict";
  var main = document.getElementById("main");
  var page = document.body.getAttribute("data-page");
  var params = new URLSearchParams(location.search);

  var STATUS_LABEL = { tentative: "Tentative", confirmed: "Confirmed", checked_in: "Checked in", completed: "Completed", cancelled: "Cancelled" };
  var ACTION_LABEL = { confirmed: "Confirm booking", checked_in: "Check in", completed: "Mark completed", cancelled: "Cancel booking" };
  var NEXT = { tentative: ["confirmed", "cancelled"], confirmed: ["checked_in", "cancelled"], checked_in: ["completed"], completed: [], cancelled: [] };
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(cents) {
    return "£" + (cents / 100).toFixed(2);
  }
  function dayLabel(date) {
    return WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()] + " " + date;
  }
  function api(method, path, body) {
    var init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }
  function ready(title) {
    if (title) document.title = title + " · Brassnook";
    main.removeAttribute("aria-busy");
    document.body.setAttribute("data-ready", "1");
  }
  function errorText(r) {
    return "Refused (" + r.status + " " + r.data.error + "): " + r.data.message;
  }
  function formValues(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === "checkbox") out[el.name] = el.checked;
      else if (el.getAttribute("data-kind") === "int") out[el.name] = el.value === "" ? undefined : Number(el.value);
      else out[el.name] = el.value;
    });
    return out;
  }
  function bookingRows(items) {
    return items
      .map(function (b) {
        return (
          "<tr><td><a href=\"/booking?id=" + b.id + "\">" + esc(b.ref) + "</a></td><td>" + esc(dayLabel(b.date)) + "</td><td>" + esc(b.start) + "–" + esc(b.end) +
          "</td><td>" + esc(b.roomName) + "</td><td>" + esc(b.band) + "</td><td>" + b.players + "</td><td>" + STATUS_LABEL[b.status] + "</td><td>" + money(b.totalCents) + "</td></tr>"
        );
      })
      .join("");
  }
  var BOOKING_HEAD = "<thead><tr><th>Ref</th><th>Day</th><th>Time</th><th>Room</th><th>Band</th><th>Players</th><th>Status</th><th>Price</th></tr></thead>";

  // ---------- rooms ----------
  function roomsPage() {
    api("GET", "/api/rooms").then(function (r) {
      var rows = r.data.items
        .map(function (room) {
          return (
            "<tr class=\"" + (room.active ? "" : "inactive") + "\"><td><a href=\"/room?id=" + room.id + "\">" + esc(room.name) + "</a></td><td>" + room.capacity +
            " players</td><td>" + money(room.rateCents) + " an hour</td><td>" + (room.active ? "Taking bookings" : "Closed to bookings") + "</td><td>" + room.openBookings + " open</td></tr>"
          );
        })
        .join("");
      main.innerHTML =
        "<h1>Brassnook rooms</h1><p>" + r.data.total + " rooms.</p><table><thead><tr><th>Room</th><th>Size</th><th>Rate</th><th>State</th><th>Bookings</th></tr></thead><tbody>" + rows + "</tbody></table>" +
        "<h2>Add a room</h2><form id=\"room-form\"><label for=\"rf-name\">Room name</label><input id=\"rf-name\" name=\"name\">" +
        "<label for=\"rf-cap\">Capacity</label><input id=\"rf-cap\" name=\"capacity\" data-kind=\"int\" value=\"4\">" +
        "<label for=\"rf-rate\">Rate in pence per hour</label><input id=\"rf-rate\" name=\"rateCents\" data-kind=\"int\" value=\"1500\">" +
        "<button type=\"submit\">Add room</button></form><p id=\"notice\" role=\"status\"></p>";
      document.getElementById("room-form").addEventListener("submit", function (ev) {
        ev.preventDefault();
        api("POST", "/api/rooms", formValues(ev.target)).then(function (res) {
          if (res.ok) location.href = "/room?id=" + res.data.id;
          else document.getElementById("notice").textContent = errorText(res);
        });
      });
      ready("Rooms");
    });
  }

  // ---------- one room ----------
  function roomPage() {
    var id = params.get("id");
    var date = params.get("date") || "2026-12-08";
    api("GET", "/api/rooms/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) {
        main.innerHTML = "<h1>Room not found</h1><p>No room has the number " + esc(id) + ".</p>";
        return ready("Room not found");
      }
      var room = r.data;
      api("GET", "/api/rooms/" + room.id + "/day?date=" + encodeURIComponent(date)).then(function (d) {
        var sheet;
        if (!d.ok) sheet = "<p>" + esc(errorText(d)) + "</p>";
        else if (d.data.closed) sheet = "<p>Closed on Sundays.</p>";
        else
          sheet =
            "<p>" + d.data.bookedMinutes + " minutes booked, " + d.data.utilisationPct.toFixed(1) + "% of opening hours.</p>" +
            (d.data.bookings.length ? "<table>" + BOOKING_HEAD + "<tbody>" + bookingRows(d.data.bookings) + "</tbody></table>" : "<p>No bookings.</p>") +
            "<h3>Free</h3><ul>" + d.data.freeSlots.map(function (s) { return "<li>" + s.start + " to " + s.end + "</li>"; }).join("") + "</ul>";
        main.innerHTML =
          "<h1>" + esc(room.name) + "</h1><p>Room " + room.id + " · " + esc(room.slug) + " · " + room.capacity + " players · " + money(room.rateCents) + " an hour · " +
          (room.active ? "taking bookings" : "closed to bookings") + "</p>" +
          "<h2>" + esc(dayLabel(date)) + "</h2>" + sheet +
          "<h2>Book this room</h2><form id=\"book-form\"><label for=\"bf-band\">Band</label><input id=\"bf-band\" name=\"band\">" +
          "<label for=\"bf-players\">Players</label><input id=\"bf-players\" name=\"players\" data-kind=\"int\" value=\"1\">" +
          "<label for=\"bf-date\">Date</label><input id=\"bf-date\" name=\"date\" value=\"" + esc(date) + "\">" +
          "<label for=\"bf-start\">Start</label><input id=\"bf-start\" name=\"start\" value=\"10:00\">" +
          "<label for=\"bf-minutes\">Minutes</label><input id=\"bf-minutes\" name=\"minutes\" data-kind=\"int\" value=\"60\">" +
          "<button type=\"submit\">Request booking</button></form><p id=\"notice\" role=\"status\"></p>" +
          "<h2>Room settings</h2><form id=\"room-edit\"><label for=\"re-rate\">Rate in pence per hour</label><input id=\"re-rate\" name=\"rateCents\" data-kind=\"int\" value=\"" + room.rateCents + "\">" +
          "<label for=\"re-cap\">Capacity</label><input id=\"re-cap\" name=\"capacity\" data-kind=\"int\" value=\"" + room.capacity + "\">" +
          "<label for=\"re-active\">Taking bookings</label><input id=\"re-active\" name=\"active\" type=\"checkbox\"" + (room.active ? " checked" : "") + ">" +
          "<button type=\"submit\">Save room</button></form><p id=\"room-notice\" role=\"status\"></p>";
        document.getElementById("book-form").addEventListener("submit", function (ev) {
          ev.preventDefault();
          var v = formValues(ev.target);
          v.roomId = room.id;
          api("POST", "/api/bookings", v).then(function (res) {
            var n = document.getElementById("notice");
            n.textContent = res.ok ? "Requested " + res.data.ref + " for " + money(res.data.totalCents) + "." : errorText(res);
          });
        });
        document.getElementById("room-edit").addEventListener("submit", function (ev) {
          ev.preventDefault();
          api("PUT", "/api/rooms/" + room.id, formValues(ev.target)).then(function (res) {
            document.getElementById("room-notice").textContent = res.ok ? "Saved." : errorText(res);
          });
        });
        ready(room.name);
      });
    });
  }

  // ---------- bookings ----------
  function bookingsPage() {
    var q = new URLSearchParams();
    ["status", "band", "offset"].forEach(function (k) {
      if (params.get(k)) q.set(k, params.get(k));
    });
    api("GET", "/api/bookings" + (q.toString() ? "?" + q.toString() : "")).then(function (r) {
      if (!r.ok) {
        main.innerHTML = "<h1>Bookings</h1><p>" + esc(errorText(r)) + "</p>";
        return ready("Bookings");
      }
      var d = r.data;
      var from = d.total === 0 ? 0 : d.offset + 1;
      var to = d.offset + d.items.length;
      function link(offset) {
        var n = new URLSearchParams(q);
        n.set("offset", String(offset));
        return "/bookings?" + n.toString();
      }
      var pager = "";
      if (d.offset > 0) pager += "<a href=\"" + link(Math.max(0, d.offset - d.limit)) + "\">Previous page</a> ";
      if (to < d.total) pager += "<a href=\"" + link(d.offset + d.limit) + "\">Next page</a>";
      var options = ["", "tentative", "confirmed", "checked_in", "completed", "cancelled"]
        .map(function (s) {
          return "<option value=\"" + s + "\"" + (params.get("status") === s ? " selected" : "") + ">" + (s ? STATUS_LABEL[s] : "Any status") + "</option>";
        })
        .join("");
      main.innerHTML =
        "<h1>Bookings</h1><form method=\"get\" action=\"/bookings\"><label for=\"f-status\">Status</label><select id=\"f-status\" name=\"status\">" + options + "</select>" +
        "<label for=\"f-band\">Band contains</label><input id=\"f-band\" name=\"band\" value=\"" + esc(params.get("band") || "") + "\"><button type=\"submit\">Filter</button></form>" +
        "<p>Showing " + from + " to " + to + " of " + d.total + ".</p><table>" + BOOKING_HEAD + "<tbody>" + bookingRows(d.items) + "</tbody></table><p>" + pager + "</p>";
      ready("Bookings");
    });
  }

  // ---------- one booking ----------
  function bookingPage() {
    var id = params.get("id");
    function render() {
      api("GET", "/api/bookings/" + encodeURIComponent(id)).then(function (r) {
        if (!r.ok) {
          main.innerHTML = "<h1>Booking not found</h1><p>No booking has the number " + esc(id) + ".</p>";
          return ready("Booking not found");
        }
        var b = r.data;
        var buttons = NEXT[b.status]
          .map(function (s) {
            return "<button type=\"button\" data-to=\"" + s + "\">" + ACTION_LABEL[s] + "</button> ";
          })
          .join("");
        var share = location.origin + "/booking?id=" + b.id;
        main.innerHTML =
          "<h1>Booking " + esc(b.ref) + "</h1><dl>" +
          "<dt>Band</dt><dd>" + esc(b.band) + " (" + b.players + " players)</dd>" +
          "<dt>Room</dt><dd><a href=\"/room?id=" + b.roomId + "&date=" + b.date + "\">" + esc(b.roomName) + "</a></dd>" +
          "<dt>When</dt><dd>" + esc(dayLabel(b.date)) + ", " + b.start + " to " + b.end + " (" + b.minutes + " minutes)</dd>" +
          "<dt>Status</dt><dd><span class=\"badge\">" + STATUS_LABEL[b.status] + "</span></dd>" +
          "<dt>Price</dt><dd>" + money(b.totalCents) + "</dd>" +
          (b.status === "cancelled" ? "<dt>Cancellation fee</dt><dd>" + money(b.feeCents) + "</dd>" : "") +
          "</dl><p>" + (buttons || "No further changes.") + "</p>" +
          "<p>Share this booking: <code id=\"share\">" + esc(share) + "</code></p><p id=\"notice\" role=\"status\"></p>";
        Array.prototype.forEach.call(main.querySelectorAll("button[data-to]"), function (btn) {
          btn.addEventListener("click", function () {
            api("PUT", "/api/bookings/" + b.id + "/status", { status: btn.getAttribute("data-to") }).then(function (res) {
              if (res.ok) render();
              else document.getElementById("notice").textContent = errorText(res);
            });
          });
        });
        ready("Booking " + b.ref);
      });
    }
    render();
  }

  // ---------- activity ----------
  function activityPage() {
    // The summary is fetched fresh on every load.
    api("GET", "/api/summary?_=" + Date.now()).then(function (r) {
      var s = r.data;
      var counts = ["tentative", "confirmed", "checked_in", "completed", "cancelled"]
        .map(function (k) {
          return "<tr><td>" + STATUS_LABEL[k] + "</td><td>" + s.bookings[k] + "</td></tr>";
        })
        .join("");
      main.innerHTML =
        "<h1>Studio activity</h1><p>Last updated " + new Date().toLocaleTimeString("en-GB") + "</p>" +
        "<p>" + s.activeRooms + " of " + s.rooms + " rooms taking bookings.</p><table><tbody>" + counts + "<tr><td>All bookings</td><td>" + s.bookings.total + "</td></tr></tbody></table>" +
        "<p>Earned: " + money(s.revenueCents) + ". Awaiting confirmation: " + money(s.pipelineCents) + ".</p>" +
        "<p>Busiest room: " + (s.busiestRoom ? esc(s.busiestRoom.name) + " (" + s.busiestRoom.bookedMinutes + " minutes)" : "none") + "</p>" +
        "<p><a href=\"/api/export\">Download the week as JSON</a></p>";
      ready("Activity");
    });
  }

  ({ rooms: roomsPage, room: roomPage, bookings: bookingsPage, booking: bookingPage, activity: activityPage })[page]();
})();
