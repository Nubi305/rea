// Cells made by the real prepare scripts, with this file standing in for
// the agent: it runs one REA command through the cell's shim, writes an
// answer and a transcript that says so, and has the cell scored. This checks
// that prepare, the shim and the scorers fit together.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { portOpen, waitForHttp } from "../lib/service.mjs";
import {
  check,
  runScorer,
  same,
  transcriptLines,
  turn,
  writeTranscript,
} from "./kit.mjs";

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), "..");

const prepare = (script, args) => {
  const result = spawnSync(process.execPath, [join(HARNESS, script), ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`${script} failed: ${result.stderr.slice(0, 600)}`);
  return JSON.parse(result.stdout);
};

const readCell = (workspace) =>
  JSON.parse(readFileSync(`${workspace}.cell/cell.json`, "utf8"));

const checkTaskCell = (work, settings) => {
  const root = join(work, "prepared-tasks");
  const hardening = "t01-elf-hardening";
  prepare("task-prepare.mjs", [
    "--root",
    root,
    "--rea",
    settings.judge.checkout,
    "--client",
    settings.client,
    "--node",
    settings.judge.node,
    "--task",
    hardening,
    "--tag",
    "selftest",
  ]);
  const cell = readCell(join(root, hardening));
  const prompt = readFileSync(cell.prompt_file, "utf8");
  check(
    "prepared task: the skill is installed and the prompt names the input and the answer file",
    existsSync(join(cell.skill_dir, "SKILL.md")) &&
      prompt.includes(`${cell.input_dir}/keyd`) &&
      prompt.includes(cell.answer_file),
  );
  const command = `rea inspect-binary-hardening ${cell.input_dir}/keyd --json`;
  const output = execFileSync(
    join(cell.workspace, "bin", "rea"),
    ["inspect-binary-hardening", `${cell.input_dir}/keyd`, "--json"],
    { encoding: "utf8" },
  );
  writeFileSync(
    cell.answer_file,
    JSON.stringify({
      pie: false,
      relro: "partial",
      stack_canary: true,
      runpath: "/opt/keyd/lib",
    }),
  );
  const transcripts = join(work, "prepared-task-transcripts");
  mkdirSync(transcripts, { recursive: true });
  const turns = [
    turn(
      [100, 0, 900, 10],
      [{ name: "Bash", input: { command }, result: output }],
    ),
  ];
  writeTranscript(
    transcripts,
    "task",
    cell.label,
    transcriptLines(prompt, turns),
  );
  const scores = runScorer("task-score.mjs", [
    "--root",
    root,
    "--transcripts",
    transcripts,
  ]);
  const row = scores.rows[0];
  same(
    "prepared task: the built input holds the expected facts and REA shows them",
    [
      row.right,
      row.first_command.result,
      output.includes('"property":"relro","state":"partial"'),
    ],
    [true, "expected", true],
  );
  same(
    "prepared task: the shim's log and the transcript count the same call",
    [
      row.rea_invocations.from_shim_log.by_command,
      row.rea_invocations.from_transcript.by_command,
      row.context.rea.bytes,
    ],
    [
      { "inspect-binary-hardening": 1 },
      { "inspect-binary-hardening": 1 },
      Buffer.byteLength(output),
    ],
  );
};

// A clone the agent left running without recording how to stop it: the
// scorer must say so, and end it only when told to.
const checkForcedStop = async (workspace, transcripts, settings) => {
  const port = settings.ports[1];
  const stray = spawn(
    process.execPath,
    [
      "-e",
      `require("node:http").createServer((request, reply) => reply.end("stray")).listen(${port}, "127.0.0.1")`,
    ],
    { detached: true, stdio: "ignore" },
  );
  stray.unref();
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    const args = [
      "--workspace",
      workspace,
      "--transcript",
      transcripts,
      "--judge",
      settings.judge.checkout,
      "--skip-hidden",
    ];
    same(
      "prepared clone: a clone left running with no stop command is reported",
      runScorer("clone-score.mjs", args).left_running,
      { original: false, clone: true },
    );
    same(
      "prepared clone: --force-stop ends it",
      runScorer("clone-score.mjs", [...args, "--force-stop"]).left_running,
      { original: false, clone: false },
    );
  } finally {
    try {
      process.kill(stray.pid, "SIGKILL");
    } catch {
      // Already ended, as it should be.
    }
  }
};

const checkCloneCell = async (work, settings) => {
  const workspace = join(work, "prepared-clone");
  const [originalPort, clonePort] = settings.ports;
  prepare("clone-prepare.mjs", [
    "--app",
    settings.app.id,
    "--workspace",
    workspace,
    "--rea",
    settings.judge.checkout,
    "--client",
    settings.client,
    "--node",
    settings.judge.node,
    "--clone-name",
    "Selftest Clone",
    "--original-port",
    String(originalPort),
    "--clone-port",
    String(clonePort),
  ]);
  const cell = readCell(workspace);
  const prompt = readFileSync(cell.prompt_file, "utf8");
  const hiddenNames = [
    settings.app.hidden_dir,
    "rules.json",
    ...settings.app.rules.map((rule) => rule.id),
  ];
  check(
    "prepared clone: the original runs, and neither prompt nor workspace names the hidden material",
    (await portOpen(originalPort)) &&
      prompt.includes(cell.original.control) &&
      hiddenNames.every((name) => !prompt.includes(name)) &&
      !existsSync(join(workspace, "hidden")),
  );
  const transcripts = join(work, "prepared-clone-transcripts");
  mkdirSync(transcripts, { recursive: true });
  const turns = [
    turn(
      [100, 0, 900, 10],
      [
        {
          name: "Bash",
          input: { command: `cat ${cell.cell_dir}/original/server.mjs | head` },
          result: "source",
        },
      ],
    ),
  ];
  writeTranscript(
    transcripts,
    "clone",
    cell.label,
    transcriptLines(prompt, turns),
  );
  const score = runScorer("clone-score.mjs", [
    "--workspace",
    workspace,
    "--transcript",
    transcripts,
    "--judge",
    settings.judge.checkout,
  ]);
  same(
    "prepared clone: an agent that started no run gets no verdict and no hidden score",
    [score.referee.verdict, score.hidden.measured],
    [null, false],
  );
  same(
    "prepared clone: reading the original's source is a rule break",
    score.rule_breaks.by_kind,
    { "cell-private": 1 },
  );
  same(
    "prepared clone: scoring stops the original that prepare started",
    score.left_running,
    { original: false, clone: false },
  );
  await checkForcedStop(workspace, transcripts, settings);
};

/** `settings` is `{ app, judge, ports: [a, b], browser, client }`. */
export const checkPreparedCells = async (work, settings) => {
  checkTaskCell(work, settings);
  await checkCloneCell(work, settings);
};
