"use strict";

async function retry(work, attempts) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await work();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw last;
}

module.exports = { retry };
