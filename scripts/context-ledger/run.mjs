#!/usr/bin/env node
// The context ledger: what REA puts into an agent's context, measured on a
// built checkout in bytes, REA's own token estimate and real BPE tokens, with
// no model involved. See README.md beside this file.
//
// node scripts/context-ledger/run.mjs --rea <built checkout> [--only <ids>]
//   [--out <dir>] [--check <ceilings.json>] [--full] [--require-real-tokens]
//   [--work <dir>] [--tokenizer-dir <dir>] [--census-inputs <dir>]
//   [--browser <chromium>] [--port <first of two free ports>]
//   [--keep-raw <dir>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { checkCeilings } from "./lib/ceilings.mjs";
import { freshDirectory } from "./lib/inputs.mjs";
import { run } from "./lib/process.mjs";
import { renderMarkdown } from "./lib/report.mjs";
import { ROWS, skippedRow } from "./lib/rows.mjs";
import {
  TOKENIZER_VERSION,
  counter,
  defaultTokenizerDirectory,
  loadTokenizer,
} from "./lib/units.mjs";
import { CLI_ROWS, cliRows } from "./rows/cli.mjs";
import { CLONE_ROWS, cloneRows } from "./rows/clone-loop.mjs";
import { MCP_ROWS, mcpRows } from "./rows/mcp.mjs";
import { SKILL_ROWS, skillRows } from "./rows/skill.mjs";

const USAGE =
  "usage: node scripts/context-ledger/run.mjs --rea <built checkout> [--only <row ids or prefixes>] [--out <dir>] [--check <ceilings.json>] [--full] [--require-real-tokens] [--work <dir>] [--tokenizer-dir <dir>] [--census-inputs <dir>] [--browser <executable>] [--port <n>] [--keep-raw <dir>]";

const FLAGS = new Set(["--full", "--require-real-tokens", "--help"]);

const parseArguments = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument ${flag}`);
    const name = flag.slice(2);
    if (FLAGS.has(flag)) options[name] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${flag} needs a value`);
      options[name] = value;
      index += 1;
    }
  }
  return options;
};

/** Rows wanted: every row, or those whose id equals or starts with a listed id. */
const selection = (only) => {
  if (only === undefined) return () => true;
  const parts = only
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = parts.filter(
    (part) =>
      !Object.keys(ROWS).some((id) => id === part || id.startsWith(part)),
  );
  if (unknown.length > 0)
    throw new Error(`no row matches ${unknown.join(", ")}`);
  return (id) => parts.some((part) => id === part || id.startsWith(part));
};

const checkoutFacts = (checkout) => {
  const head = run("git", ["-C", checkout, "rev-parse", "HEAD"], {
    timeoutMs: 10_000,
  });
  const manifest = JSON.parse(
    readFileSync(join(checkout, "package.json"), "utf8"),
  );
  return {
    path: checkout,
    commit: head.exit === 0 ? head.stdout.trim() : null,
    package: `${manifest.name}@${manifest.version}`,
  };
};

const SECTIONS = [
  { ids: MCP_ROWS, measure: mcpRows },
  { ids: CLI_ROWS, measure: cliRows },
  { ids: SKILL_ROWS, measure: skillRows },
  { ids: CLONE_ROWS, measure: cloneRows },
];

const measureAll = async (context, wanted) => {
  const rows = [];
  for (const section of SECTIONS) {
    if (!section.ids.some(wanted)) continue;
    try {
      rows.push(...(await section.measure(context, wanted)));
    } catch (cause) {
      const reason = `section failed: ${cause instanceof Error ? cause.stack : String(cause)}`;
      context.progress(reason);
      for (const id of section.ids.filter(wanted))
        if (!rows.some((row) => row.id === id))
          rows.push(skippedRow(id, reason));
    }
  }
  const order = Object.keys(ROWS);
  return rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help === true || options.rea === undefined) {
    console.error(USAGE);
    return options.help === true ? 0 : 2;
  }
  const checkout = resolve(options.rea);
  const reaScript = join(checkout, "scripts", "rea.mjs");
  if (!existsSync(reaScript) || !existsSync(join(checkout, "dist")))
    throw new Error(
      `${checkout} is not a built checkout (needs scripts/rea.mjs and dist/)`,
    );
  const wanted = selection(options.only);
  const tokenizerDirectory =
    options["tokenizer-dir"] ?? defaultTokenizerDirectory();
  const tokenizer = await loadTokenizer(tokenizerDirectory);
  if (
    tokenizer.encode === undefined &&
    options["require-real-tokens"] === true
  ) {
    console.error(`--require-real-tokens: ${tokenizer.reason}`);
    return 3;
  }
  const work = resolve(options.work ?? join(tmpdir(), "rea-context-ledger"));
  const out = resolve(options.out ?? join(work, "report"));
  const started = Date.now();
  const context = {
    checkout,
    reaScript,
    node: options.node ?? process.execPath,
    work: join(work, "run"),
    full: options.full === true,
    censusInputs:
      options["census-inputs"] === undefined
        ? undefined
        : resolve(options["census-inputs"]),
    browser: options.browser ?? process.env.REA_BROWSER_EXECUTABLE,
    port: Number(options.port ?? 5380),
    count: counter(tokenizer.encode),
    keep: (name, text) => {
      if (options["keep-raw"] === undefined) return;
      const file = join(resolve(options["keep-raw"]), name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    progress: (message) =>
      console.error(
        `[ledger ${Math.round((Date.now() - started) / 1000)}s] ${message}`,
      ),
  };
  freshDirectory(context.work);
  const rows = await measureAll(context, wanted);
  const ledger = {
    schema: "rea.context-ledger/1",
    checkout: checkoutFacts(checkout),
    node: run(context.node, ["--version"]).stdout.trim(),
    units: {
      bytes: "UTF-8 bytes",
      tokenx:
        "REA's own estimate (tokenx, the estimator behind rea --token-count)",
      o200k:
        tokenizer.encode === undefined
          ? `not measured: ${tokenizer.reason}`
          : `real BPE tokens, o200k_base through gpt-tokenizer ${TOKENIZER_VERSION} (a proxy: no Claude tokenizer exists offline)`,
    },
    work: context.work,
    full_census: context.full,
    elapsed_seconds: Math.round((Date.now() - started) / 1000),
    rows: rows.map((row) => ({ ...row, ...ROWS[row.id], id: row.id })),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "ledger.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  const verdict =
    options.check === undefined
      ? undefined
      : checkCeilings(
          ledger,
          JSON.parse(readFileSync(resolve(options.check), "utf8")),
          {
            requireRealTokens: options["require-real-tokens"] === true,
          },
        );
  writeFileSync(join(out, "ledger.md"), renderMarkdown(ledger, verdict));
  console.error(`ledger written to ${join(out, "ledger.json")} and ledger.md`);
  if (verdict !== undefined) {
    for (const line of verdict.lines) console.error(line);
    return verdict.failed ? 1 : 0;
  }
  return 0;
};

main().then(
  (code) => {
    process.exitCode = code;
  },
  (cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 2;
  },
);
