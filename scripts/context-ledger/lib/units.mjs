// The three units every ledger row is counted in: UTF-8 bytes, REA's own token
// estimate (tokenx, the estimator behind `rea --token-count`) and real BPE
// tokens (o200k_base through gpt-tokenizer, the audit's proxy). No Claude
// tokenizer exists offline, so none is counted.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { estimateTokenCount } from "tokenx";

export const TOKENIZER_PACKAGE = "gpt-tokenizer";
export const TOKENIZER_VERSION = "4.1.2";
export const TOKENIZER_INTEGRITY =
  "sha512-5GwcLcZd6IqCdrGTTPcoKqbJk8cCWHHsoTHR/uQGZKT29CFcnJEg69qisGbKesQpzxRq9yQO4lBgsaZ8SawcGQ==";

/** Where install-tokenizer.mjs puts the tokenizer unless told otherwise. */
export const defaultTokenizerDirectory = () =>
  process.env.REA_LEDGER_TOKENIZER_DIR ??
  join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "rea-context-ledger",
    "tokenizer",
  );

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Load o200k_base from the cache directory. Returns `{ encode }` when the
 * exact audited version is present, otherwise `{ reason }`.
 */
export const loadTokenizer = async (directory) => {
  const root = join(directory, "node_modules", TOKENIZER_PACKAGE);
  const manifest = join(root, "package.json");
  if (!existsSync(manifest))
    return {
      reason: `${TOKENIZER_PACKAGE} is not installed in ${directory}; run node scripts/context-ledger/install-tokenizer.mjs`,
    };
  const { version } = readJson(manifest);
  if (version !== TOKENIZER_VERSION)
    return {
      reason: `${TOKENIZER_PACKAGE} ${version} in ${directory} is not the audited ${TOKENIZER_VERSION}`,
    };
  const lock = join(directory, "node_modules", ".package-lock.json");
  const integrity = existsSync(lock)
    ? readJson(lock).packages?.[`node_modules/${TOKENIZER_PACKAGE}`]?.integrity
    : undefined;
  if (integrity !== undefined && integrity !== TOKENIZER_INTEGRITY)
    return {
      reason: `${TOKENIZER_PACKAGE} in ${directory} has integrity ${integrity}, not the published one`,
    };
  const module = await import(
    pathToFileURL(join(root, "esm", "encoding", "o200k_base.js")).href
  );
  return {
    version,
    encode: (text) => module.encode(text, { allowedSpecial: "all" }).length,
  };
};

export const byteLength = (text) => Buffer.byteLength(text, "utf8");

/** Build the counter for one run. `encode` may be undefined. */
export const counter = (encode) => (text) => ({
  bytes: byteLength(text),
  tokenx: estimateTokenCount(text),
  o200k: encode === undefined ? null : encode(text),
});

/** Sum the units of several measurements; null stays null. */
export const sumUnits = (list) => ({
  bytes: list.reduce((total, item) => total + item.bytes, 0),
  tokenx: list.reduce((total, item) => total + item.tokenx, 0),
  o200k: list.some((item) => item.o200k === null)
    ? null
    : list.reduce((total, item) => total + item.o200k, 0),
});

/** Mean of several measurements, rounded like the audit's tables. */
export const meanUnits = (list) => {
  const total = sumUnits(list);
  const mean = (value) =>
    value === null || list.length === 0
      ? null
      : Math.round(value / list.length);
  return {
    bytes: mean(total.bytes),
    tokenx: mean(total.tokenx),
    o200k: mean(total.o200k),
  };
};
