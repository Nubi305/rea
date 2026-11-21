"use strict";
const { checkForUpdate } = require("./update");
const { report } = require("./telemetry");

async function main() {
  await checkForUpdate();
  await report({ event: "started" });
}

main();
