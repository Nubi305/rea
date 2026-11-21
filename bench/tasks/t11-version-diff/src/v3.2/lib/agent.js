"use strict";
const { checkForUpdate } = require("./update");
const { verify } = require("./signature");

async function main() {
  const manifest = await checkForUpdate();
  if (manifest && !verify(manifest)) throw new Error("update manifest refused");
}

main();
