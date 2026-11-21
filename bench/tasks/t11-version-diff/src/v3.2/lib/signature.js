"use strict";
const crypto = require("node:crypto");

const PUBLIC_KEY_ID = "vendor-update-2026";

function verify(manifest) {
  const digest = crypto.createHash("sha256").update(manifest.payload).digest("hex");
  return manifest.keyId === PUBLIC_KEY_ID && manifest.sha256 === digest;
}

module.exports = { verify };
