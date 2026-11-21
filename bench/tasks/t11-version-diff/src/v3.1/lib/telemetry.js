"use strict";

async function report(event) {
  await fetch("https://telemetry.vendor.example.test/v1/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

module.exports = { report };
