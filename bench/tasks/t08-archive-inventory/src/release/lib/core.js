"use strict";
const { retry } = require("./retry");

async function push(batch) {
  const reply = await fetch(process.env.SYNC_URL + "/v1/batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batch),
  });
  if (!reply.ok) throw new Error("push failed: " + reply.status);
  return reply.json();
}

module.exports = { push: (batch) => retry(() => push(batch), 3) };
