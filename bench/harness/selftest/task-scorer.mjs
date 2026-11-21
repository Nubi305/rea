// The task scorer on cells made by hand: a floor, a right answer and a wrong
// one, each with a synthetic transcript whose score is worked out here.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { modelMentions } from "../lib/agent-label.mjs";
import { CELL_SCHEMA } from "../lib/workspace.mjs";
import {
  MODEL,
  runScorer,
  same,
  transcriptLines,
  turn,
  writeTranscript,
} from "./kit.mjs";

const FLOOR_PROMPT_TOKENS = 15_000;

const fabricateCell = (root, id, task, { answer, agent }) => {
  const workspace = join(root, id);
  const cellDir = `${workspace}.cell`;
  mkdirSync(join(workspace, "input"), { recursive: true });
  mkdirSync(cellDir, { recursive: true });
  writeFileSync(join(workspace, "answer.json"), JSON.stringify(answer));
  const cell = {
    schema: CELL_SCHEMA,
    kind: "task",
    id,
    label: `selftest:${id}`,
    ...(agent === undefined ? {} : { agent }),
    task,
    floor: task === "t00-floor",
    workspace,
    cell_dir: cellDir,
    input_dir: join(workspace, "input"),
    input_files: task === "t00-floor" ? [] : [{ name: "keyd", bytes: 1 }],
    answer_file: join(workspace, "answer.json"),
    service: null,
    skill_dir: join(workspace, "home", "skill"),
    shim_log: null,
    rea: {
      commit_short: "selftest",
      version: "0.0.0",
      node_version: process.version,
    },
    forbidden: [{ path: "/opt/rea", kind: "rea-checkout" }],
  };
  writeFileSync(join(cellDir, "cell.json"), JSON.stringify(cell));
  return cell;
};

// Three turns: the skill is read (1,000 bytes), the expected REA command
// runs (5,000 bytes), the answer is written (7 bytes).
const goodTurns = (cell) => [
  turn(
    [100, 0, 19_900, 100],
    [
      {
        name: "Read",
        input: { file_path: `${cell.skill_dir}/SKILL.md` },
        result: "s".repeat(1000),
      },
    ],
  ),
  turn(
    [50, 20_000, 1450, 200],
    [
      {
        name: "Bash",
        input: {
          command: `export PATH=${cell.workspace}/bin:$PATH && rea inspect-binary-hardening ${cell.input_dir}/keyd --json`,
        },
        result: "r".repeat(5000),
      },
    ],
  ),
  turn(
    [60, 21_500, 5440, 300],
    [
      {
        name: "Write",
        input: { file_path: cell.answer_file, content: "{}" },
        result: "written",
      },
    ],
  ),
];

// Two turns: help and a read under a REA checkout, then another tool on the
// input and two REA commands in one call (9,000 bytes between them).
const badTurns = (cell) => [
  turn(
    [100, 0, 19_900, 100],
    [
      {
        name: "Bash",
        input: {
          command: "rea --help | head -40; cat /opt/rea/docs/hardening.md",
        },
        result: "h".repeat(700),
      },
    ],
  ),
  turn(
    [50, 20_000, 3000, 100],
    [
      {
        name: "Bash",
        input: { command: `strings ${cell.input_dir}/keyd | head` },
        result: "t".repeat(300),
      },
      {
        name: "Bash",
        input: {
          command: `rea inspect-artifact ${cell.input_dir}/keyd --json; rea analyze ${cell.input_dir}/keyd --json`,
        },
        result: "a".repeat(9000),
      },
    ],
  ),
];

const floorTurns = (cell) => [
  turn(
    [100, 0, FLOOR_PROMPT_TOKENS - 100, 40],
    [
      {
        name: "Write",
        input: { file_path: cell.answer_file, content: "{}" },
        result: "written",
      },
    ],
  ),
];

const checkGood = (row) => {
  same(
    "task scorer: the right answer is right on every fact",
    [row.right, row.facts_right],
    [true, 4],
  );
  same(
    "task scorer: first command as expected",
    row.first_command.result,
    "expected",
  );
  const { cost, context } = row;
  same(
    "task scorer: cost of three turns, streamed duplicates not added",
    [
      cost.turns,
      cost.peak_context_tokens,
      cost.prompt_tokens_all_turns,
      cost.uncached_prompt_tokens,
      cost.output_tokens,
      cost.tool_calls,
      cost.wall_minutes,
    ],
    [3, 27_000, 68_500, 27_000, 600, 3, 3],
  );
  same(
    "task scorer: net of the floor in the same root",
    [
      cost.net_of_floor.peak_context_tokens,
      cost.net_of_floor.prompt_tokens_all_turns,
    ],
    [27_000 - FLOOR_PROMPT_TOKENS, 68_500 - 3 * FLOOR_PROMPT_TOKENS],
  );
  same(
    "task scorer: context split into REA output, skill text and the rest",
    [
      context.rea.bytes,
      context.rea.by_command["inspect-binary-hardening"],
      context.skill.bytes,
      context.skill.by_file["SKILL.md"].bytes,
      context.other.bytes,
    ],
    [5000, { calls: 1, bytes: 5000 }, 1000, 1000, 7],
  );
};

const checkBad = (row) => {
  same(
    "task scorer: the wrong answer is wrong, fact by fact",
    row.facts.map((fact) => fact.right),
    [false, false, true, false],
  );
  same(
    "task scorer: first command accepted but not the expected one, help not judged",
    [
      row.first_command.result,
      row.first_command.first_working_command,
      row.first_command.rea_calls_before_it,
    ],
    ["accepted", "inspect-artifact", 1],
  );
  same(
    "task scorer: one result shared by the REA commands that made it",
    row.context.rea.by_command,
    {
      "inspect-artifact": { calls: 1, bytes: 4500 },
      analyze: { calls: 1, bytes: 4500 },
      "(no command) --help": { calls: 1, bytes: 700 },
    },
  );
  same(
    "task scorer: a read under a REA checkout is a rule break",
    row.rule_breaks.by_kind,
    { "rea-checkout": 1 },
  );
  same(
    "task scorer: another tool on the input is listed",
    row.other_tool_use.uses.map((item) => item.how),
    ["strings"],
  );
};

// The agent is named by the label prepare recorded, the model id the
// transcripts carry is in no score, and the client's directories are written
// by their placeholders.
const checkLabels = (scores, transcripts) => {
  same(
    "task scorer: each row names its agent by the cell's label, unlabelled by default",
    [scores.agents, scores.rows.map((item) => [item.cell, item.agent])],
    [
      ["unlabelled", "selftest-agent"],
      [
        ["bad", "unlabelled"],
        ["floor", "unlabelled"],
        ["good", "selftest-agent"],
      ],
    ],
  );
  const text = JSON.stringify(scores);
  same(
    "task scorer: the score names no model and writes the transcripts and the skill by placeholder",
    [
      modelMentions(scores, new Set([MODEL])),
      text.includes(transcripts),
      scores.transcripts,
      text.includes("<skill>/SKILL.md"),
    ],
    [[], false, "<transcripts>", true],
  );
};

// A score that would name the model is refused: here the lead gave the cell
// the model id as its label.
const checkModelRefused = (root, transcripts) => {
  const cell = fabricateCell(
    join(root, "..", "tasks-model"),
    "named",
    "t00-floor",
    { answer: { ready: true }, agent: MODEL },
  );
  writeTranscript(
    transcripts,
    "named",
    cell.label,
    transcriptLines("named prompt", floorTurns(cell)),
  );
  let refused;
  try {
    runScorer("task-score.mjs", [
      "--workspace",
      cell.workspace,
      "--cell",
      join(cell.cell_dir, "cell.json"),
      "--transcript",
      transcripts,
    ]);
    refused = "scored";
  } catch (error) {
    refused = /would name a model/u.test(error.message) ? "refused" : "failed";
  }
  same(
    "task scorer: refuses to write a score that names the transcript's model",
    refused,
    "refused",
  );
};

export const checkTaskScorer = (work) => {
  const root = join(work, "tasks");
  const transcripts = join(work, "task-transcripts");
  mkdirSync(transcripts, { recursive: true });
  const hardening = "t01-elf-hardening";
  const cells = {
    floor: fabricateCell(root, "floor", "t00-floor", {
      answer: { ready: true },
    }),
    good: fabricateCell(root, "good", hardening, {
      answer: {
        pie: false,
        relro: "partial",
        stack_canary: true,
        runpath: "/opt/keyd/lib",
      },
      agent: "selftest-agent",
    }),
    bad: fabricateCell(root, "bad", hardening, {
      answer: { pie: true, relro: "full", stack_canary: true },
    }),
  };
  const turnsOf = { floor: floorTurns, good: goodTurns, bad: badTurns };
  for (const [name, cell] of Object.entries(cells))
    writeTranscript(
      transcripts,
      name,
      cell.label,
      transcriptLines(`${name} prompt`, turnsOf[name](cell)),
    );
  const scores = runScorer("task-score.mjs", [
    "--root",
    root,
    "--transcripts",
    transcripts,
  ]);
  const row = (id) => scores.rows.find((item) => item.cell === id);
  checkLabels(scores, transcripts);
  checkGood(row("good"));
  checkBad(row("bad"));
  checkModelRefused(root, transcripts);
  const { summary } = scores;
  same(
    "task scorer: summary over the root",
    [
      summary.tasks_scored,
      summary.tasks_right,
      summary.facts_right,
      summary.first_command_expected,
      summary.first_command_accepted,
    ],
    [2, 1, 5, 1, 1],
  );
};
