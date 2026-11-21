"use strict";
const UPDATE_URL = "http://updates.vendor.example.test/agent/latest.json";

async function checkForUpdate() {
  const reply = await fetch(UPDATE_URL);
  return reply.ok ? reply.json() : null;
}

module.exports = { checkForUpdate };
