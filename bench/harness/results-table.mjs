#!/usr/bin/env node
// Prints score files as Markdown tables: one row per clone score, one row
// per task-score file, and with --tasks one row per task of each.
//
//   node bench/harness/results-table.mjs [--tasks] <score file or directory>...
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { tasks: { type: "boolean", default: false } },
  allowPositionals: true,
});
if (positionals.length === 0)
  throw new Error(
    "usage: results-table.mjs [--tasks] <score file or directory>...",
  );

const filesIn = (path) =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .sort()
        .flatMap((name) => filesIn(join(path, name)))
    : path.endsWith(".json")
      ? [path]
      : [];

const day = (stamp) => (typeof stamp === "string" ? stamp.slice(0, 10) : "");
const number = (value) =>
  typeof value === "number" ? value.toLocaleString("en-US") : "";

const table = (title, columns, rows) => {
  if (rows.length === 0) return;
  console.log(`\n${title}\n`);
  console.log(`| ${columns.join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
};

const cloneRow = (file, score) => {
  const { hidden, cost, context, referee } = score;
  const recorded = referee.recorded_in_run_folder?.verdict;
  return [
    day(score.run?.started_at),
    score.cell.app,
    score.rea_under_test.commit ?? "",
    cost.model,
    `${referee.verdict ?? "none"} (exit ${referee.exit_status})${referee.recorded_differs ? `; the run recorded ${recorded}` : ""}`,
    hidden.measured
      ? `${hidden.rules_agree} of ${hidden.rules_total} (${hidden.rules_disagree} disagree, ${hidden.rules_undecided} undecided)`
      : "not measured",
    hidden.measured ? `${hidden.steps.unchanged} of ${hidden.steps.steps}` : "",
    number(cost.peak_context_tokens),
    number(cost.prompt_tokens_all_turns),
    number(cost.output_tokens),
    String(cost.wall_minutes ?? ""),
    String(cost.tool_calls),
    number(context.rea.bytes),
    number(context.skill.bytes),
    number(context.other.bytes),
    String(
      score.captures.by_shim_log ??
        `at least ${score.captures.in_transcript_text}`,
    ),
    String(score.rule_breaks.count),
    basename(file),
  ];
};

const taskFileRow = (file, scores) => {
  const { summary } = scores;
  const rows = scores.rows.filter((row) => row.scored);
  return [
    day(rows[0]?.run?.started_at),
    scores.rea_under_test?.commit ?? "",
    [...new Set(rows.map((row) => row.cost.model))].join(", "),
    `${summary.tasks_right} of ${summary.tasks_scored}`,
    `${summary.facts_right} of ${summary.facts_total}`,
    `${summary.first_command_expected} expected, ${summary.first_command_accepted} accepted, ${summary.first_command_other} other, ${summary.first_command_none} none`,
    number(summary.peak_context_tokens_max),
    number(summary.prompt_tokens_all_turns),
    number(summary.output_tokens),
    number(summary.rea_result_bytes),
    number(summary.skill_bytes),
    String(summary.rule_breaks),
    basename(file),
  ];
};

const taskRows = (scores) =>
  scores.rows
    .filter((row) => row.scored)
    .map((row) => [
      row.cell,
      row.right ? "right" : "wrong",
      `${row.facts_right} of ${row.facts_total}`,
      `${row.first_command.first_working_command ?? "none"} (${row.first_command.result})`,
      row.first_command.economical === null
        ? ""
        : row.first_command.economical
          ? "yes"
          : "no",
      number(row.cost.peak_context_tokens),
      number(row.cost.net_of_floor?.peak_context_tokens),
      number(row.cost.prompt_tokens_all_turns),
      number(row.cost.output_tokens),
      String(row.cost.turns),
      number(row.context.rea.bytes),
      number(row.context.skill.bytes),
    ]);

const clones = [];
const taskFiles = [];
const perTask = [];
for (const file of positionals.flatMap(filesIn)) {
  const score = JSON.parse(readFileSync(file, "utf8"));
  if (score.schema === "rea.bench.clone-score/1")
    clones.push(cloneRow(file, score));
  if (score.schema === "rea.bench.task-scores/1") {
    taskFiles.push(taskFileRow(file, score));
    if (values.tasks) perTask.push([basename(file), taskRows(score)]);
  }
}

table(
  "Clone benchmark",
  [
    "Run",
    "Application",
    "Build",
    "Model",
    "Referee",
    "Hidden rules agree",
    "Steps unchanged",
    "Peak context",
    "Prompt tokens, all turns",
    "Output tokens",
    "Minutes",
    "Tool calls",
    "REA result bytes",
    "Skill bytes",
    "Other result bytes",
    "Captures",
    "Rule breaks",
    "File",
  ],
  clones,
);
table(
  "Task benchmark",
  [
    "Run",
    "Build",
    "Model",
    "Tasks right",
    "Facts right",
    "First command",
    "Largest peak context",
    "Prompt tokens, all turns",
    "Output tokens",
    "REA result bytes",
    "Skill bytes",
    "Rule breaks",
    "File",
  ],
  taskFiles,
);
for (const [name, rows] of perTask)
  table(
    `Tasks of ${name}`,
    [
      "Cell",
      "Answer",
      "Facts",
      "First command",
      "Economical",
      "Peak context",
      "Net of floor",
      "Prompt tokens",
      "Output tokens",
      "Turns",
      "REA result bytes",
      "Skill bytes",
    ],
    rows,
  );
