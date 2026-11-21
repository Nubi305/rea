"use strict";
const UPDATE_URL = "https://updates.vendor.example.test/agent/v2/manifest.json";

async function checkForUpdate() {
  const reply = await fetch(UPDATE_URL, { headers: { "x-agent-channel": "stable" } });
  return reply.ok ? reply.json() : null;
}

module.exports = { checkForUpdate };
