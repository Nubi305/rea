#!/usr/bin/env node
// Scores task-benchmark cells after their agents have finished: each
// expected fact right or wrong, the first REA command the agent ran against
// the expected one, what the run cost and what filled the agent's context.
// No model is involved.
//
//   node bench/harness/task-score.mjs --root <dir> --transcripts <run directory>
//        [--task <id>]... [--floor <floor.json>] [--out <file>]
//   node bench/harness/task-score.mjs --workspace <dir> --transcript <file or run directory>
//        [--cell <cell.json>] [--floor <floor.json>] [--out <file>]
//
// With --root, the floor cell of the same root (t00-floor) is taken off every
// other cell unless --floor names another. Servers that prepare started are
// stopped.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { costOf, transcriptReport } from "./lib/cost.mjs";
import { parseJson } from "./lib/proc.mjs";
import { otherToolUseOf, ruleBreaksOf } from "./lib/rule-breaks.mjs";
import { stopRecordedService } from "./lib/service.mjs";
import { firstCommandOf, judgeAnswer, loadTask } from "./lib/tasks.mjs";
import { findTranscript, readTranscript } from "./lib/transcript.mjs";
import { readCell } from "./lib/workspace.mjs";

const USAGE = `usage: task-score.mjs --root <dir> --transcripts <run directory> [--task <id>]... [--floor <floor.json>] [--out <file>]
       task-score.mjs --workspace <dir> --transcript <file or run directory> [--cell <cell.json>] [--floor <floor.json>] [--out <file>]`;

const options = () => {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      transcripts: { type: "string" },
      workspace: { type: "string" },
      transcript: { type: "string" },
      cell: { type: "string" },
      task: { type: "string", multiple: true },
      floor: { type: "string" },
      out: { type: "string" },
    },
  });
  const whole = values.root !== undefined && values.transcripts !== undefined;
  const single =
    values.workspace !== undefined && values.transcript !== undefined;
  if (whole === single) throw new Error(USAGE);
  return values;
};

const readAnswer = (file) =>
  existsSync(file) ? parseJson(readFileSync(file, "utf8")) : null;

const transcriptOf = (cell, where) => {
  try {
    return readTranscript(findTranscript(where, cell.label));
  } catch (error) {
    return { missing: String(error.message) };
  }
};

/** The score of one cell; `floor` is a cost to take off, or null. */
const scoreCell = (cell, where, floor) => {
  const task = loadTask(cell.task);
  const judged = judgeAnswer(task, readAnswer(cell.answer_file));
  const header = {
    cell: cell.id,
    label: cell.label,
    task: task.id,
    title: task.title,
    known_gap: task.known_gap ?? null,
    ...judged,
  };
  const transcript = transcriptOf(cell, where);
  if (transcript.missing !== undefined)
    return { ...header, scored: false, problem: transcript.missing };
  const { invocations, ...report } = transcriptReport(transcript, {
    skillDir: cell.skill_dir ?? null,
    shimLog: cell.shim_log ?? null,
    floor: cell.floor === true ? null : floor,
  });
  return {
    ...header,
    scored: true,
    first_command: firstCommandOf(task, invocations),
    ...report,
    rule_breaks: ruleBreaksOf(transcript, cell.forbidden ?? []),
    other_tool_use: otherToolUseOf(transcript, {
      inputDir: cell.input_files.length === 0 ? null : cell.input_dir,
      address: cell.service?.address ?? null,
    }),
  };
};

const cellsUnder = (root, wanted) =>
  readdirSync(root)
    .filter((name) => name.endsWith(".cell"))
    .map((name) => join(root, name, "cell.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")))
    .filter((cell) => cell.kind === "task")
    .filter((cell) => wanted === undefined || wanted.includes(cell.task))
    .sort((left, right) => left.id.localeCompare(right.id));

const floorOf = (cells, where, floorFile) => {
  if (floorFile !== undefined)
    return JSON.parse(readFileSync(floorFile, "utf8"));
  const cell = cells.find((item) => item.floor === true);
  if (cell === undefined) return null;
  const transcript = transcriptOf(cell, where);
  return transcript.missing === undefined ? costOf(transcript) : null;
};

const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

const summarize = (rows) => {
  const tasks = rows.filter((row) => row.scored && row.task !== "t00-floor");
  const first = (result) =>
    tasks.filter((row) => row.first_command.result === result).length;
  return {
    cells: rows.length,
    not_scored: rows.filter((row) => !row.scored).map((row) => row.cell),
    tasks_scored: tasks.length,
    tasks_right: tasks.filter((row) => row.right).length,
    facts_right: sum(tasks, (row) => row.facts_right),
    facts_total: sum(tasks, (row) => row.facts_total),
    first_command_expected: first("expected"),
    first_command_accepted: first("accepted"),
    first_command_other: first("other"),
    first_command_none: first("none"),
    peak_context_tokens_max: Math.max(
      0,
      ...tasks.map((row) => row.cost.peak_context_tokens),
    ),
    prompt_tokens_all_turns: sum(
      tasks,
      (row) => row.cost.prompt_tokens_all_turns,
    ),
    output_tokens: sum(tasks, (row) => row.cost.output_tokens),
    rea_result_bytes: sum(tasks, (row) => row.context.rea.bytes),
    skill_bytes: sum(tasks, (row) => row.context.skill.bytes),
    rule_breaks: sum(tasks, (row) => row.rule_breaks.count),
    other_tool_uses: sum(tasks, (row) => row.other_tool_use.count),
  };
};

const tableLine = (row) =>
  row.scored
    ? `${row.cell.padEnd(34)} ${row.right ? "right" : "WRONG"} ${row.facts_right}/${row.facts_total}  first ${String(row.first_command.first_working_command ?? "-").padEnd(30)} ${row.first_command.result.padEnd(8)} peak ${String(row.cost.peak_context_tokens).padStart(7)}  rea ${String(row.context.rea.bytes).padStart(8)} B`
    : `${row.cell.padEnd(34)} not scored: ${row.problem}`;

const stopServices = async (cells) => {
  for (const cell of cells)
    if (cell.service) await stopRecordedService(cell.service.record_file);
};

const main = async () => {
  const values = options();
  const cells =
    values.root === undefined
      ? [readCell(values.workspace, values.cell)]
      : cellsUnder(values.root, values.task);
  const where = values.transcripts ?? values.transcript;
  const floor = floorOf(cells, where, values.floor);
  const rows = cells.map((cell) => scoreCell(cell, where, floor));
  await stopServices(cells);
  for (const row of rows) console.error(tableLine(row));
  const result = {
    schema: "rea.bench.task-scores/1",
    scored_at: new Date().toISOString(),
    root: values.root === undefined ? null : resolve(values.root),
    transcripts: resolve(where),
    rea_under_test:
      cells[0] === undefined
        ? null
        : {
            commit: cells[0].rea.commit_short,
            version: cells[0].rea.version,
            node_version: cells[0].rea.node_version,
          },
    floor,
    summary: summarize(rows),
    rows,
  };
  const text = `${JSON.stringify(result, null, 1)}\n`;
  if (values.out !== undefined) writeFileSync(values.out, text);
  process.stdout.write(text);
};

await main();
