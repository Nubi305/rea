// CLI rows: discovery text (`rea --help`, one command's help, setup's output
// for one client), guidance search over the audit's twenty queries, progress
// on standard error, and the census and mistakes from cli-census.mjs.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { INPUTS, materialize } from "../lib/inputs.mjs";
import { reaEnvironment, runRea } from "../lib/process.mjs";
import { meanUnits } from "../lib/units.mjs";
import { measuredRow, skippedRow } from "../lib/rows.mjs";
import { CENSUS_ROWS, censusAndMistakes } from "./cli-census.mjs";

const textRow = (context, id, { layout, args }) => {
  const result = runRea(context, args, { cwd: layout.root, env: layout.env });
  context.keep(`cli/${id}.out`, result.stdout);
  if (result.exit !== 0 && result.stdout === "")
    return skippedRow(
      id,
      `rea ${args.join(" ")} exited ${result.exit}: ${result.stderr.slice(0, 300)}`,
    );
  return measuredRow(id, {
    units: context.count(result.stdout),
    detail: { exit: result.exit },
  });
};

/**
 * The audit's twenty guidance queries in the CLI's default format (TOON),
 * the form the skill's own example prints. The row is the mean over the
 * replies that match, as in the audit's census-skill 05-guidance.mjs.
 */
const guidanceRows = (context, layout, wanted) => {
  const { queries } = JSON.parse(
    readFileSync(join(INPUTS, "guidance-queries.json"), "utf8"),
  );
  const replies = queries.map((query) => {
    const result = runRea(context, ["guidance", "--query", query], {
      cwd: layout.root,
      env: layout.env,
    });
    const status =
      /^status: (\S+)/mu.exec(result.stdout)?.[1] ??
      (result.exit === 0 ? "matches" : "error");
    return {
      query,
      status,
      exit: result.exit,
      ...context.count(result.stdout),
    };
  });
  const matched = replies.filter((reply) => reply.status === "matches");
  const rows = [];
  if (wanted("guidance.search.mean"))
    rows.push(
      measuredRow("guidance.search.mean", {
        units: meanUnits(matched),
        detail: { matched: matched.length, of: replies.length, replies },
      }),
    );
  if (wanted("guidance.search.no-match"))
    rows.push(
      measuredRow("guidance.search.no-match", {
        value: replies.filter((reply) => reply.status === "no_matches").length,
        detail: {
          queries: replies
            .filter((reply) => reply.status !== "matches")
            .map((reply) => `${reply.query}: ${reply.status}`),
        },
      }),
    );
  return rows;
};

/** Standard error of a successful summary analysis of the 5-file app. */
const progressRow = (context, layout) => {
  const app = join(layout.root, "app");
  materialize(join(INPUTS, "mcp", "app"), app);
  const result = runRea(
    context,
    [
      "analyze-javascript-application",
      "app",
      "--detail",
      "summary",
      "--evidence_output",
      "work/app.analysis.json",
      "--json",
    ],
    { cwd: layout.root, env: layout.env },
  );
  if (result.exit !== 0)
    return skippedRow(
      "cli.progress.stderr",
      `the analysis failed (exit ${result.exit}): ${result.stdout.slice(0, 300)}`,
    );
  return measuredRow("cli.progress.stderr", {
    units: context.count(result.stderr),
    detail: {
      stderr_lines: result.stderr.split("\n").filter(Boolean).length,
      stdout_bytes: Buffer.byteLength(result.stdout),
    },
  });
};

export const CLI_ROWS = [
  "guidance.search.mean",
  "guidance.search.no-match",
  ...CENSUS_ROWS,
  "cli.help",
  "cli.help.command",
  "cli.setup.one-client",
  "cli.progress.stderr",
];

export const cliRows = async (context, wanted) => {
  const root = join(context.work, "cli");
  mkdirSync(join(root, "work"), { recursive: true });
  const layout = { root, env: reaEnvironment(root) };
  const rows = [];
  if (wanted("cli.help"))
    rows.push(textRow(context, "cli.help", { layout, args: ["--help"] }));
  if (wanted("cli.help.command"))
    rows.push(
      textRow(context, "cli.help.command", {
        layout,
        args: ["inspect-artifact", "--help"],
      }),
    );
  if (wanted("cli.setup.one-client")) {
    // A throwaway home of its own: setup reads and plans against $HOME.
    const setupRoot = join(context.work, "setup");
    mkdirSync(setupRoot, { recursive: true });
    rows.push(
      textRow(context, "cli.setup.one-client", {
        layout: { root: setupRoot, env: reaEnvironment(setupRoot) },
        // The client the audit measured; any one client would do.
        args: ["setup", "--dry-run", "--json", "--client", "claude_code"],
      }),
    );
  }
  if (wanted("cli.progress.stderr")) {
    context.progress("cli.progress.stderr");
    rows.push(progressRow(context, layout));
  }
  if (wanted("guidance.search.mean") || wanted("guidance.search.no-match")) {
    context.progress("guidance search (20 queries)");
    rows.push(...guidanceRows(context, layout, wanted));
  }
  if (CENSUS_ROWS.some(wanted))
    rows.push(...censusAndMistakes(context, wanted));
  return rows;
};
