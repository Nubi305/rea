#!/usr/bin/env node
// Proves that a REA checkout can answer each benchmark task, without a model:
// builds the task's inputs, runs the task's reference route (proof.steps in
// task.json) and checks that REA's output holds the expected values. Also
// measures the naive first call of the tasks that have one (flood).
//
//   node bench/harness/task-proof.mjs --rea <checkout> [--node <node>]
//        [--task <id>]... [--port <n>] [--write] [--keep]
//
// --write records the measurement beside each task as proof.json.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildInputs, missingInputTools } from "./lib/inputs.mjs";
import { checkoutFacts, runRea } from "./lib/proc.mjs";
import { startNodeService, stopRecordedService } from "./lib/service.mjs";
import {
  fillPlaceholders,
  judgeAnswer,
  listTaskIds,
  loadTask,
  versionAtLeast,
} from "./lib/tasks.mjs";

const USAGE =
  "usage: task-proof.mjs --rea <checkout> [--node <node>] [--task <id>]... [--port <n>] [--write] [--keep]";

const options = () => {
  const { values } = parseArgs({
    options: {
      rea: { type: "string" },
      node: { type: "string", default: process.execPath },
      task: { type: "string", multiple: true },
      port: { type: "string", default: "5339" },
      write: { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
    },
  });
  if (values.rea === undefined) throw new Error(USAGE);
  return values;
};

const reaEnvironment = (root) => ({
  HOME: join(root, "home"),
  REA_BROWSER_EXECUTABLE:
    process.env.REA_BROWSER_EXECUTABLE ?? "/opt/pw-browsers/chromium",
  REA_BROWSER_NO_SANDBOX: process.env.REA_BROWSER_NO_SANDBOX ?? "true",
});

const missingText = (stdout, step, values) =>
  fillPlaceholders(step.must_contain ?? [], values).filter(
    (text) => !stdout.includes(text),
  );

const unwantedText = (stdout, step) =>
  (step.must_not_contain ?? []).filter((text) => stdout.includes(text));

const capture = (stdout, step, values) => {
  for (const [name, pattern] of Object.entries(step.capture ?? {})) {
    const match = new RegExp(pattern, "u").exec(stdout);
    if (match !== null) values[name] = match[1];
  }
};

const stepProblem = (result, step, values, expected) => {
  if (result.status !== expected)
    return `exit ${result.status}, expected ${expected}`;
  const missing = missingText(result.stdout, step, values);
  if (missing.length > 0) return `output lacks ${JSON.stringify(missing)}`;
  const unwanted = unwantedText(result.stdout, step);
  if (unwanted.length > 0) return `output holds ${JSON.stringify(unwanted)}`;
  return "none";
};

const runStep = (step, context) => {
  const { checkout, node, root, values } = context;
  if (step.write !== undefined) {
    const file = fillPlaceholders(step.write.path, values);
    const content = fillPlaceholders(step.write.content, values);
    writeFileSync(file, `${JSON.stringify(content)}\n`);
    return null;
  }
  const result = runRea(checkout, fillPlaceholders(step.args, values), {
    node,
    env: reaEnvironment(root),
    cwd: values.work,
  });
  capture(result.stdout, step, values);
  const expected = step.expect_exit ?? 0;
  const problem = stepProblem(result, step, values, expected);
  return {
    command: `rea ${step.args.join(" ")}`,
    exit: result.status,
    stdout_bytes: Buffer.byteLength(result.stdout),
    stderr_bytes: Buffer.byteLength(result.stderr),
    ok: problem === "none",
    problem,
  };
};

const startTaskService = async (task, root, port) => {
  if (task.service === undefined) return null;
  return startNodeService({
    script: join(task.dir, task.service.script),
    port,
    healthPath: task.service.health_path,
    recordFile: join(root, "service.json"),
    logFile: join(root, "service.log"),
  });
};

const proveTask = async (task, settings) => {
  const root = mkdtempSync(join(tmpdir(), `rea-bench-proof-${task.id}-`));
  const values = {
    input: join(root, "input"),
    work: join(root, "work"),
    browser: reaEnvironment(root).REA_BROWSER_EXECUTABLE,
  };
  mkdirSync(values.work, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  const context = { ...settings, root, values };
  try {
    buildInputs(task.inputs, { taskDir: task.dir, outDir: values.input });
    const service = await startTaskService(task, root, settings.port);
    if (service !== null) values.address = service.address;
    const steps = task.proof.steps
      .map((step) => runStep(step, context))
      .filter((step) => step !== null);
    const flood =
      task.flood === undefined ? null : runStep(task.flood, context);
    return { steps, flood };
  } finally {
    await stopRecordedService(join(root, "service.json"));
    if (!settings.keep) rmSync(root, { recursive: true, force: true });
  }
};

const record = (task, proof, facts) => ({
  task: task.id,
  measured_on: {
    commit: facts.commit_short,
    version: facts.version,
    node_version: facts.node_version,
  },
  route_stdout_bytes: proof.steps.reduce(
    (total, step) => total + step.stdout_bytes,
    0,
  ),
  route_ok: proof.steps.every((step) => step.ok),
  steps: proof.steps,
  ...(proof.flood === null
    ? {}
    : {
        naive_first_call: { ...proof.flood, ok: undefined, problem: undefined },
      }),
});

const main = async () => {
  const values = options();
  const facts = checkoutFacts(values.rea, values.node);
  const settings = {
    checkout: values.rea,
    node: values.node,
    port: Number(values.port),
    keep: values.keep,
  };
  const records = [];
  for (const id of values.task ?? listTaskIds()) {
    const task = loadTask(id);
    const missing = missingInputTools(task.inputs);
    const minimum = task.requires?.rea_node;
    const blocked =
      task.floor === true
        ? "the floor has no route"
        : missing.length > 0
          ? `needs ${missing.join(", ")}`
          : minimum !== undefined &&
              !versionAtLeast(facts.node_version, minimum)
            ? `REA answers it only on Node ${minimum} or newer`
            : null;
    if (blocked !== null) {
      console.error(`${id}: skipped, ${blocked}`);
      continue;
    }
    const entry = record(task, await proveTask(task, settings), facts);
    if (!judgeAnswer(task, task.reference_answer ?? null).right) {
      entry.route_ok = false;
      console.error(
        `  ${id}: reference_answer does not satisfy the task's facts`,
      );
    }
    records.push(entry);
    const naive = entry.naive_first_call?.stdout_bytes;
    console.error(
      `${id}: ${entry.route_ok ? "ok" : "FAILED"} route ${entry.route_stdout_bytes} B in ${entry.steps.length} calls` +
        (naive === undefined ? "" : `, naive first call ${naive} B`),
    );
    for (const step of entry.steps.filter((item) => !item.ok))
      console.error(`  ${step.command}: ${step.problem}`);
    if (values.write)
      writeFileSync(
        join(task.dir, "proof.json"),
        `${JSON.stringify(entry, null, 2)}\n`,
      );
  }
  console.log(JSON.stringify(records, null, 1));
  if (records.some((entry) => !entry.route_ok)) process.exitCode = 1;
};

await main();
