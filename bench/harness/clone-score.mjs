#!/usr/bin/env node
// Scores one clone-benchmark cell after its agent has finished: the
// referee's verdict, agreement on the hidden rules, what the run cost and
// what filled the agent's context, and rule breaks. No model is involved.
//
//   node bench/harness/clone-score.mjs --workspace <dir> --transcript <file or run directory>
//        --judge <checkout> [--cell <cell.json>] [--rea <checkout>] [--floor <floor.json>]
//        [--out <file>] [--note <text>]... [--skip-hidden] [--force-stop] [--keep] [--node <node>] [--original-port <n>]
//        [--clone-reset <command> --clone-stop <command> [--clone-address <url>]]
//
// It leaves both applications stopped, and says so in its result. A clone
// whose run recorded no stop command cannot be stopped that way: with
// --force-stop whatever still listens on the cell's two ports is ended.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { controlOriginal, copyOriginal, loadApp } from "./lib/clone-app.mjs";
import { agentLabelOf, modelIdsOf, scoreText } from "./lib/agent-label.mjs";
import { transcriptReport } from "./lib/cost.mjs";
import { replayHeldout } from "./lib/heldout.mjs";
import { listFiles } from "./lib/inputs.mjs";
import { checkoutFacts, runControl, writeOut } from "./lib/proc.mjs";
import {
  cloneControl,
  evaluateCopy,
  evidenceFiles,
  recordedVerdict,
} from "./lib/referee.mjs";
import { ruleBreaksOf } from "./lib/rule-breaks.mjs";
import {
  endListeners,
  portOpen,
  waitForHttp,
  waitForPortFree,
} from "./lib/service.mjs";
import { findTranscript, readTranscript } from "./lib/transcript.mjs";
import { readCell } from "./lib/workspace.mjs";

const USAGE = `usage: clone-score.mjs --workspace <dir> --transcript <file or run directory> --judge <checkout>
       [--cell <cell.json>] [--rea <checkout>] [--floor <floor.json>] [--out <file>]
       [--note <text>]... [--skip-hidden] [--force-stop] [--keep] [--node <node>] [--original-port <n>]
       [--clone-reset <command> --clone-stop <command> [--clone-address <url>]]`;

const options = () => {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string" },
      transcript: { type: "string" },
      judge: { type: "string" },
      cell: { type: "string" },
      rea: { type: "string" },
      floor: { type: "string" },
      out: { type: "string" },
      node: { type: "string" },
      "original-port": { type: "string" },
      "clone-reset": { type: "string" },
      "clone-stop": { type: "string" },
      "clone-address": { type: "string" },
      note: { type: "string", multiple: true, default: [] },
      "skip-hidden": { type: "boolean", default: false },
      "force-stop": { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
    },
  });
  if (!values.workspace || !values.transcript || !values.judge)
    throw new Error(USAGE);
  return values;
};

const treeDigest = (root) => {
  if (!existsSync(root)) return { files: 0, sha256: null };
  const hash = createHash("sha256");
  const files = listFiles(root).filter(
    (name) =>
      !name
        .split("/")
        .some((part) => part === ".git" || part === "node_modules"),
  );
  for (const name of files) {
    hash.update(`${name}\0`);
    hash.update(
      createHash("sha256")
        .update(readFileSync(join(root, name)))
        .digest(),
    );
  }
  return { files: files.length, sha256: hash.digest("hex") };
};

const scoreReferee = (cell, underTest, judge, workDir) => {
  const browser = cell.browser ?? "/opt/pw-browsers/chromium";
  const own = evaluateCopy(
    cell.run_dir,
    underTest,
    join(workDir, "run-under-test"),
    browser,
  );
  const pinned =
    judge.checkout === underTest.checkout
      ? null
      : evaluateCopy(cell.run_dir, judge, join(workDir, "run-judge"), browser);
  const recorded = recordedVerdict(cell.run_dir);
  return {
    verdict: own.verdict,
    exit_status: own.exit_status,
    under_test: own,
    by_judge: pinned,
    recorded_in_run_folder: recorded,
    recorded_differs: recorded !== null && recorded.verdict !== own.verdict,
  };
};

const cloneSide = (control, log) => ({
  address: control.address,
  reset: async () => {
    const result = runControl(control.reset, log);
    const up = await waitForHttp(control.address, 20_000);
    return {
      ok: up,
      detail: up
        ? ""
        : `the clone did not answer at ${control.address} after its reset command (exit ${result.status})`,
    };
  },
});

const originalSide = (ctl, port) => ({
  address: `http://127.0.0.1:${port}`,
  reset: async () => {
    const result = controlOriginal(ctl, port, "reset");
    return { ok: result.ok, detail: result.output };
  },
});

// Both ports must be free of anything this scorer did not start before it
// starts the two applications itself.
const claimPorts = async (cell, control, originalPort, log) => {
  if (cell.original.control) runControl(`${cell.original.control} stop`, log);
  runControl(control.stop, log);
  await waitForPortFree(control.port, 5000);
  for (const port of [originalPort, control.port])
    if (await portOpen(port))
      return `port ${port} is taken by a process this scorer did not start`;
  return null;
};

const scoreHidden = async (context) => {
  const { cell, app, judge, workDir, values } = context;
  const control = cloneControl(cell.run_dir, cell, {
    reset: values["clone-reset"],
    stop: values["clone-stop"],
    address: values["clone-address"],
  });
  if (control === null)
    return {
      measured: false,
      reason:
        "the run folder's target.json records no command that restarts and stops the clone",
    };
  const log = join(workDir, "control.log");
  const originalPort = Number(values["original-port"] ?? cell.original.port);
  const taken = await claimPorts(cell, control, originalPort, log);
  if (taken !== null) return { measured: false, reason: taken };
  const ctl = copyOriginal(app, join(workDir, "original"));
  try {
    const report = await replayHeldout({
      app,
      judge,
      sides: {
        original: originalSide(ctl, originalPort),
        clone: cloneSide(control, log),
      },
      cloneName: cell.clone.name,
      workDir,
      browser: cell.browser ?? "/opt/pw-browsers/chromium",
    });
    return { measured: true, clone_restarted_with: control.source, ...report };
  } finally {
    controlOriginal(ctl, originalPort, "stop");
    runControl(control.stop, log);
    if (!(await waitForPortFree(control.port, 8000)))
      await endListeners(control.port);
  }
};

const scoreTranscript = (cell, transcript, floorFile) => {
  const { invocations: _invocations, ...report } = transcriptReport(
    transcript,
    {
      skillDir: cell.skill_dir ?? null,
      shimLog: cell.shim_log ?? null,
      floor:
        floorFile === undefined
          ? null
          : JSON.parse(readFileSync(floorFile, "utf8")),
    },
  );
  return {
    ...report,
    captures: {
      by_shim_log: report.rea_invocations.from_shim_log?.captures ?? null,
      in_transcript_text: report.rea_invocations.from_transcript.captures,
      evidence_files_in_run: evidenceFiles(cell.run_dir),
    },
    rule_breaks: ruleBreaksOf(transcript, cell.forbidden ?? []),
    agent_report:
      transcript.final_output === null
        ? null
        : {
            outcome: transcript.final_output.outcome ?? null,
            final_exit_code: transcript.final_output.final_exit_code ?? null,
          },
  };
};

// Whatever happened above, nothing this cell started may be left running:
// the original that prepare started, and the clone if the run recorded how
// to stop it.
const stopBoth = (cell, values) => {
  if (cell.original.control)
    runControl(`${cell.original.control} stop`, "/dev/null");
  const control = cloneControl(cell.run_dir, cell, {
    reset: values["clone-reset"],
    stop: values["clone-stop"],
    address: values["clone-address"],
  });
  if (control !== null) runControl(control.stop, "/dev/null");
};

const portsOf = (cell, values) => ({
  original: Number(values["original-port"] ?? cell.original.port),
  clone: Number(new URL(values["clone-address"] ?? cell.clone.address).port),
});

const stillRunning = async (cell, values) => {
  const ports = portsOf(cell, values);
  if (values["force-stop"])
    for (const port of Object.values(ports))
      if (await portOpen(port)) await endListeners(port);
  return {
    original: await portOpen(ports.original),
    clone: await portOpen(ports.clone),
  };
};

const buildScore = async (context) => {
  const { cell, judge, underTest, transcript, workDir, values } = context;
  const treeBefore = treeDigest(cell.clone.root);
  const referee = scoreReferee(cell, underTest, judge, workDir);
  const hidden = values["skip-hidden"]
    ? { measured: false, reason: "skipped on request" }
    : await scoreHidden(context);
  const treeAfter = treeDigest(cell.clone.root);
  return {
    schema: "rea.bench.clone-score/1",
    agent: agentLabelOf(cell),
    cell: {
      id: cell.id,
      label: cell.label,
      app: cell.app,
      clone_name: cell.clone.name,
    },
    scored_at: new Date().toISOString(),
    rea_under_test: {
      commit: underTest.commit_short,
      version: underTest.version,
      node_version: underTest.node_version,
    },
    judge: { commit: judge.commit_short, version: judge.version },
    transcript: transcript.file,
    run: { started_at: transcript.started_at, ended_at: transcript.ended_at },
    notes: values.note,
    referee,
    hidden,
    ...scoreTranscript(cell, transcript, values.floor),
    clone_tree: {
      files: treeBefore.files,
      sha256: treeBefore.sha256,
      changed_by_scoring: treeBefore.sha256 !== treeAfter.sha256,
    },
  };
};

const headline = (score) => {
  const { referee, hidden, cost, left_running: left } = score;
  const rules = hidden.measured
    ? `${hidden.rules_agree} of ${hidden.rules_total} hidden rules agree`
    : `hidden rules not measured (${hidden.reason})`;
  const running = Object.keys(left).filter((side) => left[side]);
  return `${score.cell.id}: referee ${referee.verdict ?? "none"} (exit ${referee.exit_status}); ${rules}; peak context ${cost.peak_context_tokens}; ${running.length === 0 ? "both applications stopped" : `STILL RUNNING: ${running.join(", ")}`}`;
};

const main = async () => {
  const values = options();
  const cell = readCell(values.workspace, values.cell);
  if (cell.kind !== "clone") throw new Error(`${cell.id} is not a clone cell`);
  const node = values.node ?? cell.rea.node;
  const context = {
    cell,
    values,
    app: loadApp(cell.app),
    judge: checkoutFacts(values.judge, node),
    underTest:
      values.rea === undefined ? cell.rea : checkoutFacts(values.rea, node),
    transcript: readTranscript(findTranscript(values.transcript, cell.label)),
    workDir: mkdtempSync(join(tmpdir(), `rea-bench-score-${cell.id}-`)),
  };
  let score;
  let left;
  try {
    score = await buildScore(context);
  } finally {
    // Also after a failure: nothing this cell started may be left running.
    stopBoth(cell, values);
    left = await stillRunning(cell, values);
    if (!values.keep) rmSync(context.workDir, { recursive: true, force: true });
  }
  score.left_running = left;
  const text = scoreText(score, {
    modelIds: modelIdsOf([context.transcript]),
    paths: {
      [cell.skill_dir]: "<skill>",
      [join(cell.workspace, "home")]: "<home>",
      [dirname(context.transcript.file)]: "<transcripts>",
    },
  });
  writeOut(values.out, text);
  process.stdout.write(text);
  console.error(headline(score));
  if (left.original || left.clone) process.exitCode = 1;
};

await main();
