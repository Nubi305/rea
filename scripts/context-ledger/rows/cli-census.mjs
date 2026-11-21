// The CLI first-answer census and the typical mistakes: a port of the audit's
// census-cli-output harness (scripts/run.mjs, build-tables.py). Each spec is
// one first call with --json appended, run from a directory holding inputs/
// and work/, so the paths REA prints are short and the same on every machine.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { INPUTS, buildCensusInputs, materialize } from "../lib/inputs.mjs";
import { reaEnvironment, runRea } from "../lib/process.mjs";
import { measuredRow, skippedRow } from "../lib/rows.mjs";

const readSpecs = (name) =>
  readFileSync(join(INPUTS, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

/** The audit's classification: exit 0, or a verdict or health report with its own exit. */
const classify = (exit, stdout) => {
  if (exit === 0) return "ok";
  let document;
  try {
    document = JSON.parse(stdout);
  } catch {
    return "error";
  }
  if (document === null || typeof document !== "object") return "error";
  const code = document.code ?? document.error?.code;
  if (
    code === "provider_unavailable" ||
    code === "capability_unavailable" ||
    document.category === "unsupported_provider"
  )
    return "needs-provider";
  if ("verdict" in document) return "ok-verdict-exit";
  if ("healthy" in document) return "ok-report-exit";
  return "input-error";
};

const BAD_SCENARIO = `${JSON.stringify({
  browser: { mode: "launch" },
  start_url: "http://127.0.0.1:5110/",
  actions: [
    { action: "goto", url: "http://127.0.0.1:5110/about" },
    { action: "clik", selector: "#x" },
  ],
})}\n`;

/** The census directory: inputs/ built from the repository (or given), work/. */
const prepare = (context, root) => {
  const inputs = join(root, "inputs");
  let missing = [];
  if (context.censusInputs === undefined)
    ({ missing } = buildCensusInputs(inputs, context.node));
  else materialize(context.censusInputs, inputs);
  mkdirSync(join(root, "work", "ev"), { recursive: true });
  writeFileSync(join(root, "work", "bad-scenario.json"), BAD_SCENARIO);
  return { inputs, missing };
};

/** Inputs a spec names (inputs/<name>) that are not there. */
const absentInputs = (root, spec) =>
  spec.args
    .filter((arg) => /^inputs\/[^/]+/u.test(arg))
    .map((arg) => arg.split("/").slice(0, 2).join("/"))
    .filter(
      (path) =>
        !existsSync(join(root, path)) && path !== "inputs/does-not-exist",
    );

const runSpecs = (context, root, env, specs) =>
  specs.map((spec) => {
    const absent = absentInputs(root, spec);
    if (absent.length > 0)
      return { id: spec.id, skipped: `needs ${absent.join(", ")}` };
    const args = [...spec.args, ...(spec.noJson === true ? [] : ["--json"])];
    const result = runRea(context, args, {
      cwd: root,
      env,
      stdin: spec.stdin,
      timeoutMs: (spec.timeout ?? 120) * 1000,
    });
    context.keep(`cli/${spec.id}.out`, result.stdout);
    return {
      id: spec.id,
      exit: result.exit,
      status: result.timedOut
        ? "timeout"
        : classify(result.exit, result.stdout),
      ms: result.ms,
      ...context.count(result.stdout),
      stderr_bytes: Buffer.byteLength(result.stderr),
    };
  });

const brief = ({ id, exit, status, bytes, tokenx, o200k, skipped }) =>
  skipped === undefined
    ? { id, exit, status, bytes, tokenx, o200k }
    : { id, skipped };

const censusRows = (context, results, scope) => {
  const ran = results.filter((r) => r.skipped === undefined);
  const ok = ran.filter((r) => r.status.startsWith("ok"));
  const largest = ok.reduce(
    (best, r) => (best === undefined || r.bytes > best.bytes ? r : best),
    undefined,
  );
  const realTokens = ok.every((r) => r.o200k !== null);
  const detail = {
    scope,
    calls: ran.length,
    successful: ok.length,
    skipped: results
      .filter((r) => r.skipped !== undefined)
      .map(({ id, skipped }) => `${id}: ${skipped}`),
    largest: largest?.id ?? null,
  };
  const total = {
    bytes: ok.reduce((sum, r) => sum + r.bytes, 0),
    tokenx: ok.reduce((sum, r) => sum + r.tokenx, 0),
    o200k: realTokens ? ok.reduce((sum, r) => sum + r.o200k, 0) : null,
  };
  return [
    measuredRow("cli.census.largest", {
      units:
        largest === undefined
          ? undefined
          : {
              bytes: largest.bytes,
              tokenx: largest.tokenx,
              o200k: largest.o200k,
            },
      detail: {
        ...detail,
        note: `${scope} census: ${ok.length} successful of ${ran.length} calls; largest is ${largest?.id ?? "none"}`,
      },
    }),
    measuredRow("cli.census.total", {
      units: total,
      detail: { ...detail, calls: results.map(brief) },
    }),
    realTokens
      ? measuredRow("cli.census.over-2000", {
          value: ok.filter((r) => r.o200k > 2000).length,
          detail: { scope, of: ok.length },
        })
      : skippedRow("cli.census.over-2000", "needs real tokens (o200k)"),
  ];
};

export const CENSUS_ROWS = [
  "cli.census.largest",
  "cli.census.total",
  "cli.census.over-2000",
  "cli.mistakes.largest",
];

/** Run the census and the mistakes the selection asks for. */
export const censusAndMistakes = (context, wanted) => {
  const root = join(context.work, "census");
  const env = reaEnvironment(root);
  const { missing } = prepare(context, root);
  const rows = [];
  if (CENSUS_ROWS.slice(0, 3).some(wanted)) {
    const scope = context.full ? "full" : "quick";
    const specs = readSpecs("cli-census.jsonl").filter(
      (spec) => context.full || spec.quick === true,
    );
    context.progress(`cli census (${scope}, ${specs.length} calls)`);
    const results = runSpecs(context, root, env, specs);
    rows.push(
      ...censusRows(context, results, scope).filter((row) => wanted(row.id)),
    );
  }
  if (wanted("cli.mistakes.largest")) {
    context.progress("cli mistakes");
    const specs = readSpecs("cli-mistakes.jsonl");
    const results = runSpecs(context, root, env, specs).filter(
      (r, index) => specs[index].setup !== true,
    );
    const ran = results.filter((r) => r.skipped === undefined);
    const largest = ran.reduce(
      (best, r) => (best === undefined || r.bytes > best.bytes ? r : best),
      undefined,
    );
    rows.push(
      measuredRow("cli.mistakes.largest", {
        units:
          largest === undefined
            ? undefined
            : {
                bytes: largest.bytes,
                tokenx: largest.tokenx,
                o200k: largest.o200k,
              },
        detail: {
          note: `largest of ${ran.length} mistakes is ${largest?.id ?? "none"}`,
          calls: results.map(brief),
        },
      }),
    );
  }
  for (const row of rows)
    if (missing.length > 0)
      row.detail = { ...row.detail, inputs_not_built: missing };
  return rows;
};
