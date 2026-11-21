#!/usr/bin/env node
// Install the real BPE tokenizer the context ledger counts with into a cache
// directory outside the repository. The repository does not depend on it: the
// ledger reports bytes and REA's own estimate without it.
//
// Usage: node scripts/context-ledger/install-tokenizer.mjs [--dir <cache dir>]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  TOKENIZER_INTEGRITY,
  TOKENIZER_PACKAGE,
  TOKENIZER_VERSION,
  defaultTokenizerDirectory,
  loadTokenizer,
} from "./lib/units.mjs";

const argv = process.argv.slice(2);
const dirIndex = argv.indexOf("--dir");
const directory =
  dirIndex >= 0 ? argv[dirIndex + 1] : defaultTokenizerDirectory();
if (directory === undefined || directory === "") {
  console.error("--dir needs a directory");
  process.exit(2);
}

mkdirSync(directory, { recursive: true });
// A private package.json keeps npm from walking up into a repository.
writeFileSync(
  join(directory, "package.json"),
  `${JSON.stringify({ name: "rea-context-ledger-tokenizer", private: true }, null, 2)}\n`,
);
const result = spawnSync(
  "npm",
  [
    "install",
    "--prefix",
    directory,
    "--no-save",
    "--no-package-lock",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `${TOKENIZER_PACKAGE}@${TOKENIZER_VERSION}`,
  ],
  { stdio: "inherit", timeout: 300_000 },
);
if (result.status !== 0) {
  console.error(`npm install failed (exit ${result.status ?? result.signal})`);
  process.exit(1);
}
const loaded = await loadTokenizer(directory);
if (loaded.encode === undefined) {
  console.error(`installed, but the tokenizer does not load: ${loaded.reason}`);
  process.exit(1);
}
console.log(
  `${TOKENIZER_PACKAGE} ${loaded.version} (o200k_base) is in ${directory}; expected registry integrity ${TOKENIZER_INTEGRITY}`,
);
